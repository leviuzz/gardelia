/**
 * Archivio degli oggetti (immagini generate) [P-02, ADR-025].
 *
 *  - Produzione: Cloudflare R2 (API compatibile S3, firma SigV4 con `aws4fetch`).
 *  - Sviluppo/test: filesystem locale (rifiutato con un APP_URL pubblico).
 *  - Chiavi sempre sotto `tenants/{tenantId}/…`: le immagini si servono solo tramite una
 *    route dell'app che verifica tenant e permessi, mai con URL pubblici.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { storageConfig } from '../config';

export interface ObjectStorage {
  readonly driver: 'filesystem' | 'r2' | 'memory';
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** null se l'oggetto non esiste. */
  get(key: string): Promise<Uint8Array | null>;
  /** Cancella l'oggetto; nessun errore se non esiste. */
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^tenants\/[0-9a-f-]{36}\/[a-z0-9-]+\/[a-z0-9-]+\.[a-z0-9]+$/;

/** Le chiavi sono generate dal server: questo controllo impedisce comunque path traversal. */
export function assertStorageKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error(`Chiave di archivio non valida: ${key}`);
}

export class FilesystemStorage implements ObjectStorage {
  readonly driver = 'filesystem' as const;
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private pathFor(key: string): string {
    assertStorageKey(key);
    const target = resolve(join(this.root, key));
    if (!target.startsWith(this.root + sep)) throw new Error('Percorso fuori dall’archivio');
    return target;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathFor(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

export interface R2Config {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export class R2Storage implements ObjectStorage {
  readonly driver = 'r2' as const;
  private readonly client: AwsClient;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: R2Config, fetchImpl?: typeof fetch) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
      region: 'auto',
    });
    this.baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}`;
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  private urlFor(key: string): string {
    assertStorageKey(key);
    return `${this.baseUrl}/${key}`;
  }

  /**
   * Firma la richiesta (SigV4 con `aws4fetch`) e la invia con il corpo in byte e la sua
   * lunghezza esplicita. Non si passa a `fetch` l'oggetto `Request` firmato: in una funzione di
   * Vercel (coda AI) il corpo arrivava a R2 come flusso senza `Content-Length` e R2 rispondeva
   * 411 (scontorno perso al salvataggio, 22/11/2026). La firma copre lo stesso corpo.
   */
  private async send(
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    upload?: { readonly bytes: Uint8Array; readonly contentType: string },
  ): Promise<Response> {
    const url = this.urlFor(key);
    // Copia su un ArrayBuffer proprio (tipo richiesto da fetch e dalla firma).
    const body = upload ? new Uint8Array(upload.bytes) : undefined;
    const signed = await this.client.sign(url, {
      method,
      ...(upload ? { headers: { 'Content-Type': upload.contentType }, body } : {}),
    });
    const headers = new Headers(signed.headers);
    if (body) headers.set('Content-Length', String(body.byteLength));
    return this.fetchImpl(url, { method, headers, ...(body ? { body } : {}) });
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const response = await this.send('PUT', key, { bytes, contentType });
    if (!response.ok) throw new Error(`R2 PUT non riuscito (${response.status})`);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.send('GET', key);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`R2 GET non riuscito (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const response = await this.send('DELETE', key);
    // S3/R2 rispondono 204 anche se l'oggetto non c'era.
    if (!response.ok && response.status !== 404) {
      throw new Error(`R2 DELETE non riuscito (${response.status})`);
    }
  }
}

/** Solo per i test: archivio in memoria. */
export class MemoryStorage implements ObjectStorage {
  readonly driver = 'memory' as const;
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertStorageKey(key);
    this.objects.set(key, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    assertStorageKey(key);
    this.objects.delete(key);
  }
}

/** Archivio scelto dalla configurazione (già validata: vedi config.ts). */
export function createStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const config = storageConfig(env);
  if (config.STORAGE_DRIVER === 'r2') {
    return new R2Storage({
      accountId: config.R2_ACCOUNT_ID ?? '',
      bucket: config.R2_BUCKET ?? '',
      accessKeyId: config.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: config.R2_SECRET_ACCESS_KEY ?? '',
    });
  }
  return new FilesystemStorage(config.STORAGE_DIR ?? '.storage');
}

let storage: ObjectStorage | null = null;

export function getObjectStorage(): ObjectStorage {
  storage ??= createStorageFromEnv();
  return storage;
}

/** Solo per i test: sostituisce l'archivio del processo. */
export function setObjectStorage(next: ObjectStorage | null): void {
  storage = next;
}

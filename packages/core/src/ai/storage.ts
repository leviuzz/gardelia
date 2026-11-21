/**
 * Archivio degli oggetti (immagini generate) [P-02, ADR-025].
 *
 *  - Produzione: Cloudflare R2 (API compatibile S3, firma SigV4 con `aws4fetch`).
 *  - Sviluppo/test: filesystem locale (rifiutato con un APP_URL pubblico).
 *  - Chiavi sempre sotto `tenants/{tenantId}/…`: le immagini si servono solo tramite una
 *    route dell'app che verifica tenant e permessi, mai con URL pubblici.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { AwsClient } from 'aws4fetch';

export interface ObjectStorage {
  readonly driver: 'filesystem' | 'r2' | 'memory';
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** null se l'oggetto non esiste. */
  get(key: string): Promise<Uint8Array | null>;
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

  constructor(config: R2Config) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
      region: 'auto',
    });
    this.baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}`;
  }

  private urlFor(key: string): string {
    assertStorageKey(key);
    return `${this.baseUrl}/${key}`;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const response = await this.client.fetch(this.urlFor(key), {
      method: 'PUT',
      body: bytes,
      headers: { 'Content-Type': contentType },
    });
    if (!response.ok) throw new Error(`R2 PUT non riuscito (${response.status})`);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.client.fetch(this.urlFor(key), { method: 'GET' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`R2 GET non riuscito (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
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
}

/** true se l'app gira solo in locale (sviluppo, test E2E): abilita gli adattatori locali. */
export function isLocalAppUrl(appUrl: string | undefined): boolean {
  if (!appUrl) return true;
  try {
    const host = new URL(appUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

export function createStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const driver = env.STORAGE_DRIVER ?? 'filesystem';
  if (driver === 'r2') {
    const config = {
      accountId: env.R2_ACCOUNT_ID ?? '',
      bucket: env.R2_BUCKET ?? '',
      accessKeyId: env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? '',
    };
    const missing = Object.entries(config)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(`Configurazione R2 incompleta: ${missing.join(', ')}`);
    }
    return new R2Storage(config);
  }
  if (driver === 'filesystem') {
    if (!isLocalAppUrl(env.APP_URL)) {
      throw new Error(
        'STORAGE_DRIVER=filesystem è ammesso solo in locale: in produzione usa STORAGE_DRIVER=r2.',
      );
    }
    return new FilesystemStorage(env.STORAGE_DIR ?? '.storage');
  }
  throw new Error(`STORAGE_DRIVER non supportato: ${driver}`);
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

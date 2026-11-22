import { describe, expect, it } from 'vitest';
import { R2Storage } from '../src/ai/storage';

/**
 * R2 (API S3) rifiuta un caricamento senza `Content-Length` con 411: in produzione lo scontorno
 * salvato dalla coda AI su Vercel falliva così (22/11/2026). Qui si controlla la richiesta che
 * parte davvero: corpo in byte (non un oggetto Request), lunghezza esplicita, firma SigV4.
 */
interface SentRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Headers;
  readonly body: unknown;
}

function storageWith(status: number, responseBody: Uint8Array | null = null) {
  const sent: SentRequest[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    return new Response(responseBody, { status });
  }) as typeof fetch;
  const storage = new R2Storage(
    {
      accountId: 'account123',
      bucket: 'gardelia-staging',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'secret-di-prova',
    },
    fakeFetch,
  );
  return { storage, sent };
}

const KEY = 'tenants/01a2043a-9b22-7581-bcfc-d40bd167b50f/photos/foto.png';

describe('archivio R2: richieste firmate con la lunghezza del corpo', () => {
  it('PUT: corpo in byte, Content-Length, tipo e firma SigV4', async () => {
    const { storage, sent } = storageWith(200);
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    await storage.put(KEY, bytes, 'image/png');

    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request?.url).toBe(
      `https://account123.r2.cloudflarestorage.com/gardelia-staging/${KEY}`,
    );
    expect(request?.method).toBe('PUT');
    expect(request?.body).toBeInstanceOf(Uint8Array);
    expect([...(request?.body as Uint8Array)]).toEqual([...bytes]);
    expect(request?.headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(request?.headers.get('content-type')).toBe('image/png');
    expect(request?.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//,
    );
    // Per S3 aws4fetch firma intestazioni e percorso, non il corpo (UNSIGNED-PAYLOAD, accettato da
    // R2): conta che il corpo inviato sia esattamente quello dichiarato da Content-Length.
    expect(request?.headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
    expect(request?.headers.get('x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('PUT rifiutato: errore con lo stato HTTP', async () => {
    const { storage } = storageWith(411);
    await expect(storage.put(KEY, new Uint8Array([1]), 'image/png')).rejects.toThrow(
      'R2 PUT non riuscito (411)',
    );
  });

  it('GET e DELETE: firmati, senza corpo; GET 404 = oggetto assente', async () => {
    const found = storageWith(200, new Uint8Array([7, 8, 9]));
    expect([...((await found.storage.get(KEY)) ?? [])]).toEqual([7, 8, 9]);
    expect(found.sent[0]?.method).toBe('GET');
    expect(found.sent[0]?.body).toBeUndefined();
    expect(found.sent[0]?.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);

    const missing = storageWith(404);
    expect(await missing.storage.get(KEY)).toBeNull();

    const removed = storageWith(204);
    await removed.storage.delete(KEY);
    expect(removed.sent[0]?.method).toBe('DELETE');
    expect(removed.sent[0]?.body).toBeUndefined();
  });

  it('chiavi fuori dallo spazio dei tenant rifiutate prima di qualsiasi richiesta', async () => {
    const { storage, sent } = storageWith(200);
    await expect(
      storage.put('../altro/file.png', new Uint8Array([1]), 'image/png'),
    ).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});

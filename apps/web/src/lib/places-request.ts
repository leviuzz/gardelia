import 'server-only';
import { headers } from 'next/headers';
import { serverEnv } from './env';
import { getSession } from './session';

/**
 * Regole comuni delle rotte di Google Places (ADR-059): solo per chi ha fatto l'accesso, solo dalla
 * nostra origine con JSON (niente richieste da altri siti, che costerebbero), e un tetto di richieste
 * per persona. Il tetto vive nel processo (sulle funzioni di Vercel vale per istanza): la protezione
 * dei costi vera sono le quote e l'avviso di spesa impostati su Google Cloud.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, number[]>();

function allow(key: string, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  // Pulizia leggera: il dizionario non cresce senza limite.
  if (hits.size > 5000) {
    for (const [other, times] of hits) {
      if (times.every((time) => now - time >= WINDOW_MS)) hits.delete(other);
    }
  }
  return true;
}

export type PlacesGate =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly response: Response };

export async function placesGate(request: Request): Promise<PlacesGate> {
  const deny = (status: number) => ({
    ok: false as const,
    response: new Response(null, { status }),
  });
  const requestHeaders = await headers();
  const origin = requestHeaders.get('origin');
  if (!origin || origin !== new URL(serverEnv().APP_URL).origin) return deny(403);
  if (!requestHeaders.get('content-type')?.startsWith('application/json')) return deny(415);
  const session = await getSession();
  if (!session) return deny(401);
  if (!allow(session.user.id, Date.now())) return deny(429);
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return deny(400);
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return deny(400);
  }
}

/** Identificativo di sessione di Places scelto dal browser: un UUID. */
export function sessionTokenOf(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

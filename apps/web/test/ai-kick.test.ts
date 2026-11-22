import { describe, expect, it } from 'vitest';
import {
  canonicalHost,
  drainUrl,
  postAiDrain,
  shouldKickAgain,
  WAITING_KICK_INTERVAL_MS,
} from '@/lib/ai-kick';
import { isAuthorizedInternalRequest } from '@/lib/internal-auth';

const SECRET = 's'.repeat(40);

describe('avvio protetto dei job AI', () => {
  it('solo con il segreto giusto', () => {
    expect(isAuthorizedInternalRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedInternalRequest(`Bearer ${'x'.repeat(40)}`, SECRET)).toBe(false);
    expect(isAuthorizedInternalRequest(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedInternalRequest(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedInternalRequest(null, SECRET)).toBe(false);
  });

  it('senza segreto configurato nessuna richiesta passa', () => {
    expect(isAuthorizedInternalRequest('Bearer ', undefined)).toBe(false);
    expect(isAuthorizedInternalRequest('Bearer qualcosa', undefined)).toBe(false);
  });
});

describe('indirizzo della funzione che svuota la coda (la richiesta porta il segreto)', () => {
  it('su Vercel sempre il dominio di produzione del progetto, anche con un APP_URL sbagliato', () => {
    const url = drainUrl({
      APP_URL: 'https://altro-progetto.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'gardelia.vercel.app',
    });
    expect(url?.href).toBe('https://gardelia.vercel.app/api/internal/ai/drain');
  });

  it('fuori da Vercel APP_URL', () => {
    expect(drainUrl({ APP_URL: 'http://localhost:3000' })?.href).toBe(
      'http://localhost:3000/api/internal/ai/drain',
    );
  });

  it('su Vercel con un dominio non valido non parte nulla (mai ripiego su APP_URL)', () => {
    for (const host of [
      'https://gardelia.vercel.app',
      'gardelia.vercel.app/altro',
      'sito.com:8080',
      'utente@sito.com',
      '',
      ' ',
    ]) {
      expect(
        drainUrl({ APP_URL: 'https://gardelia.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: host }),
      ).toBeNull();
    }
  });

  it('senza nessun indirizzo non parte nulla', () => {
    expect(drainUrl({})).toBeNull();
  });
});

describe('avvio quando un dominio del progetto rimanda a un altro', () => {
  const first = new URL('https://gardelia.vercel.app/api/internal/ai/drain');
  const appTarget = 'https://gardelia-staging.vercel.app/api/internal/ai/drain';
  const appHost = 'gardelia-staging.vercel.app';

  function fakeFetch(responses: Response[]) {
    const calls: { url: string; auth: string | null; redirect: RequestRedirect | undefined }[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        auth: new Headers(init?.headers).get('authorization'),
        redirect: init?.redirect,
      });
      const next = responses.shift();
      if (!next) throw new Error('nessuna risposta prevista');
      return next;
    }) as typeof fetch;
    return { impl, calls };
  }

  const redirect = (location: string, status = 307) =>
    new Response(null, { status, headers: { location } });

  it('risposta diretta: una sola chiamata, i rimandi non si seguono da soli', async () => {
    const { impl, calls } = fakeFetch([new Response(null, { status: 202 })]);
    expect(await postAiDrain(first, SECRET, appHost, impl)).toEqual({ ok: true, status: 202 });
    expect(calls).toEqual([{ url: first.href, auth: `Bearer ${SECRET}`, redirect: 'manual' }]);
  });

  it("rimando verso l'indirizzo dell'app: lo segue una volta, con il segreto", async () => {
    const { impl, calls } = fakeFetch([redirect(appTarget), new Response(null, { status: 202 })]);
    expect(await postAiDrain(first, SECRET, appHost, impl)).toEqual({ ok: true, status: 202 });
    expect(calls.map((call) => call.url)).toEqual([first.href, appTarget]);
    expect(calls[1]?.auth).toBe(`Bearer ${SECRET}`);
  });

  it('rimando verso un altro sito, in http, senza APP_URL o non leggibile: il segreto non parte', async () => {
    const cases: readonly (readonly [Response, string | null])[] = [
      [redirect('https://sito-esterno.com/api/internal/ai/drain'), appHost],
      [redirect('http://gardelia-staging.vercel.app/api/internal/ai/drain'), appHost],
      [redirect(appTarget), null],
      [new Response(null, { status: 308 }), appHost],
      [redirect('http://[indirizzo-rotto'), appHost],
    ];
    for (const [response, host] of cases) {
      const { impl, calls } = fakeFetch([response]);
      const result = await postAiDrain(first, SECRET, host, impl);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('redirect_not_allowed');
      expect(calls).toHaveLength(1);
    }
  });

  it('al massimo un rimando', async () => {
    const { impl, calls } = fakeFetch([redirect(appTarget), redirect(appTarget, 308)]);
    expect(await postAiDrain(first, SECRET, appHost, impl)).toEqual({
      ok: false,
      status: 308,
      reason: 'too_many_redirects',
    });
    expect(calls).toHaveLength(2);
  });

  it('la funzione rifiuta (es. segreto diverso): avvio non riuscito', async () => {
    const { impl } = fakeFetch([new Response(null, { status: 404 })]);
    expect(await postAiDrain(first, SECRET, appHost, impl)).toEqual({
      ok: false,
      status: 404,
      reason: 'rejected',
    });
  });

  it('host canonico: quello di APP_URL, nulla se manca o non è un indirizzo', () => {
    expect(canonicalHost('https://gardelia-staging.vercel.app')).toBe(appHost);
    expect(canonicalHost(undefined)).toBeNull();
    expect(canonicalHost('non è un indirizzo')).toBeNull();
  });
});

describe('riavvio mentre una pagina aspetta un job', () => {
  it('al massimo uno ogni intervallo', () => {
    expect(shouldKickAgain(0, WAITING_KICK_INTERVAL_MS)).toBe(true);
    expect(shouldKickAgain(1_000, 1_000 + WAITING_KICK_INTERVAL_MS - 1)).toBe(false);
    expect(shouldKickAgain(1_000, 1_000 + WAITING_KICK_INTERVAL_MS)).toBe(true);
  });
});

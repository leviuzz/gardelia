import { describe, expect, it } from 'vitest';
import { drainUrl, shouldKickAgain, WAITING_KICK_INTERVAL_MS } from '@/lib/ai-kick';
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

describe('riavvio mentre una pagina aspetta un job', () => {
  it('al massimo uno ogni intervallo', () => {
    expect(shouldKickAgain(0, WAITING_KICK_INTERVAL_MS)).toBe(true);
    expect(shouldKickAgain(1_000, 1_000 + WAITING_KICK_INTERVAL_MS - 1)).toBe(false);
    expect(shouldKickAgain(1_000, 1_000 + WAITING_KICK_INTERVAL_MS)).toBe(true);
  });
});

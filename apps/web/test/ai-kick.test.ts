import { describe, expect, it } from 'vitest';
import { shouldKickAgain, WAITING_KICK_INTERVAL_MS } from '@/lib/ai-kick';
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

describe('riavvio mentre una pagina aspetta un job', () => {
  it('al massimo uno ogni intervallo', () => {
    expect(shouldKickAgain(0, WAITING_KICK_INTERVAL_MS)).toBe(true);
    expect(shouldKickAgain(1_000, 1_000 + WAITING_KICK_INTERVAL_MS - 1)).toBe(false);
    expect(shouldKickAgain(1_000, 1_000 + WAITING_KICK_INTERVAL_MS)).toBe(true);
  });
});

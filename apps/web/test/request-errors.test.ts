import { describe, expect, it } from 'vitest';
import { describeRequestError, reportRequestError } from '@/lib/request-errors';

const request = {
  // Percorso reale con un token: non deve mai finire nei log.
  path: '/invite/9f2c4e1b7a?utm_source=whatsapp',
  method: 'GET',
  headers: { 'x-request-id': 'req-123', cookie: 'better-auth.session_token=segreto' },
};
const context = {
  routerKind: 'App Router',
  routePath: '/invite/[token]',
  routeType: 'render',
  renderSource: 'react-server-components',
};

describe('errori non gestiti delle richieste', () => {
  it('collegano ID della richiesta e Referencia (digest) mostrata all’utente', () => {
    const error = Object.assign(new Error('boom'), { digest: '2747516983' });
    expect(describeRequestError(error, request, context)).toMatchObject({
      requestId: 'req-123',
      digest: '2747516983',
      method: 'GET',
      route: '/invite/[token]',
      routeType: 'render',
    });
  });

  it('registrano il percorso della route, mai quello reale, la query o i cookie', () => {
    const fields = describeRequestError(new Error('boom'), request, context);
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain('9f2c4e1b7a');
    expect(serialized).not.toContain('utm_source');
    expect(serialized).not.toContain('segreto');
  });

  it('funzionano anche senza digest né ID (es. errori fuori dal proxy)', () => {
    const fields = describeRequestError('stringa lanciata', { ...request, headers: {} }, context);
    expect(fields.requestId).toBeUndefined();
    expect(fields.digest).toBeUndefined();
  });

  it('scrivono una sola riga di log con l’errore originale', () => {
    const lines: { fields: Record<string, unknown>; message: string }[] = [];
    const error = new Error('boom');
    reportRequestError(
      { error: (fields, message) => lines.push({ fields, message }) },
      error,
      request,
      context,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields.err).toBe(error);
    expect(lines[0]?.fields.requestId).toBe('req-123');
    expect(lines[0]?.message).toBe('errore non gestito in una richiesta');
  });
});

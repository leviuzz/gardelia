/**
 * SOLO TEST E2E (ADR-036). Caricato nel server Next.js con
 * `NODE_OPTIONS=--import=<questo file>` da `playwright.config.ts`, mai in produzione.
 *
 * Il browser non arriva mai su Google: il test intercetta `accounts.google.com` e rimanda
 * alla callback con un `code` che contiene l'identità da simulare (JSON in base64url). Qui il
 * server "scambia" quel `code` come farebbe Google, dopo aver controllato client, segreto,
 * `redirect_uri` e PKCE, e riceve un id_token con quell'identità. Il resto del flusso (stato,
 * cookie, collegamento degli account, sessione) è il codice vero di Better Auth.
 */
import { lookup } from 'node:dns/promises';
import http from 'node:http';

if (process.env.E2E_GOOGLE_OAUTH_MOCK === '1') {
  const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

  // --- Diagnostica (solo E2E) --------------------------------------------------------------------
  // In CI il ritorno da Google ogni tanto non risponde entro 10 s, senza errori nei log. Queste
  // righe dicono dove si ferma: richiesta mai arrivata, server bloccato (event loop), thread di
  // servizio occupati (risoluzione dei nomi lenta) o risposta lenta.
  const stamp = () => new Date().toISOString();
  const originalEmit = http.Server.prototype.emit;
  http.Server.prototype.emit = function emitWithCallbackTiming(event, ...args) {
    if (event === 'request') {
      const [request, response] = args;
      if (request.url?.startsWith('/api/auth/callback/')) {
        const started = Date.now();
        console.warn(`[e2e] ${stamp()} ritorno da Google ricevuto`);
        response.on('finish', () =>
          console.warn(
            `[e2e] ${stamp()} ritorno da Google: risposta ${response.statusCode} in ${Date.now() - started} ms`,
          ),
        );
        response.on('close', () => {
          if (!response.writableFinished) {
            console.warn(
              `[e2e] ${stamp()} ritorno da Google chiuso senza risposta dopo ${Date.now() - started} ms`,
            );
          }
        });
      }
    }
    return originalEmit.call(this, event, ...args);
  };
  let expected = Date.now() + 500;
  setInterval(() => {
    const lag = Date.now() - expected;
    if (lag > 1000) console.warn(`[e2e] ${stamp()} server bloccato per ${lag} ms (event loop)`);
    expected = Date.now() + 500;
  }, 500).unref();
  setInterval(() => {
    const started = Date.now();
    void lookup('localhost').then(() => {
      const took = Date.now() - started;
      if (took > 1000)
        console.warn(
          `[e2e] ${stamp()} risoluzione di localhost lenta: ${took} ms (thread occupati)`,
        );
    });
  }, 2000).unref();
  // -----------------------------------------------------------------------------------------------
  const realFetch = globalThis.fetch;

  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

  const requestUrl = (input) =>
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  async function exchange(init) {
    const body = new URLSearchParams(
      init?.body instanceof URLSearchParams || typeof init?.body === 'string'
        ? init.body
        : await new Response(init?.body).text(),
    );
    const headers = new Headers(init?.headers);
    const basic = headers.get('authorization')?.match(/^Basic (.+)$/i)?.[1];
    const [basicId, basicSecret] = basic
      ? Buffer.from(basic, 'base64').toString('utf8').split(':').map(decodeURIComponent)
      : [];
    const clientId = body.get('client_id') ?? basicId;
    const clientSecret = body.get('client_secret') ?? basicSecret;
    const expectedRedirect = `${process.env.BETTER_AUTH_URL ?? process.env.APP_URL}/api/auth/callback/google`;

    if (
      clientId !== process.env.GOOGLE_CLIENT_ID ||
      clientSecret !== process.env.GOOGLE_CLIENT_SECRET
    ) {
      return json(401, { error: 'invalid_client' });
    }
    if (
      body.get('grant_type') !== 'authorization_code' ||
      body.get('redirect_uri') !== expectedRedirect ||
      !body.get('code_verifier')
    ) {
      return json(400, { error: 'invalid_request' });
    }
    let identity;
    try {
      identity = JSON.parse(Buffer.from(body.get('code') ?? '', 'base64url').toString('utf8'));
    } catch {
      return json(400, { error: 'invalid_grant' });
    }
    const now = Math.floor(Date.now() / 1000);
    const idToken = [
      base64url({ alg: 'RS256', kid: 'e2e', typ: 'JWT' }),
      base64url({
        iss: 'https://accounts.google.com',
        aud: clientId,
        sub: identity.sub,
        email: identity.email,
        email_verified: identity.email_verified,
        name: identity.name,
        given_name: identity.name?.split(' ')[0],
        picture: 'https://lh3.googleusercontent.com/a/e2e-avatar',
        iat: now,
        exp: now + 3600,
      }),
      // Firma finta: nel flusso con `code` Better Auth legge l'id_token arrivato da Google via
      // TLS senza verificarne la firma; la verifica serve solo agli id_token inviati dal client.
      'e2e-signature',
    ].join('.');
    return json(200, {
      access_token: `e2e-access-${identity.sub}`,
      expires_in: 3599,
      scope:
        'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
      token_type: 'Bearer',
      id_token: idToken,
    });
  }

  globalThis.fetch = async function fetchWithGoogleMock(input, init) {
    if (requestUrl(input).startsWith(TOKEN_ENDPOINT)) {
      console.warn(`[e2e] ${stamp()} scambio del codice con "Google"`);
      return exchange(init);
    }
    return realFetch(input, init);
  };
  console.warn('[e2e] endpoint dei token di Google simulato (E2E_GOOGLE_OAUTH_MOCK=1)');
}

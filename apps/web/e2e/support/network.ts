/** IP di prova (TEST-NET-3, mai su internet), diverso per ogni persona che si registra. */
function newClientIp(): string {
  return `203.0.113.${1 + Math.floor(Math.random() * 254)}`;
}

/**
 * Le intestazioni di una persona che arriva da un suo IP. Il limite anti-abuso delle registrazioni
 * (5 al minuto per IP, salvato nel database: `apps/web/src/lib/auth.ts`) conta di seguito finché
 * passa meno di un minuto fra una registrazione e l'altra: con lo stesso IP i test che registrano
 * qualcuno uno dopo l'altro (o due esecuzioni di fila in locale) si sommerebbero.
 */
export function ownClientHeaders(): Record<string, string> {
  return { 'x-forwarded-for': newClientIp() };
}

/**
 * Errori con cui Better Auth rimanda alla pagina di accesso dopo Google (`?error=<codice>`).
 * Il codice arriva dall'URL: non si mostra mai così com'è, si traduce in una chiave nota
 * (`auth.google.errors.*`), con un messaggio generico per tutto il resto.
 */
const KNOWN: Readonly<Record<string, OAuthErrorKey>> = {
  // L'utente ha annullato su Google.
  access_denied: 'cancelled',
  // Esiste già un account con questa email ma non è confermato (o Google non la verifica):
  // Better Auth rifiuta il collegamento automatico.
  account_not_linked: 'notLinked',
  // Email non verificata da Google: account creato, link di conferma inviato, nessuna sessione.
  email_not_verified: 'emailNotVerified',
  // La sessione non è stata creata (es. utente sospeso dalla piattaforma).
  unable_to_create_session: 'sessionFailed',
};

export type OAuthErrorKey =
  'cancelled' | 'notLinked' | 'emailNotVerified' | 'sessionFailed' | 'generic';

export function oauthErrorKey(code: string | string[] | null | undefined): OAuthErrorKey | null {
  if (typeof code !== 'string' || code === '') return null;
  return Object.hasOwn(KNOWN, code) ? (KNOWN[code] ?? 'generic') : 'generic';
}

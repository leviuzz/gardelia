/**
 * Percorsi delle pagine di accesso con la destinazione dopo il login (`next`) e l'email
 * suggerita. I valori predefiniti non finiscono nell'URL (`/app` è la destinazione standard).
 */
export function authPath(
  page: '/login' | '/signup',
  params: { readonly next?: string; readonly email?: string } = {},
): string {
  const query = new URLSearchParams();
  if (params.next && params.next !== '/app') query.set('next', params.next);
  if (params.email) query.set('email', params.email);
  const search = query.toString();
  return search ? `${page}?${search}` : page;
}

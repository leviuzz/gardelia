import { exportBuyerData } from '@floral/core';
import { getSession } from '@/lib/session';

/**
 * "Descargar mis datos" (diritto di accesso, ADR-068): i dati di chi ha fatto l'accesso, in un file
 * JSON. La persona viene SOLO dalla sessione; senza sessione si risponde 401.
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  const data = await exportBuyerData({ userId: session.user.id, country: 'MX' });
  const day = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="gardelia-mis-datos-${day}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

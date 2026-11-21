import { getDb } from '@floral/db';

export const dynamic = 'force-dynamic';

/** Health check per load balancer/monitoraggio: nessun dettaglio interno nella risposta. */
export async function GET(): Promise<Response> {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}

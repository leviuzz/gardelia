import type { MetadataRoute } from 'next';
import { serverEnv } from '@/lib/env';
import { robotsRules } from '@/lib/indexing';

// Letto a ogni richiesta: l'interruttore è nella configurazione del deploy.
export const dynamic = 'force-dynamic';

/**
 * robots.txt (M1-2, ADR-087): con `PUBLIC_INDEXING` spento chiude tutto (staging); acceso apre le
 * pagine pubbliche, tiene fuori app, conti e link con token, e indica la sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  const env = serverEnv();
  return robotsRules({ enabled: env.PUBLIC_INDEXING === 'on', appUrl: env.APP_URL });
}

import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth';

/** Endpoint di Better Auth (/api/auth/*): rate limiting e controllo origine inclusi. */
export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).POST(request);
}

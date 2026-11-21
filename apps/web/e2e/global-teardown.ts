import type { SMTPServer } from 'smtp-server';

export default async function globalTeardown(): Promise<void> {
  const server = (globalThis as { __mailSink?: SMTPServer }).__mailSink;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
}

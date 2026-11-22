/**
 * Segnale "c'è un nuovo job": nel processo sveglia subito il worker (motore `inline`); su Vercel
 * (motore `serverless`) il server web lo usa per avviare la funzione che svuota la coda.
 *
 * L'emettitore sta su `globalThis`: Next.js può caricare questo modulo in più pacchetti dello
 * stesso processo e il segnale deve arrivare a chi ascolta, da qualunque pacchetto parta.
 */
import { EventEmitter } from 'node:events';

const holder = globalThis as typeof globalThis & { __floralAiSignal?: EventEmitter };
const emitter = (holder.__floralAiSignal ??= (() => {
  const created = new EventEmitter();
  created.setMaxListeners(50);
  return created;
})());

export function notifyAiWorker(): void {
  emitter.emit('job');
}

export function onAiJobQueued(listener: () => void): () => void {
  emitter.on('job', listener);
  return () => emitter.off('job', listener);
}

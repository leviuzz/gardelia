/**
 * Segnale in-process "c'è un nuovo job": il worker nello stesso processo si sveglia subito
 * invece di aspettare il prossimo giro di polling. Fra processi diversi resta il polling.
 */
import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function notifyAiWorker(): void {
  emitter.emit('job');
}

export function onAiJobQueued(listener: () => void): () => void {
  emitter.on('job', listener);
  return () => emitter.off('job', listener);
}

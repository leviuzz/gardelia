import { describe, expect, it } from 'vitest';
import {
  CARE_EMAIL_KINDS,
  CARE_MESSAGE_LIMITS,
  careMessageDayStart,
  careMessageProblem,
  careMessageSchema,
  careMessagesOpen,
} from '../src/index';

/** Floral Care, blocco 5b (ADR-084): le regole pure dei messaggi fra cliente e fioreria. */
describe('messaggi di Floral Care', () => {
  const key = '0193b2f0-7a1c-7a3e-9f00-0123456789ab';

  it('testo ripulito fino a 2000 caratteri e una chiave dell’invio obbligatoria', () => {
    expect(careMessageSchema.parse({ body: '  Hola, ¿mañana vienen?  ', submitKey: key })).toEqual({
      body: 'Hola, ¿mañana vienen?',
      submitKey: key,
    });
    // Senza testo va bene (può esserci la foto): lo decide `careMessageProblem`.
    expect(careMessageSchema.parse({ submitKey: key }).body).toBe('');
    const tooLong = careMessageSchema.safeParse({
      body: 'a'.repeat(CARE_MESSAGE_LIMITS.body + 1),
      submitKey: key,
    });
    expect(tooLong.success).toBe(false);
    expect(careMessageSchema.safeParse({ body: 'Hola', submitKey: '' }).success).toBe(false);
    expect(careMessageSchema.safeParse({ body: 'Hola', submitKey: 'non-uuid' }).success).toBe(
      false,
    );
  });

  it('si scrive con il contratto attivo o in pausa, con testo o foto', () => {
    expect(careMessagesOpen('ACTIVE')).toBe(true);
    expect(careMessagesOpen('PAUSED')).toBe(true);
    expect(careMessagesOpen('DRAFT')).toBe(false);
    expect(careMessagesOpen('ENDED')).toBe(false);
    expect(careMessageProblem({ status: 'ACTIVE', body: 'Hola', hasPhoto: false })).toBeNull();
    expect(careMessageProblem({ status: 'PAUSED', body: '', hasPhoto: true })).toBeNull();
    expect(careMessageProblem({ status: 'ACTIVE', body: '   ', hasPhoto: false })).toBe(
      'care_message_empty',
    );
    // Il contratto chiuso viene prima: inutile chiedere il testo.
    expect(careMessageProblem({ status: 'ENDED', body: '', hasPhoto: false })).toBe(
      'care_message_closed',
    );
  });

  it('il giorno comincia a mezzanotte nel fuso della fioreria', () => {
    // 05:30 UTC del 25/11 è ancora il 24/11 a Città del Messico (UTC−6).
    const now = new Date('2026-11-25T05:30:00Z');
    expect(careMessageDayStart('America/Mexico_City', now).toISOString()).toBe(
      '2026-11-24T06:00:00.000Z',
    );
    expect(careMessageDayStart('Europe/Rome', now).toISOString()).toBe('2026-11-24T23:00:00.000Z');
  });

  it('l’avviso dei messaggi è un tipo delle email di Floral Care', () => {
    expect(CARE_EMAIL_KINDS).toEqual(['VISIT_REPORT', 'BLOCK_NOTICE', 'MESSAGE_NOTICE']);
  });
});

/**
 * Posti nelle fasce di Floral Care (ADR-075). È l'unica strada per dare giorno e fascia a una
 * visita: generazione, spostamento del fiorista, cambio o archivio di una fascia (e poi il cliente
 * dal portale). I giorni bloccati (blocco 4, ADR-083) non hanno posti: in una fascia bloccata quel
 * giorno non si prenota niente, e un blocco di tutto il giorno chiude anche le ore libere.
 *
 * `openSlotBook` blocca TUTTE le fasce della fioreria in ordine di id: due prenotazioni insieme non
 * si scavalcano e non si bloccano a vicenda. Poi conta i posti delle visite che occupano ogni fascia
 * nei giorni del periodo, e il libro si aggiorna in memoria a ogni posto preso o lasciato.
 *
 * Ordine dei blocchi dentro una transazione: prima il contratto (se c'è), poi le fasce, poi le
 * visite. Chi cambia visite di un contratto (calendario, fine) blocca anche le fasce prima di
 * toccarle; chi cambia una fascia non blocca i contratti. Così due modifiche insieme si mettono in
 * fila invece di fermarsi a vicenda. Non esportato da `@floral/core`.
 */
import type { TransactionClient } from '@floral/db';
import {
  CARE_VISIT_HOLDING_STATUSES,
  addDays,
  careBlockCovers,
  compareDates,
  dayOfWeek,
  daysInMonth,
  pickCareSlot,
  pickCareSlotInMonth,
  toIsoDate,
  type CalendarDate,
  type CareBlockAction,
  type CareMonthCandidate,
  type SlotAvailability,
} from '@floral/domain';
import { dateToParts, partsToDate } from './quote-internals';

/** Un posto si cerca fino a 6 giorni prima o dopo (stessa settimana, stesso mese). */
const SEARCH_DAYS = 6;

export interface CareSlotRow {
  readonly id: string;
  readonly weekday: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly capacity: number;
  readonly active: boolean;
}

export interface CarePlacement {
  readonly slot: CareSlotRow;
  readonly date: CalendarDate;
}

/** Un blocco di giorni (ADR-083) come lo vede il libro delle fasce. */
export interface BookBlock {
  readonly id: string;
  readonly startDate: CalendarDate;
  readonly endDate: CalendarDate;
  /** null = tutto il giorno (anche le ore libere). */
  readonly slotId: string | null;
  readonly action: CareBlockAction;
  readonly label: string;
}

export interface PlacementBounds {
  /** Primo giorno possibile (incluso): mai prima di oggi. */
  readonly from: CalendarDate;
  /** Ultimo giorno possibile (incluso), o null (contratto senza fine). */
  readonly until: CalendarDate | null;
  /** Giorni da evitare ("AAAA-MM-GG"): quelli in cui il contratto ha già una visita. */
  readonly avoid?: ReadonlySet<string>;
}

const key = (slotId: string, date: CalendarDate) => `${slotId}|${toIsoDate(date)}`;

export class SlotBook {
  private readonly slots: ReadonlyMap<string, CareSlotRow>;
  private readonly booked: Map<string, number>;
  private readonly blocks: BookBlock[];

  constructor(
    slots: readonly CareSlotRow[],
    booked: Map<string, number>,
    private readonly range: { readonly from: CalendarDate; readonly until: CalendarDate },
    blocks: readonly BookBlock[] = [],
  ) {
    this.slots = new Map(slots.map((slot) => [slot.id, slot]));
    this.booked = booked;
    this.blocks = [...blocks];
  }

  slot(slotId: string): CareSlotRow | undefined {
    return this.slots.get(slotId);
  }

  /** Un blocco non ancora salvato: l'anteprima e il salvataggio di un blocco nuovo. */
  addBlock(block: BookBlock): void {
    this.blocks.push(block);
  }

  /**
   * Il blocco che toglie la fascia quel giorno (il primo creato), o null. Senza fascia (un'ora
   * libera) conta solo un blocco di tutto il giorno.
   */
  blockFor(slotId: string | null, date: CalendarDate): BookBlock | null {
    return this.blocks.find((block) => careBlockCovers(block, date, slotId)) ?? null;
  }

  /** Il blocco di tutto il giorno che copre la data, o null. */
  dayBlock(date: CalendarDate): BookBlock | null {
    return this.blockFor(null, date);
  }

  /** Le fasce attive, in ordine di giorno e di ora. */
  activeSlots(): CareSlotRow[] {
    return [...this.slots.values()]
      .filter((slot) => slot.active)
      .sort((a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes);
  }

  /** Posti occupati in una fascia quel giorno. */
  used(slotId: string, date: CalendarDate): number {
    this.assertInRange(date);
    return this.booked.get(key(slotId, date)) ?? 0;
  }

  /** Posti liberi: 0 per una fascia archiviata, di un altro giorno della settimana o bloccata. */
  free(slotId: string, date: CalendarDate): number {
    const slot = this.slots.get(slotId);
    if (!slot?.active || slot.weekday !== dayOfWeek(date)) return 0;
    if (this.blockFor(slotId, date)) return 0;
    return Math.max(0, slot.capacity - this.used(slotId, date));
  }

  take(slotId: string, date: CalendarDate, seats: number): void {
    this.booked.set(key(slotId, date), this.used(slotId, date) + seats);
  }

  release(slotId: string, date: CalendarDate, seats: number): void {
    this.booked.set(key(slotId, date), Math.max(0, this.used(slotId, date) - seats));
  }

  /**
   * Dove va una visita: la fascia preferita il suo giorno; se è piena (o non c'è più) un'altra lo
   * stesso giorno, poi il giorno più vicino della stessa settimana e dello stesso mese
   * (`pickCareSlot`), dentro i limiti. Null = nessun posto: la visita resta "Por reprogramar".
   * Non prende il posto: lo fa chi chiama, con `take`.
   */
  place(input: {
    readonly date: CalendarDate;
    readonly preferredSlotId: string | null;
    readonly seats: number;
    readonly bounds: PlacementBounds;
  }): CarePlacement | null {
    const candidates: SlotAvailability[] = [];
    for (let offset = -SEARCH_DAYS; offset <= SEARCH_DAYS; offset += 1) {
      const day = addDays(input.date, offset);
      if (compareDates(day, input.bounds.from) < 0) continue;
      if (input.bounds.until && compareDates(day, input.bounds.until) > 0) continue;
      if (input.bounds.avoid?.has(toIsoDate(day))) continue;
      for (const slot of this.slots.values()) {
        if (!slot.active || slot.weekday !== dayOfWeek(day)) continue;
        candidates.push({
          date: day,
          slotId: slot.id,
          free: this.free(slot.id, day),
          startMinutes: slot.startMinutes,
        });
      }
    }
    const picked = pickCareSlot({
      date: input.date,
      preferredSlotId: input.preferredSlotId ?? '',
      seats: input.seats,
      candidates,
    });
    const slot = picked ? this.slots.get(picked.slotId) : undefined;
    return picked && slot ? { slot, date: picked.date } : null;
  }

  /**
   * Dove va una visita di un giorno bloccato (ADR-083): la sua fascia o un'altra lo stesso giorno,
   * poi il giorno con posto più vicino dello stesso mese, prima o dopo (`pickCareSlotInMonth`),
   * dentro i limiti e dentro il periodo che il libro conosce. Null = "Por reprogramar". Non prende
   * il posto: lo fa chi chiama, con `take`.
   */
  placeInMonth(input: {
    readonly date: CalendarDate;
    readonly preferredSlotId: string | null;
    readonly seats: number;
    readonly bounds: PlacementBounds;
  }): CarePlacement | null {
    const known = {
      from: addDays(this.range.from, -SEARCH_DAYS),
      until: addDays(this.range.until, SEARCH_DAYS),
    };
    const candidates: CareMonthCandidate[] = [];
    const last = daysInMonth(input.date.year, input.date.month);
    for (let dayOfMonth = 1; dayOfMonth <= last; dayOfMonth += 1) {
      const day = { year: input.date.year, month: input.date.month, day: dayOfMonth };
      if (compareDates(day, input.bounds.from) < 0) continue;
      if (input.bounds.until && compareDates(day, input.bounds.until) > 0) continue;
      if (compareDates(day, known.from) < 0 || compareDates(day, known.until) > 0) continue;
      if (input.bounds.avoid?.has(toIsoDate(day))) continue;
      for (const slot of this.slots.values()) {
        if (!slot.active || slot.weekday !== dayOfWeek(day)) continue;
        candidates.push({
          date: day,
          slotId: slot.id,
          free: this.free(slot.id, day),
          startMinutes: slot.startMinutes,
        });
      }
    }
    const picked = pickCareSlotInMonth({
      date: input.date,
      preferredSlotId: input.preferredSlotId,
      seats: input.seats,
      candidates,
    });
    const slot = picked ? this.slots.get(picked.slotId) : undefined;
    return picked && slot ? { slot, date: picked.date } : null;
  }

  private assertInRange(date: CalendarDate): void {
    const from = addDays(this.range.from, -SEARCH_DAYS);
    const until = addDays(this.range.until, SEARCH_DAYS);
    if (compareDates(date, from) < 0 || compareDates(date, until) > 0) {
      throw new Error(`Giorno fuori dal libro delle fasce: ${toIsoDate(date)}`);
    }
  }
}

/** Blocca tutte le fasce della fioreria, in ordine di id, fino alla fine della transazione. */
export async function lockCareSlots(tx: TransactionClient, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "CareSlot" WHERE "tenantId" = ${tenantId}::uuid
    ORDER BY "id" FOR UPDATE`;
}

/**
 * Blocca le fasce della fioreria (`lockCareSlots`; rifarlo nella stessa transazione non cambia
 * nulla) e conta i posti occupati nel periodo `range`, più i 6 giorni prima e dopo dove `place` può
 * cercare. Le fasce si leggono dopo il blocco: un cambio già salvato nella transazione si vede.
 */
export async function openSlotBook(
  tx: TransactionClient,
  tenantId: string,
  range: { readonly from: CalendarDate; readonly until: CalendarDate },
  options: { readonly lock?: boolean } = {},
): Promise<SlotBook> {
  // Solo per leggere (posti liberi da mostrare) si può non bloccare: chi prenota rilegge bloccando.
  if (options.lock !== false) await lockCareSlots(tx, tenantId);
  const slots = await tx.careSlot.findMany({
    where: { tenantId },
    select: {
      id: true,
      weekday: true,
      startMinutes: true,
      endMinutes: true,
      capacity: true,
      status: true,
    },
  });
  const rows = await tx.careVisit.groupBy({
    by: ['slotId', 'scheduledDate'],
    where: {
      tenantId,
      status: { in: [...CARE_VISIT_HOLDING_STATUSES] },
      slotId: { not: null },
      scheduledDate: {
        gte: partsToDate(addDays(range.from, -SEARCH_DAYS)),
        lte: partsToDate(addDays(range.until, SEARCH_DAYS)),
      },
    },
    _sum: { seats: true },
  });
  const booked = new Map<string, number>();
  for (const row of rows) {
    if (!row.slotId || !row.scheduledDate) continue;
    booked.set(
      `${row.slotId}|${row.scheduledDate.toISOString().slice(0, 10)}`,
      row._sum.seats ?? 0,
    );
  }
  // I blocchi attivi del periodo (ADR-083): si creano tenendo le fasce bloccate, quindi dopo il
  // blocco qui sopra si vedono tutti.
  const blocks = await tx.careBlock.findMany({
    where: {
      tenantId,
      removedAt: null,
      startDate: { lte: partsToDate(addDays(range.until, SEARCH_DAYS)) },
      endDate: { gte: partsToDate(addDays(range.from, -SEARCH_DAYS)) },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, startDate: true, endDate: true, slotId: true, action: true, label: true },
  });
  return new SlotBook(
    slots.map((slot) => ({
      id: slot.id,
      weekday: slot.weekday,
      startMinutes: slot.startMinutes,
      endMinutes: slot.endMinutes,
      capacity: slot.capacity,
      active: slot.status === 'ACTIVE',
    })),
    booked,
    range,
    blocks.map((block) => toBookBlock(block)),
  );
}

/** Una riga di `CareBlock` per il libro delle fasce. */
export function toBookBlock(block: {
  readonly id: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly slotId: string | null;
  readonly action: CareBlockAction;
  readonly label: string;
}): BookBlock {
  const start = dateToParts(block.startDate);
  const end = dateToParts(block.endDate);
  if (!start || !end) throw new Error('Blocco senza date');
  return {
    id: block.id,
    startDate: start,
    endDate: end,
    slotId: block.slotId,
    action: block.action,
    label: block.label,
  };
}

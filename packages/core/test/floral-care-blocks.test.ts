import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectDb, getDb, withSystemContext, withTenantContext } from '@floral/db';
import {
  addCarePeriods,
  addDays,
  carePeriodOf,
  dayOfWeek,
  todayInTimeZone,
  toIsoDate,
  type CalendarDate,
} from '@floral/domain';
import {
  ConflictError,
  ForbiddenError,
  MemoryMailer,
  NotFoundError,
  ValidationError,
  addCarePlant,
  addCustomerAddress,
  assignCareVisit,
  confirmCareContract,
  createCareBlock,
  createCareContract,
  createCareExtraVisit,
  createCareSlot,
  createCustomer,
  getCareAgendaDay,
  getCareAgendaMonth,
  getCareBlock,
  getCareSettings,
  listCareAssignees,
  listCareBlocks,
  moveCareVisit,
  previewCareBlock,
  reassignCareVisits,
  removeCareBlock,
  sendCareBlockNotice,
  updateCareSettings,
  updatePrimaryLocation,
  type CareMailDeps,
  type TenantContext,
} from '../src/index';
import { jobWriteScope, loadJobScope } from '../src/scope';
import { issueNextCareChargeTx } from '../src/services/care-charges';
import { contextFor, createTestShop, type TestShop } from '../src/testing';

/**
 * Floral Care, blocco 4 (ADR-083): giorni bloccati, l'anteprima con le visite toccate, «Mover» al
 * giorno libero più vicino del mese o «Cancelar» con il credito, "Sí, avisé al cliente", l'impronta
 * del piano, l'email per contratto, le visite che nascono dopo, gli spostamenti rifiutati in un
 * giorno bloccato, "Quitar", il cambio di persona, permessi, isolamento e concorrenza.
 */

const db = getDb();
const TZ = 'America/Mexico_City';
const STAMP = Date.now().toString(36);
const today = (): CalendarDate => todayInTimeZone(TZ);
const iso = (date: CalendarDate) => toIsoDate(date);
const dayOf = (date: Date): CalendarDate => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

let shop: TestShop;
/** I contesti della fioreria LIVE (scrive davvero ai clienti). */
let live: { owner: TenantContext; manager: TenantContext; staff: TenantContext };
let other: TestShop;
const mailer = new MemoryMailer();
const deps: CareMailDeps = {
  mailer,
  appUrl: 'https://gardelia.example.test',
  secret: 'b'.repeat(48),
};

const slotsUsed = new Map<string, number>();

/** Una fascia nuova di 20 minuti, con 2 posti, diversa per ogni contratto (o la data). */
async function nextSlot(ctx: TenantContext, weekday: number, capacity = 2): Promise<string> {
  const index = (slotsUsed.get(ctx.tenantId) ?? 0) + 1;
  slotsUsed.set(ctx.tenantId, index);
  const time = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const slot = await createCareSlot(ctx, {
    weekday: String(weekday),
    start: time(300 + index * 20),
    end: time(300 + index * 20 + 20),
    capacity: String(capacity),
  });
  return slot.id;
}

async function setUpOffer(ctx: TenantContext): Promise<void> {
  await updatePrimaryLocation(ctx, {
    addressLine1: 'Av. Madero 1',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryRadiusKm: '15',
    placeId: `ChIJ_blocks_${ctx.tenantSlug}`,
    latitude: '21.8818',
    longitude: '-102.2916',
  });
  await updateCareSettings(ctx, {
    visitFee: '450',
    careFeeSmall: '10',
    careFeeMedium: '20',
    careFeeLarge: '40',
    frequencies: ['MONTHLY_1', 'MONTHLY_2', 'WEEKLY'],
    maxDistanceKm: '',
    minNoticeHours: '24',
    missedVisitPolicy: 'COUNTS',
    deadPlantPolicy: 'QUOTE',
    paymentDueDays: '10',
    termsText: '',
  });
}

interface Kit {
  readonly subscriptionId: string;
  readonly slotId: string;
  /** Le visite del calendario programmate, in ordine. */
  readonly visits: readonly { readonly id: string; readonly date: CalendarDate }[];
}

/**
 * Un contratto settimanale confermato che parte `startOffset` giorni da oggi, nella sua fascia del
 * giorno della settimana di quel giorno. Il cliente ha un'email se `email`.
 */
async function newContract(
  ctx: TenantContext,
  name: string,
  options: {
    readonly startOffset?: number;
    readonly email?: boolean;
    readonly slotId?: string;
  } = {},
): Promise<Kit> {
  const start = addDays(today(), options.startOffset ?? 2);
  const slotId = options.slotId ?? (await nextSlot(ctx, dayOfWeek(start)));
  const customer = await createCustomer(ctx, {
    type: 'COMPANY',
    displayName: name,
    legalName: null,
    taxId: null,
    email: options.email
      ? `cliente-${STAMP}-${name.replace(/\W/g, '').toLowerCase()}@bloqueos.example.test`
      : null,
    phone: '+524495550177',
    notes: null,
    preferences: null,
    restrictions: null,
    tags: [],
    acquisitionChannel: null,
    marketingConsent: false,
  });
  const place = await addCustomerAddress(ctx, customer.id, {
    label: name,
    recipientName: '',
    recipientPhone: '',
    addressLine1: 'Av. Universidad 300',
    addressLine2: '',
    neighborhood: 'Centro',
    city: 'Aguascalientes',
    region: 'AGU',
    postalCode: '20000',
    deliveryNotes: '',
    placeId: `ChIJ_${name.replace(/\W/g, '')}_${STAMP}`,
    latitude: '21.9',
    longitude: '-102.2916',
  });
  const settings = await getCareSettings(ctx);
  const contract = await createCareContract(ctx, customer.id, {
    customerAddressId: place.id,
    frequency: 'WEEKLY',
    slotIds: [slotId],
    startDate: iso(start),
    seats: '',
    serviceIds: settings.services
      .filter((service) => service.presetKey === 'watering')
      .map((service) => service.id),
    contactName: 'Recepción',
    contactPhone: '',
    accessNotes: '',
    notes: '',
    outOfRangeConfirmed: '',
  });
  await addCarePlant(ctx, contract.id, { name: 'Potos', quantity: '4', size: 'MEDIUM' });
  await confirmCareContract(ctx, contract.id);
  return { subscriptionId: contract.id, slotId, visits: await scheduledVisits(contract.id) };
}

async function scheduledVisits(subscriptionId: string) {
  const rows = await withSystemContext(db, { reason: 'test: visite' }, (tx) =>
    tx.careVisit.findMany({
      where: { subscriptionId, isExtra: false, status: 'SCHEDULED' },
      orderBy: { scheduledDate: 'asc' },
      select: { id: true, scheduledDate: true },
    }),
  );
  return rows.map((row) => ({ id: row.id, date: dayOf(row.scheduledDate!) }));
}

async function visitRow(id: string) {
  return withSystemContext(db, { reason: 'test: visita' }, (tx) =>
    tx.careVisit.findUniqueOrThrow({ where: { id } }),
  );
}

const blockInput = (
  start: CalendarDate,
  end: CalendarDate,
  extra: Record<string, string> = {},
): Record<string, string> => ({
  startDate: iso(start),
  endDate: iso(end),
  slotId: '',
  label: 'Vacaciones',
  action: 'MOVE',
  ...extra,
});

/** Anteprima e salvataggio come fa la pagina: l'impronta viene dall'anteprima. */
async function block(
  ctx: TenantContext,
  input: Record<string, string>,
  confirm: Record<string, string> = { customerNotified: 'on' },
) {
  const preview = await previewCareBlock(ctx, input);
  const created = await createCareBlock(ctx, { ...input, plan: preview.plan, ...confirm }, deps);
  return { preview, created };
}

beforeAll(async () => {
  shop = await createTestShop('Florería Bloqueos');
  await withSystemContext(db, { reason: 'test: fioreria reale' }, (tx) =>
    tx.tenant.update({
      where: { id: shop.tenant.tenantId },
      data: { mode: 'LIVE', contactEmail: `contacto-${STAMP}@bloqueos.example.test` },
    }),
  );
  live = {
    owner: await contextFor(shop.tenant.owner.id, shop.tenant.slug),
    manager: await contextFor(shop.managerUser.id, shop.tenant.slug),
    staff: await contextFor(shop.staffUser.id, shop.tenant.slug),
  };
  other = await createTestShop('Florería Bloqueos Ajena');
  await setUpOffer(live.owner);
  await setUpOffer(other.owner);
});

afterAll(async () => {
  await disconnectDb();
});

describe('bloquear días: «Mover»', () => {
  it('la anteprima elenca le visite toccate e dove vanno; senza avviso non si salva', async () => {
    const kit = await newContract(live.owner, 'Hotel Bloqueo Mover', { email: true });
    const target = kit.visits[0]!;
    // Un altro orario il giorno dopo: dove la visita può andare.
    await nextSlot(live.owner, dayOfWeek(addDays(target.date, 1)));
    const input = blockInput(target.date, target.date);
    const preview = await previewCareBlock(live.manager, input);
    expect(preview.counts.moved + preview.counts.toReschedule).toBeGreaterThanOrEqual(1);
    const mine = preview.contracts.find((group) => group.subscriptionId === kit.subscriptionId);
    expect(mine?.hasEmail).toBe(true);
    const change = mine?.changes.find((item) => item.visitId === target.id);
    expect(change?.from.date).toBe(iso(target.date));
    expect(preview.emailsAllowed).toBe(true);

    await expect(
      createCareBlock(live.manager, { ...input, plan: preview.plan }, deps),
    ).rejects.toMatchObject({ fieldErrors: { customerNotified: 'care_notice_required' } });

    const created = await createCareBlock(
      live.manager,
      { ...input, plan: preview.plan, customerNotified: 'on', sendEmail: 'on' },
      deps,
    );
    expect(created.counts).toEqual(preview.counts);
    const moved = await visitRow(target.id);
    if (change?.outcome === 'MOVED') {
      expect(moved.status).toBe('SCHEDULED');
      expect(iso(dayOf(moved.scheduledDate!))).toBe(change.to?.date);
      // Stesso mese, mai il giorno bloccato.
      expect(dayOf(moved.scheduledDate!).month).toBe(target.date.month);
      expect(iso(dayOf(moved.scheduledDate!))).not.toBe(iso(target.date));
    } else {
      expect(moved.status).toBe('TO_RESCHEDULE');
    }
    // Un avviso per contratto, partito subito, con il giorno e la nuova data.
    expect(created.emails).toEqual({
      queued: preview.contracts.filter((group) => group.hasEmail).length,
      sent: preview.contracts.filter((group) => group.hasEmail).length,
    });
    const sent = mailer.sent.find(
      (message) =>
        message.category === 'care_block_notice' && message.text.includes('Hotel Bloqueo Mover'),
    );
    expect(sent?.subject).toContain('Cambios en tus visitas');

    const detail = await getCareBlock(live.owner, created.blockId);
    expect(detail.label).toBe('Vacaciones');
    expect(
      detail.contracts.find((group) => group.subscriptionId === kit.subscriptionId)?.email,
    ).toMatchObject({ status: 'SENT', retryable: false });
    const audit = await withSystemContext(db, { reason: 'test: registro' }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { entityId: created.blockId, action: 'care.block_created' },
      }),
    );
    expect(audit.metadata).toMatchObject({ action: 'MOVE', customerNotified: true });
    // Il registro non porta il nome del blocco né i dati dei clienti.
    expect(JSON.stringify(audit.metadata)).not.toContain('Hotel');
  });

  it('nessuna prenotazione entra più in un giorno bloccato; "Quitar" lo libera', async () => {
    const kit = await newContract(live.owner, 'Oficina Día Cerrado');
    const free = kit.visits[1]!;
    // Il giorno della seconda visita, solo la sua fascia, senza visite toccate (la si sposta dopo).
    const otherDay = addDays(free.date, 1);
    const { created } = await block(
      live.owner,
      blockInput(otherDay, otherDay, { slotId: '', label: 'Inventario anual' }),
    );
    expect(created.counts).toEqual({ moved: 0, toReschedule: 0, cancelled: 0 });
    // Un'ora libera di una visita extra in quel giorno: no.
    await expect(
      createCareExtraVisit(live.owner, kit.subscriptionId, {
        kind: 'EXTRA',
        placement: 'TIME',
        date: iso(otherDay),
        start: '16:00',
        end: '17:00',
        fee: 'FREE',
        note: '',
      }),
    ).rejects.toMatchObject({ fieldErrors: { date: 'care_day_blocked' } });
    // L'Agenda lo dice.
    const day = await getCareAgendaDay(live.owner, iso(otherDay));
    expect(day.blocks.map((item) => item.label)).toContain('Inventario anual');
    const month = await getCareAgendaMonth(
      live.owner,
      `${otherDay.year}-${String(otherDay.month).padStart(2, '0')}`,
    );
    expect(month.blockedDays).toContainEqual({ date: iso(otherDay), wholeDay: true });

    await removeCareBlock(live.owner, created.blockId);
    await removeCareBlock(live.owner, created.blockId);
    const after = await getCareAgendaDay(live.owner, iso(otherDay));
    expect(after.blocks).toEqual([]);
    const list = await listCareBlocks(live.owner);
    expect(list.current.map((item) => item.id)).not.toContain(created.blockId);
    expect(list.past.map((item) => item.id)).toContain(created.blockId);
  });

  it('spostare una visita in una fascia bloccata è rifiutato', async () => {
    const kit = await newContract(live.owner, 'Oficina Horario Bloqueado');
    const visit = kit.visits[0]!;
    const target = addDays(visit.date, 7);
    // Si blocca solo la fascia del contratto il giorno dopo una settimana (con la sua visita).
    const { created } = await block(
      live.owner,
      blockInput(target, target, { slotId: kit.slotId, label: 'Junta' }),
    );
    await expect(
      moveCareVisit(live.owner, visit.id, {
        placement: 'SLOT',
        date: iso(target),
        slotId: kit.slotId,
        customerNotified: 'on',
      }),
    ).rejects.toMatchObject({ fieldErrors: { slotId: 'care_day_blocked' } });
    const day = await getCareAgendaDay(live.owner, iso(target));
    expect(day.groups.find((group) => group.slotId === kit.slotId)?.blockedBy).toBe('Junta');
    await removeCareBlock(live.owner, created.blockId);
  });
});

describe('bloquear días: «Cancelar» e visite che nascono dopo', () => {
  it('le visite toccate si cancellano come della fioreria: credito se erano nel cargo', async () => {
    const kit = await newContract(live.owner, 'Corporativo Bloqueo Cancelar', { startOffset: 0 });
    const target = kit.visits.find((visit) => visit.date.day > today().day) ?? kit.visits[1]!;
    const { created } = await block(
      live.owner,
      blockInput(target.date, target.date, { action: 'CANCEL', label: 'Cierre' }),
    );
    expect(created.counts.cancelled).toBeGreaterThanOrEqual(1);
    const row = await visitRow(target.id);
    expect(row).toMatchObject({ status: 'CANCELLED', cancelReason: 'SHOP', outcomeNote: 'Cierre' });
    expect(row.cancelCharged).toBeNull();

    // Se la visita era nel cargo del mese (stesso mese di oggi), il mese dopo ha il credito.
    if (target.date.month === today().month) {
      const next = addCarePeriods(carePeriodOf(today()), 1);
      await withTenantContext(db, { tenantId: live.owner.tenantId, userId: null }, async (tx) => {
        const job = await loadJobScope(tx, live.owner.tenantId, 'care.charges.issue');
        if (!job) throw new Error('fioreria non attiva');
        return issueNextCareChargeTx(tx, jobWriteScope(job), kit.subscriptionId, { today: next });
      });
      const lines = await withSystemContext(db, { reason: 'test: righe' }, (tx) =>
        tx.careChargeLine.findMany({
          where: { subscriptionId: kit.subscriptionId, kind: 'VISIT_CREDIT', visitId: target.id },
          select: { creditReason: true },
        }),
      );
      expect(lines).toEqual([{ creditReason: 'SHOP' }]);
    }
  });

  it('le visite che nascono dopo nei giorni bloccati seguono la scelta del blocco', async () => {
    // Due fasce dello stesso giorno della settimana; il giorno bloccato è fra due settimane.
    const first = addDays(today(), 3);
    const weekday = dayOfWeek(first);
    const cancelSlot = await nextSlot(live.owner, weekday, 3);
    const moveSlot = await nextSlot(live.owner, weekday, 3);
    const far = addDays(first, 14);
    await block(
      live.owner,
      blockInput(far, far, { slotId: cancelSlot, action: 'CANCEL', label: 'Día cancelado' }),
    );
    await block(live.owner, blockInput(far, far, { slotId: moveSlot, label: 'Día movido' }));
    // I contratti nascono dopo il blocco: le loro visite di quel giorno sono generate adesso.
    const cancelKit = await newContract(live.owner, 'Hotel Después Cancelado', {
      startOffset: 3,
      slotId: cancelSlot,
    });
    const moveKit = await newContract(live.owner, 'Hotel Después Movido', {
      startOffset: 3,
      slotId: moveSlot,
    });
    const atFar = (subscriptionId: string) =>
      withSystemContext(db, { reason: 'test: visita del giorno bloccato' }, (tx) =>
        tx.careVisit.findFirstOrThrow({
          where: { subscriptionId, originalDate: new Date(`${iso(far)}T00:00:00Z`) },
        }),
      );
    expect(await atFar(cancelKit.subscriptionId)).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'SHOP',
      outcomeNote: 'Día cancelado',
    });
    const moved = await atFar(moveKit.subscriptionId);
    expect(['SCHEDULED', 'TO_RESCHEDULE']).toContain(moved.status);
    if (moved.status === 'SCHEDULED') {
      // Mai nella sua fascia bloccata quel giorno, sempre nello stesso mese.
      expect(moved.slotId === moveSlot && iso(dayOf(moved.scheduledDate!)) === iso(far)).toBe(
        false,
      );
      expect(dayOf(moved.scheduledDate!).month).toBe(far.month);
    }
  });
});

describe('bloquear días: impronta, limiti, permessi e isolamento', () => {
  it('se le visite cambiano dopo l’anteprima, si rivede', async () => {
    const kit = await newContract(live.owner, 'Oficina Cambió');
    const target = kit.visits[0]!;
    const input = blockInput(target.date, target.date);
    const preview = await previewCareBlock(live.owner, input);
    // Nel frattempo un'altra persona sposta la visita in un altro giorno.
    await moveCareVisit(live.owner, target.id, {
      placement: 'SLOT',
      date: iso(addDays(target.date, 7)),
      slotId: kit.slotId,
      customerNotified: 'on',
    }).catch(() => undefined);
    const row = await visitRow(target.id);
    if (iso(dayOf(row.scheduledDate!)) !== iso(target.date)) {
      await expect(
        createCareBlock(live.owner, { ...input, plan: preview.plan, customerNotified: 'on' }, deps),
      ).rejects.toMatchObject({ reason: 'care_block_changed' });
    }
    await expect(
      createCareBlock(live.owner, { ...input, plan: 'x', customerNotified: 'on' }, deps),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('date: non nel passato, entro un anno, al massimo 92 giorni', async () => {
    await expect(
      previewCareBlock(live.owner, blockInput(addDays(today(), -1), today())),
    ).rejects.toMatchObject({ fieldErrors: { startDate: 'care_block_past' } });
    await expect(
      previewCareBlock(live.owner, blockInput(addDays(today(), 400), addDays(today(), 401))),
    ).rejects.toMatchObject({ fieldErrors: { startDate: 'care_block_too_far' } });
    await expect(
      previewCareBlock(live.owner, blockInput(today(), addDays(today(), 100))),
    ).rejects.toMatchObject({ fieldErrors: { endDate: 'care_block_too_long' } });
    await expect(
      previewCareBlock(live.owner, {
        ...blockInput(today(), today()),
        slotId: '01a20c3a-0000-7000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ fieldErrors: { slotId: 'invalid_option' } });
  });

  it('lo staff vede i blocchi ma non li crea né li toglie', async () => {
    await expect(listCareBlocks(live.staff)).resolves.toMatchObject({ canWrite: false });
    await expect(previewCareBlock(live.staff, blockInput(today(), today()))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      createCareBlock(live.staff, { ...blockInput(today(), today()), plan: 'x' }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      reassignCareVisits(live.staff, {
        fromMembershipId: live.staff.membershipId,
        toMembershipId: '',
        startDate: iso(today()),
        endDate: iso(today()),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('A↔B: i blocchi e le visite di un’altra fioreria non si toccano (404 + evento)', async () => {
    const theirs = await newContract(other.owner, 'Hotel Ajeno Bloqueo');
    const target = theirs.visits[0]!;
    const { created } = await block(
      other.owner,
      blockInput(target.date, target.date, { label: 'Ajeno' }),
    );
    await expect(getCareBlock(live.owner, created.blockId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeCareBlock(live.owner, created.blockId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      sendCareBlockNotice(live.owner, created.blockId, theirs.subscriptionId, deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    const events = await withSystemContext(db, { reason: 'test: eventi di sicurezza' }, (tx) =>
      tx.auditLog.findMany({
        where: {
          tenantId: null,
          entityId: created.blockId,
          action: 'security.cross_tenant_access_attempt',
        },
      }),
    );
    expect(events.map((event) => event.entityType)).toContain('CareBlock');
    // Un mio blocco di tutto il giorno non tocca le loro visite.
    const mine = await previewCareBlock(live.owner, blockInput(target.date, target.date));
    expect(mine.contracts.map((group) => group.subscriptionId)).not.toContain(
      theirs.subscriptionId,
    );
    expect((await listCareBlocks(live.owner)).current.map((item) => item.id)).not.toContain(
      created.blockId,
    );
  });

  it('un blocco e una prenotazione insieme non si fermano a vicenda', async () => {
    const kit = await newContract(live.owner, 'Oficina Al Mismo Tiempo');
    const target = kit.visits[1]!;
    const input = blockInput(target.date, target.date, { slotId: kit.slotId, label: 'Junta 2' });
    const preview = await previewCareBlock(live.owner, input);
    const results = await Promise.allSettled([
      createCareBlock(live.owner, { ...input, plan: preview.plan, customerNotified: 'on' }, deps),
      moveCareVisit(live.manager, kit.visits[0]!.id, {
        placement: 'SLOT',
        date: iso(addDays(kit.visits[0]!.date, 14)),
        slotId: kit.slotId,
        customerNotified: 'on',
      }),
    ]);
    // Niente stallo: ognuno finisce (il blocco può chiedere di rivedere se lo spostamento è
    // arrivato prima e ha cambiato il piano).
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(
          result.reason instanceof ConflictError || result.reason instanceof ValidationError,
        ).toBe(true);
      }
    }
  });
});

describe('avvisi e cambio di persona', () => {
  it('senza email chiesta all’inizio, "Enviar aviso" lo manda dopo, una volta', async () => {
    const kit = await newContract(live.owner, 'Oficina Aviso Después', { email: true });
    const target = kit.visits[0]!;
    const { created } = await block(
      live.owner,
      blockInput(target.date, target.date, { label: 'Pintura' }),
    );
    expect(created.emails.queued).toBe(0);
    await expect(
      sendCareBlockNotice(live.owner, created.blockId, kit.subscriptionId, deps),
    ).resolves.toBe('sent');
    await expect(
      sendCareBlockNotice(live.owner, created.blockId, kit.subscriptionId, deps),
    ).rejects.toMatchObject({ reason: 'care_email_not_retryable' });
    // In una fioreria demo non si manda.
    const theirs = await newContract(other.owner, 'Hotel Demo Aviso', { email: true });
    const demo = await block(
      other.owner,
      blockInput(theirs.visits[0]!.date, theirs.visits[0]!.date, { label: 'Demo' }),
      { customerNotified: 'on', sendEmail: 'on' },
    );
    expect(demo.created.emails.queued).toBe(0);
    expect(demo.preview.emailsAllowed).toBe(false);
  });

  it('"Alguien no puede ir": le visite di una persona passano a un’altra', async () => {
    const kit = await newContract(live.owner, 'Oficina Persona Enferma');
    const assignees = await listCareAssignees(live.owner);
    const staffMember = assignees.find((member) => member.membershipId === live.staff.membershipId);
    expect(staffMember).toBeDefined();
    for (const visit of kit.visits.slice(0, 2)) {
      await assignCareVisit(live.owner, visit.id, live.staff.membershipId);
    }
    const result = await reassignCareVisits(live.owner, {
      fromMembershipId: live.staff.membershipId,
      toMembershipId: live.manager.membershipId,
      startDate: iso(today()),
      endDate: iso(kit.visits[1]!.date),
    });
    expect(result.count).toBeGreaterThanOrEqual(2);
    for (const visit of kit.visits.slice(0, 2)) {
      expect((await visitRow(visit.id)).assignedMembershipId).toBe(live.manager.membershipId);
    }
    await expect(
      reassignCareVisits(live.owner, {
        fromMembershipId: live.staff.membershipId,
        toMembershipId: other.owner.membershipId,
        startDate: iso(today()),
        endDate: iso(today()),
      }),
    ).rejects.toMatchObject({ fieldErrors: { toMembershipId: 'invalid_option' } });
  });
});

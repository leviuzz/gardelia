/**
 * Import di clienti da un file CSV [CRM-01, ADR-070 blocco 3]: bozza con anteprima, scelta delle
 * colonne, import.
 *
 *  - Solo proprietario e manager (`customers:write`), in tutti i piani (founder, 23/11/2026).
 *  - I clienti importati entrano SENZA consenso marketing: si segna a mano, uno per uno.
 *  - La bozza tiene il testo del file finché non si importa o si annulla; poi si svuota e restano
 *    i conti. Una nuova bozza chiude quelle aperte della stessa persona e quelle di più di un giorno.
 *  - Anteprima e import rifanno gli stessi controlli: righe valide come nel modulo "Nuevo cliente",
 *    duplicati per telefono o email (clienti della fioreria, anche archiviati, o righe precedenti).
 *  - Nel registro una voce per import con i soli conti: nessun dato dei clienti.
 */
import { getDb, withTenantContext, type Prisma, type TransactionClient } from '@floral/db';
import {
  AUDIT_ACTIONS,
  CUSTOMER_IMPORT_LIMITS,
  customerImportMappingSchema,
  findCustomerImportDuplicates,
  isBlankRow,
  isUuid,
  parseCsv,
  readCustomerImportRows,
  suggestCustomerImportMapping,
  toFieldErrors,
  type CustomerImportCandidate,
  type CustomerImportDuplicate,
  type CustomerImportField,
  type CustomerImportMapping,
  type ExistingCustomerContact,
  type FieldErrors,
} from '@floral/domain';
import { notFound, recordAudit } from '../audit';
import { requirePermission } from '../authorization';
import type { TenantContext } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { uuidv7 } from '../ids';

/** Le bozze più vecchie di così si chiudono alla bozza successiva. */
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type CustomerImportStatus = 'DRAFT' | 'DONE' | 'CANCELLED';

export interface CustomerImportColumn {
  readonly index: number;
  readonly header: string;
  /** Il primo valore non vuoto della colonna, per riconoscerla. */
  readonly sample: string | null;
  readonly field: CustomerImportField | null;
}

export interface CustomerImportProblem {
  readonly line: number;
  readonly displayName: string;
  /** Riga non valida: campo → codice. */
  readonly errors: FieldErrors | null;
  /** Riga valida ma già presente. */
  readonly duplicate: CustomerImportDuplicate | null;
}

export interface CustomerImportSample {
  readonly line: number;
  readonly displayName: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly tags: readonly string[];
  readonly occasions: number;
}

export interface CustomerImportPreview {
  readonly id: string;
  readonly fileName: string;
  readonly status: CustomerImportStatus;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly rowCount: number;
  readonly importedCount: number;
  readonly skippedCount: number;
  /** Solo per le bozze. */
  readonly columns: readonly CustomerImportColumn[];
  /** Colonne da sistemare (manca il nome, dato ripetuto): niente conti finché ci sono. */
  readonly mappingErrors: FieldErrors | null;
  readonly summary: {
    readonly ready: number;
    readonly invalid: number;
    readonly duplicates: number;
  } | null;
  /** Le prime righe con problemi (al massimo 100). */
  readonly problems: readonly CustomerImportProblem[];
  /** Le prime righe che si importeranno, come esempio. */
  readonly samples: readonly CustomerImportSample[];
}

function cleanFileName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/[\r\n\t]/g, ' ').trim() : '';
  return (name || 'clientes.csv').slice(0, CUSTOMER_IMPORT_LIMITS.fileName);
}

/** Intestazione e righe di dati del testo salvato. */
function splitFile(content: string) {
  const [header = [], ...dataRows] = parseCsv(content);
  return { header, dataRows };
}

function storedMapping(value: Prisma.JsonValue): (string | null)[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : null)) : [];
}

type MappingResult =
  | { readonly ok: true; readonly mapping: CustomerImportMapping }
  | { readonly ok: false; readonly errors: FieldErrors };

function checkMapping(raw: readonly unknown[], columnCount: number): MappingResult {
  const parsed = customerImportMappingSchema(columnCount).safeParse(raw);
  if (parsed.success) return { ok: true, mapping: parsed.data };
  const errors: Record<string, string> = {};
  for (const [key, code] of Object.entries(toFieldErrors(parsed.error))) {
    if (code) errors[key === '_form' ? '_form' : `column.${key}`] = code;
  }
  return { ok: false, errors };
}

/** Clienti della fioreria (anche archiviati) con lo stesso telefono o email delle righe. */
async function existingContacts(
  tx: TransactionClient,
  ctx: TenantContext,
  candidates: readonly CustomerImportCandidate[],
): Promise<ExistingCustomerContact[]> {
  const phones = [...new Set(candidates.flatMap(({ customer }) => customer.phone ?? []))];
  const emails = [...new Set(candidates.flatMap(({ customer }) => customer.email ?? []))];
  const conditions: Prisma.CustomerWhereInput[] = [
    ...(phones.length > 0 ? [{ phone: { in: phones } }] : []),
    ...(emails.length > 0 ? [{ email: { in: emails, mode: 'insensitive' as const } }] : []),
  ];
  if (conditions.length === 0) return [];
  return tx.customer.findMany({
    where: { tenantId: ctx.tenantId, OR: conditions },
    select: { id: true, displayName: true, phone: true, email: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Righe valide, non valide e duplicate del file con le colonne scelte. */
async function evaluate(
  tx: TransactionClient,
  ctx: TenantContext,
  dataRows: readonly (readonly string[])[],
  mapping: CustomerImportMapping,
) {
  const rows = readCustomerImportRows(dataRows, mapping, ctx.country);
  const candidates = rows.flatMap((row) => (row.kind === 'ok' ? [row] : []));
  const duplicates = findCustomerImportDuplicates(
    candidates,
    await existingContacts(tx, ctx, candidates),
  );
  const ready = candidates.filter((candidate) => !duplicates.has(candidate.line));
  return { rows, candidates, duplicates, ready };
}

/**
 * Nuova bozza da un file: controlli di dimensione, righe e colonne, colonne riconosciute dai nomi.
 * `content` è il testo già decodificato (`decodeCsvBytes`).
 */
export async function createCustomerImport(
  ctx: TenantContext,
  input: { readonly fileName: unknown; readonly content: unknown },
): Promise<{ id: string }> {
  requirePermission(ctx, 'customers:write');
  const content = typeof input.content === 'string' ? input.content : '';
  if (content.length > CUSTOMER_IMPORT_LIMITS.bytes) {
    throw new ValidationError({ file: 'customers_import_too_big' });
  }
  const { header, dataRows } = splitFile(content);
  const rowCount = dataRows.filter((cells) => !isBlankRow(cells)).length;
  if (isBlankRow(header) || rowCount === 0) {
    throw new ValidationError({ file: 'customers_import_empty' });
  }
  if (header.length > CUSTOMER_IMPORT_LIMITS.columns) {
    throw new ValidationError({ file: 'customers_import_too_many_columns' });
  }
  if (rowCount > CUSTOMER_IMPORT_LIMITS.rows) {
    throw new ValidationError({ file: 'customers_import_too_many_rows' });
  }
  const now = new Date();
  return withTenantContext(getDb(), ctx, async (tx) => {
    // Le bozze aperte della persona e quelle dimenticate da più di un giorno si chiudono: il testo
    // dei file non resta in giro.
    await tx.customerImport.updateMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'DRAFT',
        OR: [
          { createdById: ctx.userId },
          { createdAt: { lt: new Date(now.getTime() - DRAFT_TTL_MS) } },
        ],
      },
      data: { status: 'CANCELLED', content: '', completedAt: now },
    });
    const created = await tx.customerImport.create({
      data: {
        tenantId: ctx.tenantId,
        fileName: cleanFileName(input.fileName),
        content,
        mapping: suggestCustomerImportMapping(header),
        rowCount,
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    return { id: created.id };
  });
}

/** Anteprima di una bozza (o il risultato di un import concluso). */
export async function getCustomerImport(
  ctx: TenantContext,
  importId: string,
): Promise<CustomerImportPreview> {
  requirePermission(ctx, 'customers:write');
  if (!isUuid(importId)) throw new NotFoundError('CustomerImport');
  const preview = await withTenantContext(getDb(), ctx, async (tx) => {
    const draft = await tx.customerImport.findFirst({
      where: { id: importId, tenantId: ctx.tenantId },
    });
    if (!draft) return null;
    const base = {
      id: draft.id,
      fileName: draft.fileName,
      status: draft.status,
      createdAt: draft.createdAt,
      completedAt: draft.completedAt,
      rowCount: draft.rowCount,
      importedCount: draft.importedCount,
      skippedCount: draft.skippedCount,
    };
    if (draft.status !== 'DRAFT') {
      return {
        ...base,
        columns: [],
        mappingErrors: null,
        summary: null,
        problems: [],
        samples: [],
      } satisfies CustomerImportPreview;
    }

    const { header, dataRows } = splitFile(draft.content);
    const raw = storedMapping(draft.mapping);
    const columns = header.map((name, index) => {
      const sample = dataRows.map((cells) => (cells[index] ?? '').trim()).find(Boolean) ?? null;
      const field = raw[index] ?? null;
      return {
        index,
        header: name,
        sample: sample ? sample.slice(0, 60) : null,
        field: (field as CustomerImportField | null) ?? null,
      };
    });
    const checked = checkMapping(
      header.map((_, index) => raw[index] ?? null),
      header.length,
    );
    if (!checked.ok) {
      return {
        ...base,
        columns,
        mappingErrors: checked.errors,
        summary: null,
        problems: [],
        samples: [],
      } satisfies CustomerImportPreview;
    }

    const { rows, duplicates, ready } = await evaluate(tx, ctx, dataRows, checked.mapping);
    const problems: CustomerImportProblem[] = [];
    for (const row of rows) {
      if (problems.length >= CUSTOMER_IMPORT_LIMITS.problemsShown) break;
      if (row.kind === 'invalid') {
        problems.push({
          line: row.line,
          displayName: row.displayName,
          errors: row.errors,
          duplicate: null,
        });
        continue;
      }
      const duplicate = duplicates.get(row.line);
      if (duplicate) {
        problems.push({
          line: row.line,
          displayName: row.customer.displayName,
          errors: null,
          duplicate,
        });
      }
    }
    return {
      ...base,
      columns,
      mappingErrors: null,
      summary: {
        ready: ready.length,
        invalid: rows.filter((row) => row.kind === 'invalid').length,
        duplicates: duplicates.size,
      },
      problems,
      samples: ready.slice(0, CUSTOMER_IMPORT_LIMITS.samplesShown).map((row) => ({
        line: row.line,
        displayName: row.customer.displayName,
        phone: row.customer.phone,
        email: row.customer.email,
        tags: row.customer.tags,
        occasions: row.occasions.length,
      })),
    } satisfies CustomerImportPreview;
  });
  if (!preview) return notFound(ctx, 'CustomerImport', importId);
  return preview;
}

/** Bozza aperta della fioreria, bloccata fino alla fine della transazione (doppio clic). */
async function lockDraft(tx: TransactionClient, ctx: TenantContext, importId: string) {
  await tx.$queryRaw`SELECT id FROM "CustomerImport" WHERE id = ${importId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR UPDATE`;
  const draft = await tx.customerImport.findFirst({
    where: { id: importId, tenantId: ctx.tenantId },
  });
  if (draft && draft.status !== 'DRAFT') throw new ConflictError('customers_import_closed');
  return draft;
}

/**
 * Colonne scelte dalla persona: `{ column: { "0": "displayName", "1": "", … } }` come arriva dal
 * modulo (una select per colonna). Errori sulle colonne (`column.N`) o sul modulo (`_form`).
 */
export async function updateCustomerImportMapping(
  ctx: TenantContext,
  importId: string,
  rawInput: unknown,
): Promise<void> {
  requirePermission(ctx, 'customers:write');
  if (!isUuid(importId)) throw new NotFoundError('CustomerImport');
  const columnsInput =
    rawInput && typeof rawInput === 'object' && 'column' in rawInput
      ? (rawInput as { column: unknown }).column
      : null;
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const draft = await lockDraft(tx, ctx, importId);
    if (!draft) return false;
    const { header } = splitFile(draft.content);
    const raw = header.map((_, index) =>
      columnsInput && typeof columnsInput === 'object'
        ? ((columnsInput as Record<string, unknown>)[String(index)] ?? null)
        : null,
    );
    const checked = checkMapping(raw, header.length);
    if (!checked.ok) throw new ValidationError(checked.errors);
    await tx.customerImport.updateMany({
      where: { id: draft.id, tenantId: ctx.tenantId },
      data: { mapping: [...checked.mapping] },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CustomerImport', importId);
}

/**
 * Importa le righe valide e non duplicate (ricontrollate adesso, non quelle dell'anteprima):
 * clienti con origine IMPORT e senza consenso marketing, con le loro date speciali.
 */
export async function confirmCustomerImport(
  ctx: TenantContext,
  importId: string,
): Promise<{ readonly imported: number; readonly skipped: number }> {
  requirePermission(ctx, 'customers:write');
  if (!isUuid(importId)) throw new NotFoundError('CustomerImport');
  const result = await withTenantContext(getDb(), ctx, async (tx) => {
    const draft = await lockDraft(tx, ctx, importId);
    if (!draft) return null;
    const { header, dataRows } = splitFile(draft.content);
    const checked = checkMapping(
      header.map((_, index) => storedMapping(draft.mapping)[index] ?? null),
      header.length,
    );
    if (!checked.ok) throw new ValidationError(checked.errors);
    const { rows, ready } = await evaluate(tx, ctx, dataRows, checked.mapping);
    if (ready.length === 0) throw new ConflictError('customers_import_nothing');

    const withIds = ready.map((row) => ({ ...row, id: uuidv7() }));
    await tx.customer.createMany({
      data: withIds.map(({ id, customer }) => ({
        id,
        tenantId: ctx.tenantId,
        type: customer.type,
        displayName: customer.displayName,
        legalName: customer.legalName,
        taxId: customer.taxId,
        email: customer.email,
        phone: customer.phone,
        notes: customer.notes,
        preferences: customer.preferences,
        restrictions: customer.restrictions,
        tags: [...customer.tags],
        acquisitionChannel: null,
        acquisitionSource: 'IMPORT',
        // Decisione del founder: il consenso non arriva da un file.
        marketingConsent: false,
        marketingConsentAt: null,
      })),
    });
    const occasions = withIds.flatMap(({ id, occasions: list }) =>
      list.map((occasion) => ({ tenantId: ctx.tenantId, customerId: id, ...occasion })),
    );
    if (occasions.length > 0) await tx.customerOccasion.createMany({ data: occasions });

    const skipped = rows.length - ready.length;
    const now = new Date();
    await tx.customerImport.updateMany({
      where: { id: draft.id, tenantId: ctx.tenantId },
      data: {
        status: 'DONE',
        content: '',
        importedCount: ready.length,
        skippedCount: skipped,
        completedAt: now,
      },
    });
    await recordAudit(tx, ctx, {
      action: AUDIT_ACTIONS.customersImported,
      entityType: 'CustomerImport',
      entityId: draft.id,
      metadata: { count: ready.length, skipped, occasions: occasions.length },
    });
    return { imported: ready.length, skipped };
  });
  if (!result) return notFound(ctx, 'CustomerImport', importId);
  return result;
}

/** "Cancelar": la bozza si chiude e il testo del file si cancella. */
export async function cancelCustomerImport(ctx: TenantContext, importId: string): Promise<void> {
  requirePermission(ctx, 'customers:write');
  if (!isUuid(importId)) throw new NotFoundError('CustomerImport');
  const found = await withTenantContext(getDb(), ctx, async (tx) => {
    const draft = await lockDraft(tx, ctx, importId);
    if (!draft) return false;
    await tx.customerImport.updateMany({
      where: { id: draft.id, tenantId: ctx.tenantId },
      data: { status: 'CANCELLED', content: '', completedAt: new Date() },
    });
    return true;
  });
  if (!found) await notFound(ctx, 'CustomerImport', importId);
}

/** La bozza aperta della persona (di meno di un giorno), per riprenderla. */
export async function findOpenCustomerImport(
  ctx: TenantContext,
): Promise<{ readonly id: string; readonly fileName: string; readonly createdAt: Date } | null> {
  requirePermission(ctx, 'customers:write');
  return withTenantContext(getDb(), ctx, (tx) =>
    tx.customerImport.findFirst({
      where: {
        tenantId: ctx.tenantId,
        createdById: ctx.userId,
        status: 'DRAFT',
        createdAt: { gte: new Date(Date.now() - DRAFT_TTL_MS) },
      },
      select: { id: true, fileName: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

/**
 * Manutenzione giornaliera (ADR-070): chiude in tutte le fiorerie le bozze dimenticate da più di un
 * giorno e ne cancella il file (funzione SQL `app_close_stale_customer_imports`). Idempotente.
 */
export async function closeStaleCustomerImports(): Promise<number> {
  const rows = await getDb().$queryRaw<{ closed: number }[]>`
    SELECT app_close_stale_customer_imports() AS closed`;
  return rows[0]?.closed ?? 0;
}

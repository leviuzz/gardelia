import 'server-only';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { TenantContext } from '@floral/core';
import type { ActionState } from './action-state';
import { actionError } from './actions';
import { tenantRoutes, type TenantRoutes } from './routes';
import { getTenantContext } from './tenant';

/**
 * Ossatura unica delle server action sotto /app/[tenantSlug] (fase 0, PLATFORM_PLAN §5).
 *
 * Ogni azione scrive solo il suo lavoro (validare, chiamare il servizio) e dice cosa succede
 * dopo; il resto è uguale per tutte e sta qui:
 *  1. contesto della fioreria dallo slug (sessione + membership attiva), PRIMA di tutto: senza
 *     sessione si va al login, chi non è membro riceve 404;
 *  2. errori del servizio → stato mostrabile nel form (validazione per campo, conflitti, permessi,
 *     piano); gli errori inattesi finiscono nel log con l'ID della richiesta;
 *  3. solo se il lavoro riesce: pagine da ricaricare, eventuale redirect, messaggio del toast.
 *
 * Gli argomenti legati con `.bind()` arrivano dal client: non sono affidabili, li ricontrolla il
 * servizio (permessi e fioreria).
 */

/** Pagina da ricaricare (un percorso) o intera sezione: il layout e tutte le pagine sotto. */
export type RevalidateTarget = string | { readonly section: string };

/** Ricarica il layout del percorso e tutte le pagine sotto (es. elenco e dettagli del catalogo). */
export function section(path: string): RevalidateTarget {
  return { section: path };
}

export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string;

/**
 * Messaggio per l'utente: una chiave di `messages/es-MX.json` con il percorso completo
 * (es. `'common.changesSaved'`) oppure una funzione che compone il testo con il traduttore.
 */
export type MessageSpec = string | ((t: Translate) => string);

/** Cosa succede dopo un lavoro riuscito. */
export interface ActionOutcome {
  readonly revalidate?: RevalidateTarget | readonly RevalidateTarget[];
  /** Pagina da aprire (es. il dettaglio appena creato). */
  readonly redirectTo?: string;
  /** Toast di successo. */
  readonly success?: MessageSpec;
  /**
   * Fatto, ma con un problema da mostrare come errore (es. invito creato ma email non partita).
   * Le pagine si ricaricano comunque: la modifica c'è.
   */
  readonly warning?: MessageSpec;
}

export interface TenantActionScope {
  readonly ctx: TenantContext;
  /** Percorsi della fioreria del contesto (mai dello slug ricevuto dal client). */
  readonly routes: TenantRoutes;
}

export type TenantActionWork = (scope: TenantActionScope) => Promise<ActionOutcome>;

/** Dipendenze del runner: quelle vere in produzione, finte nei test. */
export interface TenantActionDeps {
  readonly resolveContext: (slug: string) => Promise<TenantContext>;
  readonly toErrorState: (error: unknown) => Promise<ActionState>;
  readonly revalidate: (path: string, type?: 'layout') => void;
  readonly redirect: (path: string) => never;
  readonly translator: () => Promise<Translate>;
}

function asList(targets: ActionOutcome['revalidate']): readonly RevalidateTarget[] {
  if (targets === undefined) return [];
  if (Array.isArray(targets)) return targets as readonly RevalidateTarget[];
  return [targets as RevalidateTarget];
}

function render(spec: MessageSpec, t: Translate): string {
  return typeof spec === 'string' ? t(spec) : spec(t);
}

/** Dipendenze comuni a ogni server action dopo il contesto (anche quelle del conto cliente). */
export type OutcomeDeps = Omit<TenantActionDeps, 'resolveContext'>;

/**
 * Esegue il lavoro e applica l'esito: errori → stato del form, poi pagine da ricaricare, redirect e
 * messaggio. Il contesto si risolve PRIMA, fuori da qui.
 */
export async function settleAction(
  deps: OutcomeDeps,
  work: () => Promise<ActionOutcome>,
): Promise<ActionState> {
  let outcome: ActionOutcome;
  try {
    outcome = await work();
  } catch (error) {
    return deps.toErrorState(error);
  }
  for (const target of asList(outcome.revalidate)) {
    if (typeof target === 'string') deps.revalidate(target);
    else deps.revalidate(target.section, 'layout');
  }
  if (outcome.redirectTo) deps.redirect(outcome.redirectTo);
  if (outcome.warning) {
    return { status: 'error', message: render(outcome.warning, await deps.translator()) };
  }
  if (outcome.success) {
    return { status: 'success', message: render(outcome.success, await deps.translator()) };
  }
  return { status: 'success' };
}

/** Il runner con le dipendenze esplicite (testabile senza Next.js né database). */
export async function executeTenantAction(
  deps: TenantActionDeps,
  slug: string,
  work: TenantActionWork,
): Promise<ActionState> {
  // Fuori dal try: il redirect al login e il 404 di Next devono propagarsi così come sono.
  const ctx = await deps.resolveContext(slug);
  return settleAction(deps, () => work({ ctx, routes: tenantRoutes(ctx.tenantSlug) }));
}

const nextDeps: TenantActionDeps = {
  resolveContext: getTenantContext,
  toErrorState: actionError,
  revalidate: (path, type) => revalidatePath(path, type),
  redirect: (path) => redirect(path),
  translator: async () => {
    const t = await getTranslations();
    return (key, values) => t(key, values);
  },
};

/**
 * Esegue una server action della fioreria. Uso:
 *
 *   export async function updateItemAction(slug: string, itemId: string, _prev: ActionState,
 *                                          formData: FormData): Promise<ActionState> {
 *     return runTenantAction(slug, async ({ ctx, routes }) => {
 *       await updateCatalogItem(ctx, itemId, parseForm(schema, formData));
 *       return { revalidate: section(routes.catalog.list()), success: 'common.changesSaved' };
 *     });
 *   }
 */
export function runTenantAction(slug: string, work: TenantActionWork): Promise<ActionState> {
  return executeTenantAction(nextDeps, slug, work);
}

/** Le dipendenze vere, per gli altri runner (es. il conto cliente, `buyer-action.ts`). */
export const nextOutcomeDeps: OutcomeDeps = nextDeps;

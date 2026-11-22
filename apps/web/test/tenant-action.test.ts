import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ValidationError, type TenantContext } from '@floral/core';
import { parseForm } from '@/lib/form-data';
import {
  executeTenantAction,
  section,
  type ActionOutcome,
  type TenantActionDeps,
} from '@/lib/tenant-action';

// Il contesto vero passa da sessione e database: qui lo sostituisce `resolveContext`.
vi.mock('@/lib/tenant', () => ({ getTenantContext: vi.fn() }));

const ctx = { tenantId: 't-1', tenantSlug: 'las-camelias' } as unknown as TenantContext;

class RedirectSignal extends Error {}

function fakeDeps(overrides: Partial<TenantActionDeps> = {}) {
  const calls: string[] = [];
  const translator = vi.fn(
    async () => (key: string, values?: Readonly<Record<string, unknown>>) =>
      values ? `${key} ${JSON.stringify(values)}` : `«${key}»`,
  );
  const deps: TenantActionDeps = {
    resolveContext: async (slug) => {
      calls.push(`context ${slug}`);
      return ctx;
    },
    toErrorState: async (error) => {
      calls.push('error');
      return { status: 'error', message: `tradotto: ${(error as Error).message}` };
    },
    revalidate: (path, type) => {
      calls.push(type ? `revalidate ${path} (${type})` : `revalidate ${path}`);
    },
    redirect: (path) => {
      calls.push(`redirect ${path}`);
      throw new RedirectSignal(path);
    },
    translator,
    ...overrides,
  };
  return { deps, calls, translator };
}

const run = (deps: TenantActionDeps, outcome: ActionOutcome) =>
  executeTenantAction(deps, 'las-camelias', async () => outcome);

describe('ossatura delle server action (runTenantAction)', () => {
  it('risolve il contesto PRIMA del lavoro; i percorsi sono quelli della fioreria del contesto', async () => {
    const { deps, calls } = fakeDeps();
    let seenHome = '';
    await executeTenantAction(deps, 'las-camelias', async ({ ctx: received, routes }) => {
      calls.push(`work ${received.tenantId}`);
      seenHome = routes.home;
      return {};
    });
    expect(calls).toEqual(['context las-camelias', 'work t-1']);
    expect(seenHome).toBe('/app/las-camelias');
  });

  it('senza sessione o fuori dalla fioreria (redirect / 404 di Next) il lavoro non parte', async () => {
    const notFound = new Error('NEXT_HTTP_ERROR_FALLBACK;404');
    const work = vi.fn(async () => ({}));
    const { deps, calls } = fakeDeps({
      resolveContext: async () => {
        throw notFound;
      },
    });
    await expect(executeTenantAction(deps, 'altra', work)).rejects.toBe(notFound);
    expect(work).not.toHaveBeenCalled();
    expect(calls).toEqual([]); // né traduzione dell'errore né revalidate
  });

  it('un errore del lavoro diventa lo stato del form, senza ricaricare né cambiare pagina', async () => {
    const { deps, calls } = fakeDeps();
    const state = await executeTenantAction(deps, 'las-camelias', async () => {
      throw new Error('conflitto');
    });
    expect(state).toEqual({ status: 'error', message: 'tradotto: conflitto' });
    expect(calls).toEqual(['context las-camelias', 'error']);
  });

  it('successo: ricarica pagine e sezioni nell’ordine dato, poi il toast tradotto', async () => {
    const { deps, calls } = fakeDeps();
    const state = await run(deps, {
      revalidate: ['/app/las-camelias/customers/c1', section('/app/las-camelias')],
      success: 'customers.occasions.added',
    });
    expect(calls).toEqual([
      'context las-camelias',
      'revalidate /app/las-camelias/customers/c1',
      'revalidate /app/las-camelias (layout)',
    ]);
    expect(state).toEqual({ status: 'success', message: '«customers.occasions.added»' });
  });

  it('un solo percorso o una sola sezione vanno bene anche senza array', async () => {
    const { deps, calls } = fakeDeps();
    await run(deps, { revalidate: section('/app/las-camelias/catalog') });
    await run(deps, { revalidate: '/app/las-camelias/quotes' });
    expect(calls.filter((call) => call.startsWith('revalidate'))).toEqual([
      'revalidate /app/las-camelias/catalog (layout)',
      'revalidate /app/las-camelias/quotes',
    ]);
  });

  it('redirect solo dopo aver ricaricato le pagine', async () => {
    const { deps, calls } = fakeDeps();
    await expect(
      run(deps, {
        revalidate: '/app/las-camelias/catalog',
        redirectTo: '/app/las-camelias/catalog/i1?created=1',
        success: 'common.changesSaved',
      }),
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(calls).toEqual([
      'context las-camelias',
      'revalidate /app/las-camelias/catalog',
      'redirect /app/las-camelias/catalog/i1?created=1',
    ]);
  });

  it('avviso: la modifica c’è (pagine ricaricate) ma il toast è un errore', async () => {
    const { deps, calls } = fakeDeps();
    const state = await run(deps, {
      revalidate: '/app/las-camelias/settings/team',
      warning: 'team.invitedNoEmail',
    });
    expect(state).toEqual({ status: 'error', message: '«team.invitedNoEmail»' });
    expect(calls).toContain('revalidate /app/las-camelias/settings/team');
  });

  it('messaggio composto con il traduttore (valori e chiavi annidate)', async () => {
    const { deps } = fakeDeps();
    const state = await run(deps, {
      success: (t) => t('quotes.editor.statusChanged', { status: t('quotes.statuses.SENT') }),
    });
    expect(state).toEqual({
      status: 'success',
      message: 'quotes.editor.statusChanged {"status":"«quotes.statuses.SENT»"}',
    });
  });

  it('senza messaggio: successo senza toast e senza caricare le traduzioni', async () => {
    const { deps, translator } = fakeDeps();
    expect(await run(deps, { revalidate: '/app/las-camelias/builder/references' })).toEqual({
      status: 'success',
    });
    expect(translator).not.toHaveBeenCalled();
  });
});

describe('parseForm', () => {
  const schema = z.object({ name: z.string().min(1, 'required'), tags: z.array(z.string()) });

  it('restituisce i dati validati (campi multipli come array)', () => {
    const form = new FormData();
    form.set('name', 'Rosa');
    form.append('tags', 'roja');
    form.append('tags', 'grande');
    expect(parseForm(schema, form, ['tags'])).toEqual({ name: 'Rosa', tags: ['roja', 'grande'] });
  });

  it('input non valido → ValidationError con i codici per campo', () => {
    const form = new FormData();
    form.set('name', '');
    try {
      parseForm(schema, form, ['tags']);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors).toMatchObject({ name: 'required' });
    }
  });
});

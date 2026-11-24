// @vitest-environment happy-dom
import { startTransition, use, useActionState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fieldError, idleState, type ActionState } from '@/lib/action-state';
import { useActionToast, useToastActionState } from '@/lib/use-action-toast';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// I testi arrivano dal provider dell'app: qui basta la chiave.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

/**
 * Gli hook dei toast con React vero (happy-dom) e un rendering lento: l'errore accanto al campo
 * arriva nel DOM molti frame dopo la fine dell'azione, come su un telefono lento o in CI. Prima
 * il controllo "è già visibile?" aspettava due frame e mostrava lo stesso messaggio anche come
 * toast (visto nell'E2E delle fasce di consegna).
 */

const SHOWN = 'Indica la hora de inicio y la de fin, en orden.';
const NOT_SHOWN = 'Elige un cliente.';
const SUMMARY = 'Revisa los datos marcados.';
/** Il commit del nuovo stato arriva dopo ~100 ms: decine di frame di happy-dom. */
const RENDER_DELAY_MS = 100;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('condizione mai raggiunta');
    await wait(5);
  }
}

function errorState(fieldErrors: Record<string, string>): ActionState {
  return { status: 'error', message: SUMMARY, fieldErrors };
}

/** Errore accanto al campo che si disegna solo quando `renderDone` si risolve. */
function SlowFieldError({
  message,
  renderDone,
}: {
  readonly message: string | undefined;
  readonly renderDone: Promise<void>;
}) {
  if (message) use(renderDone);
  return message ? <p id="window-end-error">{message}</p> : null;
}

interface FormProps {
  readonly action: () => Promise<ActionState>;
  readonly renderDone: Promise<void>;
}

/** Form con `useToastActionState` (toast emesso alla fine dell'azione, prima del re-render). */
function ToastStateForm({ action, renderDone }: FormProps) {
  const [state, dispatch] = useToastActionState(action);
  return (
    <div>
      <button type="button" onClick={() => startTransition(() => dispatch(new FormData()))}>
        Agregar
      </button>
      <SlowFieldError message={fieldError(state, 'end')} renderDone={renderDone} />
    </div>
  );
}

/** Form con `useActionState` + `useActionToast` (toast emesso in un effetto). */
function EffectToastForm({ action, renderDone }: FormProps) {
  const [state, dispatch] = useActionState(action, idleState);
  useActionToast(state);
  return (
    <div>
      <button type="button" onClick={() => startTransition(() => dispatch())}>
        Agregar
      </button>
      <SlowFieldError message={fieldError(state, 'end')} renderDone={renderDone} />
    </div>
  );
}

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(() => {
  if (mounted) root.unmount();
  container.remove();
});

/** Monta il form, preme il pulsante e aspetta che l'errore accanto al campo sia nel DOM. */
async function submitWithSlowRender(Form: typeof ToastStateForm, result: ActionState) {
  root.render(<Form action={async () => result} renderDone={wait(RENDER_DELAY_MS)} />);
  await until(() => container.querySelector('button') !== null);
  container.querySelector('button')!.click();
  await until(() => document.body.innerText.includes(SHOWN));
  // Qualche frame in più: un toast in ritardo avrebbe il tempo di partire.
  await wait(50);
}

describe.each([
  ['useToastActionState', ToastStateForm],
  ['useActionToast', EffectToastForm],
])('%s con un rendering lento', (_name, Form) => {
  it("l'errore mostrato accanto al campo non diventa anche un toast", async () => {
    await submitWithSlowRender(Form, errorState({ end: SHOWN }));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('un errore senza campo sulla pagina diventa un toast, solo con quel messaggio', async () => {
    await submitWithSlowRender(Form, errorState({ end: SHOWN, customerId: NOT_SHOWN }));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(`${SUMMARY} ${NOT_SHOWN}`);
  });
});

describe('useToastActionState: il form sparisce prima del commit', () => {
  it("l'errore non resta muto", async () => {
    let finished = false;
    const action = async () => {
      finished = true;
      return errorState({ end: SHOWN });
    };
    // Il rendering non finisce mai: il form si smonta mentre React aspetta.
    root.render(<ToastStateForm action={action} renderDone={new Promise(() => {})} />);
    await until(() => container.querySelector('button') !== null);
    container.querySelector('button')!.click();
    await until(() => finished);
    await wait(20);
    expect(toast.error).not.toHaveBeenCalled();

    root.unmount();
    mounted = false;
    await until(() => vi.mocked(toast.error).mock.calls.length > 0);
    expect(toast.error).toHaveBeenCalledWith(SHOWN);
  });
});

describe('useToastActionState: successo', () => {
  it('il toast di successo parte alla fine dell’azione', async () => {
    root.render(
      <ToastStateForm
        action={async () => ({ status: 'success', message: 'Franja agregada.' })}
        renderDone={Promise.resolve()}
      />,
    );
    await until(() => container.querySelector('button') !== null);
    container.querySelector('button')!.click();
    await until(() => vi.mocked(toast.success).mock.calls.length > 0);
    expect(toast.success).toHaveBeenCalledWith('Franja agregada.');
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('useToastActionState: pagina rimasta alla versione precedente', () => {
  it("niente pagina d'errore: il form resta e un avviso offre di ricaricare", async () => {
    // L'errore che Next lancia nel browser quando il server non conosce più l'azione.
    const stale = Object.assign(new Error('Server Action "70a1" was not found on the server.'), {
      name: 'UnrecognizedActionError',
    });
    root.render(
      <ToastStateForm
        action={async () => {
          throw stale;
        }}
        renderDone={Promise.resolve()}
      />,
    );
    await until(() => container.querySelector('button') !== null);
    container.querySelector('button')!.click();
    await until(() => vi.mocked(toast.error).mock.calls.length > 0);
    expect(toast.error).toHaveBeenCalledWith(
      'toast',
      expect.objectContaining({
        id: 'stale-version',
        action: expect.objectContaining({ label: 'reload' }),
      }),
    );
    // Il form è ancora lì (nessun confine d'errore ha preso il posto del componente).
    expect(container.querySelector('button')?.textContent).toBe('Agregar');
  });
});

import { Flower2, MessageCircle } from 'lucide-react';
import { BRAND, whatsappLink } from '@floral/domain';
import { Button } from '@/components/ui/button';

/**
 * Cornice delle pagine aperte dal cliente senza account (link pubblici, disiscrizione): nome
 * della fioreria in alto, contenuto, contatto WhatsApp con la fioreria e firma del prodotto.
 */
export function PublicShell({
  shopName,
  contact,
  footer,
  children,
}: {
  readonly shopName: string;
  /** Pulsante "Escribir a la florería" (null se la fioreria non ha telefono). */
  readonly contact: {
    readonly phone: string;
    readonly text: string;
    readonly label: string;
  } | null;
  readonly footer: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.025_150),transparent_60%)]">
      <main className="mx-auto w-full max-w-2xl px-4 pt-10 pb-16">
        <p className="mb-6 flex items-center gap-2 text-sm font-medium tracking-wide text-primary uppercase">
          <Flower2 className="size-4" aria-hidden="true" />
          {shopName}
        </p>
        <div className="space-y-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-8">{children}</div>
        {contact ? (
          <div className="mt-6 flex justify-center">
            <Button asChild variant="outline">
              <a
                href={whatsappLink(contact.phone, contact.text)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle />
                {contact.label}
              </a>
            </Button>
          </div>
        ) : null}
        <p className="mt-6 text-center text-xs text-muted-foreground">{footer}</p>
      </main>
    </div>
  );
}

/** Messaggio di link non valido, scaduto o disattivato. */
export function PublicInvalidLink({
  title,
  body,
  footer,
}: {
  readonly title: string;
  readonly body: string;
  readonly footer: string;
}) {
  return (
    <PublicShell shopName={BRAND.productName} contact={null} footer={footer}>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </PublicShell>
  );
}

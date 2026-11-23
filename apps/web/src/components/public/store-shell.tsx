import { Flower2, MessageCircle, Phone, TriangleExclamationPoint } from 'lucide-react';
import Link from 'next/link';
import { LegalLinks } from '@/components/legal/legal-links';
import { Button } from '@/components/ui/button';

/**
 * Cornice della pagina pubblica della fioreria (ADR-065): nome in alto, contatti, contenuto e
 * firma del prodotto. I testi arrivano già tradotti nella lingua del mercato della fioreria.
 */
export function StoreShell({
  name,
  logoSrc,
  homeHref,
  demoNotice,
  contact,
  footer,
  locale,
  children,
}: {
  readonly name: string;
  /** Logo della fioreria (piccolo, accanto al nome), o null. */
  readonly logoSrc: string | null;
  readonly homeHref: string;
  /** Avviso per una fioreria di prova (null per quelle vere). */
  readonly demoNotice: string | null;
  readonly contact: {
    readonly whatsappHref: string;
    readonly whatsappLabel: string;
    readonly callHref: string;
    readonly callLabel: string;
  } | null;
  readonly footer: string;
  /** Lingua del mercato della fioreria (anche per i link ai documenti legali). */
  readonly locale: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[radial-gradient(ellipse_at_top,oklch(0.95_0.025_150),transparent_60%)]">
      {demoNotice ? (
        <div className="flex items-center gap-2 border-b bg-warning-soft px-4 py-2 text-sm text-[oklch(0.38_0.09_65)]">
          <TriangleExclamationPoint className="size-4 shrink-0" aria-hidden="true" />
          <span>{demoNotice}</span>
        </div>
      ) : null}
      <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 pt-6 pb-2">
        <Link
          href={homeHref}
          className="flex items-center gap-2 text-sm font-semibold tracking-wide text-primary uppercase"
        >
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo servito dall'app.
            <img
              src={logoSrc}
              alt=""
              className="size-8 rounded-lg border bg-white object-contain"
            />
          ) : (
            <Flower2 className="size-4" aria-hidden="true" />
          )}
          {name}
        </Link>
        {contact ? (
          <div className="flex gap-2">
            <Button asChild size="sm">
              <a href={contact.whatsappHref} target="_blank" rel="noopener noreferrer">
                <MessageCircle />
                {contact.whatsappLabel}
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={contact.callHref}>
                <Phone />
                <span className="sr-only sm:not-sr-only">{contact.callLabel}</span>
              </a>
            </Button>
          </div>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 pt-4 pb-16">{children}</main>
      <footer className="space-y-2 pb-8 text-center text-xs text-muted-foreground">
        <p>{footer}</p>
        <LegalLinks audience="buyer" locale={locale} />
      </footer>
    </div>
  );
}

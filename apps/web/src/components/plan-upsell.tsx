import { Lock } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * Invito all'upgrade per una funzione non inclusa nel piano: onesto e senza pagamenti
 * finti. Chi può vedere il piano riceve il link; gli altri sanno a chi chiedere.
 */
export function PlanUpsell({
  title,
  body,
  hint,
  planHref,
  planLabel,
}: {
  title: string;
  body: string;
  hint: string;
  planHref?: string | undefined;
  planLabel: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/60 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground [&_svg]:size-6">
        <Lock aria-hidden="true" />
      </div>
      <h2 className="font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      <p className="max-w-md text-sm text-muted-foreground">{hint}</p>
      {planHref ? (
        <Button asChild variant="outline" className="mt-2">
          <Link href={planHref}>{planLabel}</Link>
        </Button>
      ) : null}
    </div>
  );
}

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';

/**
 * Paginazione di una pagina elenco: "Anterior" / "Página X de Y" / "Siguiente". Non compare se
 * c'è una pagina sola. Agli estremi il pulsante è disattivato davvero (niente link verso una
 * pagina che non esiste, nemmeno da tastiera).
 */
export async function ListPagination({
  page,
  pageCount,
  href,
}: {
  readonly page: number;
  readonly pageCount: number;
  /** Indirizzo di una pagina, con gli stessi filtri (`routes.x.list({ ..., page })`). */
  readonly href: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const t = await getTranslations('common');
  const position = t('pageOf', { page, pageCount });
  return (
    <nav className="flex items-center justify-between" aria-label={position}>
      <PageButton href={page > 1 ? href(page - 1) : null}>
        <ChevronLeft />
        {t('previous')}
      </PageButton>
      <span className="text-sm text-muted-foreground">{position}</span>
      <PageButton href={page < pageCount ? href(page + 1) : null}>
        {t('next')}
        <ChevronRight />
      </PageButton>
    </nav>
  );
}

function PageButton({
  href,
  children,
}: {
  readonly href: string | null;
  readonly children: React.ReactNode;
}) {
  if (href === null) {
    return (
      <Button variant="outline" size="sm" disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

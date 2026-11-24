import { getTranslations } from 'next-intl/server';
import type { ProductionSummary } from '@floral/domain';
import { formatDuration } from '@/lib/duration';

/** Producción del día (ADR-057): quanto serve, sommato dalle distinte. Stessa lista a schermo e in stampa. */
export async function ProductionList({ production }: { readonly production: ProductionSummary }) {
  const t = await getTranslations('orders.production');
  const tColors = await getTranslations('catalog.colors');
  const tDuration = await getTranslations('duration');
  if (production.items.length === 0 && production.custom.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }
  return (
    <div className="grid gap-4">
      {/* Tempo di armado (ADR-081): solo se il catalogo lo dice per almeno un prodotto. */}
      {production.prepMinutes > 0 ? (
        <p className="text-sm" data-testid="production-prep-time">
          <span className="font-medium">
            {t('prepTime', {
              duration: formatDuration(
                (key, values) => tDuration(key, values),
                production.prepMinutes,
              ),
            })}
          </span>
          {production.bouquetsWithoutPrepTime > 0 ? (
            <span className="text-muted-foreground">
              {' · '}
              {t('prepUnknown', { count: production.bouquetsWithoutPrepTime })}
            </span>
          ) : null}
        </p>
      ) : null}
      {production.items.length > 0 ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{t('itemsCaption')}</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                {t('item')}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                {t('quantity')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {production.items.map((item) => (
              <tr key={`${item.name}|${item.variety ?? ''}|${item.color ?? ''}|${item.saleUnit}`}>
                <td className="py-2 pr-3">
                  {item.variety ? `${item.name} ${item.variety}` : item.name}
                  {item.color && tColors.has(item.color) ? (
                    <span className="text-muted-foreground">
                      {' '}
                      · {tColors(item.color).toLocaleLowerCase()}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 text-right font-medium tabular-nums">
                  {t(`units.${item.saleUnit}`, { count: item.quantity })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {production.custom.length > 0 ? (
        <div className="grid gap-1 text-sm">
          <p className="font-medium">{t('custom')}</p>
          <ul className="list-inside list-disc text-muted-foreground">
            {production.custom.map((line) => (
              <li key={line.description}>
                {line.quantity} × {line.description}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

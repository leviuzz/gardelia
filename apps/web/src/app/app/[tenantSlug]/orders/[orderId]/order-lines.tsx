/**
 * Righe dell'ordine in modifica (borrador, o confermato fino a "en preparación"): stesso editor
 * dei preventivi, con prezzi e distinta sempre dal catalogo del tenant (ADR-054). Server component:
 * prepara i testi e lega le azioni all'ordine.
 */
import { getTranslations } from 'next-intl/server';
import { listQuotableItems, type OrderDetailDto, type TenantContext } from '@floral/core';
import { ORDER_LIMITS, minorToDecimalString } from '@floral/domain';
import { money } from '@/lib/format';
import { lineFormatters, lineWarning } from '@/lib/line-ui';
import { tenantRoutes } from '@/lib/routes';
import {
  QuoteLineComposer,
  QuoteLineList,
  type QuoteLineView,
} from '../../quotes/[quoteId]/quote-lines';
import {
  addCatalogLineToOrderAction,
  addCustomLineToOrderAction,
  removeOrderLineAction,
  updateOrderDiscountAction,
  updateOrderLineQuantityAction,
} from '../actions';
import { OrderDiscountForm } from '../order-forms';

export async function OrderLinesEditor({
  ctx,
  order,
}: {
  readonly ctx: TenantContext;
  readonly order: OrderDetailDto;
}) {
  const t = await getTranslations();
  const slug = ctx.tenantSlug;
  const routes = tenantRoutes(slug);
  const quotable = await listQuotableItems(ctx);
  const quotableById = new Map(quotable.map((item) => [item.id, item]));
  const lineUi = await lineFormatters(order.currency);
  const canEdit = order.linesEditable;

  const lines: QuoteLineView[] = order.lines.map((line) => ({
    id: line.id,
    description: line.description,
    quantity: line.quantity,
    unitPriceLabel: lineUi.unitPrice(line.unitPriceMinor, line.saleUnit),
    lineTotalLabel: money(line.lineTotalMinor, order.currency),
    recipeSummary: lineUi.recipe(line.recipe),
    serviceSummary: lineUi.service(line.service),
    warning: lineWarning(line, canEdit ? quotableById : null),
    designHref: line.bouquetConfigurationId
      ? routes.builder.design(line.bouquetConfigurationId)
      : null,
    image: line.image
      ? {
          url: routes.orders.lineImage(order.id, line.id),
          downloadUrl: routes.orders.lineImage(order.id, line.id, { download: true }),
          source: line.image.source,
          verified: line.image.verified,
          simulated: line.image.simulated,
        }
      : null,
    ...(canEdit
      ? {
          updateAction: updateOrderLineQuantityAction.bind(null, slug, order.id, line.id),
          removeAction: removeOrderLineAction.bind(null, slug, order.id, line.id),
        }
      : {}),
  }));

  return (
    <div className="space-y-5">
      <QuoteLineList lines={lines} editable={canEdit} />
      {canEdit ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t('quotes.editor.lineCount', { count: order.lines.length, max: ORDER_LIMITS.lines })}
          </p>
          <QuoteLineComposer
            addCatalogAction={addCatalogLineToOrderAction.bind(null, slug, order.id)}
            addCustomAction={addCustomLineToOrderAction.bind(null, slug, order.id)}
            currency={order.currency}
            catalogHref={routes.catalog.list()}
            options={quotable.map((item) => lineUi.option(item))}
          />
          {order.lines.length > 0 ? (
            <div className="border-t pt-5">
              <OrderDiscountForm
                action={updateOrderDiscountAction.bind(null, slug, order.id)}
                currency={order.currency}
                defaultValue={
                  order.discountMinor > 0
                    ? minorToDecimalString(order.discountMinor, ctx.currency)
                    : ''
                }
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

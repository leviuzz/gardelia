import 'server-only';
import { Undo2 } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { InventoryMovementDto } from '@floral/core';
import type { InventoryEntryKind } from '@floral/domain';
import { ConfirmActionDialog } from '@/components/common/confirm-action-dialog';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ActionState } from '@/lib/action-state';
import { money } from '@/lib/format';
import { cn } from '@/lib/utils';

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const KIND_BADGE: Record<InventoryEntryKind, BadgeVariant> = {
  OPENING: 'secondary',
  PURCHASE: 'success',
  USE: 'info',
  WASTE: 'warning',
  ADJUSTMENT: 'muted',
  REVERSAL: 'outline',
};

/**
 * Movimenti di magazzino, i più recenti per primi: tipo, quantità con il segno, giacenza dopo,
 * nota, chi e quando; per chi vede i costi anche il valore; "Anular" dove si può.
 */
export async function MovementList({
  movements,
  timezone,
  itemHref,
  reverseAction,
}: {
  readonly movements: readonly InventoryMovementDto[];
  readonly timezone: string;
  /** Con il link al prodotto quando l'elenco mostra tutti i prodotti. */
  readonly itemHref?: (inventoryItemId: string) => string;
  readonly reverseAction: (entryId: string) => Action;
}) {
  const t = await getTranslations('inventory');
  const format = await getFormatter();
  const amount = (movement: InventoryMovementDto, count: number) =>
    t('quantity', { unit: movement.item.saleUnit, count });

  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {movements.map((movement) => {
        const itemName = movement.item.variety
          ? `${movement.item.name} · ${movement.item.variety}`
          : movement.item.name;
        const change = `${movement.quantity > 0 ? '+' : '−'}${amount(movement, Math.abs(movement.quantity))}`;
        const when = format.dateTime(movement.occurredAt, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: timezone,
        });
        return (
          <li
            key={movement.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={KIND_BADGE[movement.kind]}>{t(`kinds.${movement.kind}`)}</Badge>
                {movement.reversed ? (
                  <Badge variant="muted">{t('movements.reversed')}</Badge>
                ) : null}
                {itemHref ? (
                  <Link
                    href={itemHref(movement.item.id)}
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {itemName}
                  </Link>
                ) : null}
              </div>
              {movement.reversesKind ? (
                <p className="text-xs text-muted-foreground">
                  {t('movements.reversalOf', { kind: t(`kinds.${movement.reversesKind}`) })}
                </p>
              ) : null}
              {movement.note ? <p className="text-sm break-words">{movement.note}</p> : null}
              <p className="text-xs text-muted-foreground">
                {when} · {movement.actorName ?? t('movements.someone')}
                {movement.entryLines > 1
                  ? ` · ${t('movements.otherProducts', { count: movement.entryLines - 1 })}`
                  : ''}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <div className="sm:text-right">
                <p
                  className={cn(
                    'font-semibold tabular-nums',
                    movement.quantity < 0 ? 'text-destructive' : 'text-success',
                  )}
                >
                  {change}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('movements.balance', { quantity: amount(movement, movement.balanceAfter) })}
                </p>
                {movement.valueMinor !== null ? (
                  <p className="text-xs text-muted-foreground">
                    {t('movements.value', {
                      amount: money(movement.valueMinor, movement.currency),
                    })}
                  </p>
                ) : null}
              </div>
              {movement.canReverse ? (
                <ConfirmActionDialog
                  action={reverseAction(movement.entryId)}
                  trigger={
                    <Button variant="ghost" size="sm">
                      <Undo2 aria-hidden="true" />
                      {t('actions.reverse')}
                    </Button>
                  }
                  title={t('actions.reverseTitle')}
                  description={
                    movement.entryLines > 1
                      ? t('actions.reverseBodyMany', { count: movement.entryLines })
                      : t('actions.reverseBody', {
                          quantity: amount(movement, Math.abs(movement.quantity)),
                          name: itemName,
                        })
                  }
                  confirmLabel={t('actions.reverseConfirm')}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

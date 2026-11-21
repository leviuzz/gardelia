import { ArrowLeft, CircleCheck, TriangleExclamationPoint } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  NotFoundError,
  getCatalogItem,
  getRecipe,
  hasPermission,
  listCanonicalFlowers,
  listIngredientOptions,
  type CatalogItemDto,
  type RecipeDto,
  type TenantContext,
} from '@floral/core';
import { isCurrencyCode, minorToDecimalString } from '@floral/domain';
import { ArchiveControl } from '@/components/archive-control';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AVAILABILITY_BADGE } from '@/lib/catalog-ui';
import { money, percentFromBps } from '@/lib/format';
import { getTenantContext } from '@/lib/tenant';
import {
  addRecipeLineAction,
  removeRecipeLineAction,
  setArchivedAction,
  updateItemAction,
  updateRecipeDetailsAction,
  updateRecipeLineAction,
} from '../actions';
import { ItemForm, type ItemFormDefaults } from '../item-form';
import { AddIngredientForm, RecipeDetailsForm, RecipeLineRow } from './recipe-editor';

async function loadItem(ctx: TenantContext, itemId: string): Promise<CatalogItemDto> {
  try {
    return await getCatalogItem(ctx, itemId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({
  params,
}: PageProps<'/app/[tenantSlug]/catalog/[itemId]'>): Promise<Metadata> {
  const { tenantSlug, itemId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const item = await loadItem(ctx, itemId);
  return { title: item.name };
}

function decimal(minor: number | null, currency: string): string {
  if (minor === null || !isCurrencyCode(currency)) return '';
  return minorToDecimalString(minor, currency);
}

export default async function ItemPage({
  params,
  searchParams,
}: PageProps<'/app/[tenantSlug]/catalog/[itemId]'>) {
  const { tenantSlug, itemId } = await params;
  const ctx = await getTenantContext(tenantSlug);
  const item = await loadItem(ctx, itemId);
  const created = (await searchParams).created === '1';
  const canWrite = hasPermission(ctx, 'catalog:write');
  const t = await getTranslations();
  const slug = ctx.tenantSlug;

  const [canonical, recipe, ingredients] = await Promise.all([
    canWrite ? listCanonicalFlowers(ctx.locale) : Promise.resolve([]),
    item.type === 'BOUQUET' ? getRecipe(ctx, item.id) : Promise.resolve(null),
    item.type === 'BOUQUET' && canWrite ? listIngredientOptions(ctx) : Promise.resolve([]),
  ]);

  const defaults: ItemFormDefaults = {
    type: item.type,
    name: item.name,
    variety: item.variety ?? '',
    canonicalFlowerId: item.canonicalFlowerId ?? '',
    sku: item.sku ?? '',
    description: item.description ?? '',
    saleUnit: item.saleUnit,
    price: decimal(item.priceMinor, item.currency),
    cost: decimal(item.costMinor, item.currency),
    availability: item.availability,
    colors: item.colors,
    tags: item.tags.join(', '),
    prepMinutes: item.prepMinutes?.toString() ?? '',
    heightCm: item.heightCm?.toString() ?? '',
    widthCm: item.widthCm?.toString() ?? '',
    isBuilderEnabled: item.isBuilderEnabled,
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href={`/app/${slug}/catalog`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t('common.back')}
      </Link>
      <PageHeader
        title={item.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t(`catalog.types.${item.type}`)}</Badge>
            <Badge variant={AVAILABILITY_BADGE[item.availability]}>
              {t(`catalog.availability.${item.availability}`)}
            </Badge>
            {item.variety ? <span>{item.variety}</span> : null}
            {item.canonicalName ? <span>· {item.canonicalName}</span> : null}
          </span>
        }
        actions={
          canWrite ? (
            <ArchiveControl
              archived={item.status === 'ARCHIVED'}
              archiveAction={setArchivedAction.bind(null, slug, item.id, true)}
              restoreAction={setArchivedAction.bind(null, slug, item.id, false)}
              labels={{
                archive: t('catalog.form.archive'),
                restore: t('catalog.form.restore'),
                confirmTitle: t('catalog.form.archiveTitle'),
                confirmBody: t('catalog.form.archiveBody'),
              }}
            />
          ) : null
        }
      />

      {created ? (
        <Alert variant="success">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>{t('catalog.form.created')}</AlertDescription>
        </Alert>
      ) : null}
      {item.status === 'ARCHIVED' ? (
        <Alert variant="warning">
          <TriangleExclamationPoint aria-hidden="true" />
          <AlertDescription>{t('catalog.form.archivedNotice')}</AlertDescription>
        </Alert>
      ) : null}

      {recipe ? (
        <RecipeSection
          recipe={recipe}
          slug={slug}
          currency={item.currency}
          canEdit={canWrite}
          ingredientChoices={ingredients.map((ingredient) => ({
            id: ingredient.id,
            label: ingredient.variety
              ? `${ingredient.name} · ${ingredient.variety}`
              : ingredient.name,
            groupLabel: t(`catalog.types.${ingredient.type}`),
          }))}
        />
      ) : null}

      {canWrite ? (
        <ItemForm
          mode="edit"
          action={updateItemAction.bind(null, slug, item.id)}
          canonicalOptions={canonical.map(({ id, name, category }) => ({ id, name, category }))}
          defaults={defaults}
        />
      ) : (
        <ReadOnlyDetails item={item} />
      )}
    </div>
  );
}

async function RecipeSection({
  recipe,
  slug,
  currency,
  canEdit,
  ingredientChoices,
}: {
  recipe: RecipeDto;
  slug: string;
  currency: string;
  canEdit: boolean;
  ingredientChoices: { id: string; label: string; groupLabel: string }[];
}) {
  const t = await getTranslations();
  const showCosts = recipe.costing !== null;
  const bouquetId = recipe.bouquet.id;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-xl">{t('recipe.title')}</CardTitle>
        <CardDescription>{t('recipe.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {recipe.hasUnavailableIngredients ? (
          <Alert variant="warning">
            <TriangleExclamationPoint aria-hidden="true" />
            <AlertDescription>{t('recipe.unavailableWarning')}</AlertDescription>
          </Alert>
        ) : null}

        {recipe.lines.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {t('recipe.empty')}
          </p>
        ) : (
          <ul className="divide-y rounded-xl border px-4">
            {recipe.lines.map((line) => (
              <RecipeLineRow
                key={line.id}
                currency={currency}
                canEdit={canEdit}
                showCosts={showCosts}
                line={{
                  id: line.id,
                  quantity: line.quantity,
                  name: line.ingredient.name,
                  variety: line.ingredient.variety,
                  type: line.ingredient.type,
                  unitLabel: t(`catalog.unitsLong.${line.ingredient.saleUnit}`),
                  unitCostMinor: line.ingredient.costMinor,
                  archived: line.ingredient.status === 'ARCHIVED',
                  outOfStock: line.ingredient.availability === 'OUT_OF_STOCK',
                  updateAction: updateRecipeLineAction.bind(null, slug, bouquetId, line.id),
                  removeAction: removeRecipeLineAction.bind(null, slug, bouquetId, line.id),
                }}
              />
            ))}
          </ul>
        )}

        {canEdit ? (
          <AddIngredientForm
            action={addRecipeLineAction.bind(null, slug, bouquetId)}
            choices={ingredientChoices}
          />
        ) : null}

        <div className="rounded-xl bg-muted/50 p-4">
          <h3 className="mb-3 text-sm font-semibold">{t('recipe.costing')}</h3>
          {recipe.costing ? (
            <dl className="grid gap-2 text-sm">
              <CostRow
                label={t('recipe.salePrice')}
                value={money(recipe.costing.salePriceMinor, currency)}
                strong
              />
              <CostRow
                label={t('recipe.componentsRetail')}
                value={money(recipe.costing.componentsRetailMinor, currency)}
              />
              <CostRow
                label={t('recipe.materialCost')}
                value={
                  recipe.costing.materialCostMinor !== null
                    ? money(recipe.costing.materialCostMinor, currency)
                    : '—'
                }
              />
              <CostRow
                label={t('recipe.laborCost')}
                value={
                  recipe.costing.laborCostMinor !== null
                    ? money(recipe.costing.laborCostMinor, currency)
                    : '—'
                }
              />
              <CostRow
                label={t('recipe.materialMargin')}
                value={
                  recipe.costing.materialMarginBps !== null &&
                  recipe.costing.materialMarginMinor !== null
                    ? `${money(recipe.costing.materialMarginMinor, currency)} · ${percentFromBps(recipe.costing.materialMarginBps)}`
                    : '—'
                }
              />
              <CostRow
                label={t('recipe.fullMargin')}
                value={
                  recipe.costing.fullMarginBps !== null && recipe.costing.fullMarginMinor !== null
                    ? `${money(recipe.costing.fullMarginMinor, currency)} · ${percentFromBps(recipe.costing.fullMarginBps)}`
                    : '—'
                }
                strong
              />
              {recipe.costing.linesMissingCost > 0 ? (
                <p className="mt-2 text-sm text-[oklch(0.45_0.1_65)]">
                  {t('recipe.missingCosts', { count: recipe.costing.linesMissingCost })}
                </p>
              ) : recipe.costing.laborCostMinor === null && !recipe.costing.isEmpty ? (
                <p className="mt-2 text-sm text-muted-foreground">{t('recipe.laborUnknown')}</p>
              ) : null}
            </dl>
          ) : (
            <dl className="grid gap-2 text-sm">
              <CostRow
                label={t('recipe.componentsRetail')}
                value={money(recipe.componentsRetailMinor, currency)}
              />
              <p className="mt-1 text-muted-foreground">{t('recipe.costsHidden')}</p>
            </dl>
          )}
        </div>

        {canEdit ? (
          <div className="space-y-4 border-t pt-6">
            <h3 className="text-sm font-semibold">{t('recipe.details')}</h3>
            <RecipeDetailsForm
              action={updateRecipeDetailsAction.bind(null, slug, bouquetId)}
              showLaborCost={showCosts}
              defaults={{
                laborCost:
                  recipe.laborCostMinor !== null && isCurrencyCode(currency)
                    ? minorToDecimalString(recipe.laborCostMinor, currency)
                    : '',
                styleTags: recipe.styleTags.join(', '),
                notes: recipe.notes ?? '',
                substitutionPolicy: recipe.substitutionPolicy,
              }}
            />
          </div>
        ) : (
          <div className="space-y-1 border-t pt-4 text-sm">
            <p>
              <span className="text-muted-foreground">{t('recipe.substitutionPolicy')}: </span>
              {t(`recipe.substitution.${recipe.substitutionPolicy}`)}
            </p>
            {recipe.notes ? (
              <p>
                <span className="text-muted-foreground">{t('recipe.notes')}: </span>
                {recipe.notes}
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CostRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  );
}

async function ReadOnlyDetails({ item }: { item: CatalogItemDto }) {
  const t = await getTranslations('catalog');
  const rows: [string, string][] = [
    [
      t('form.price'),
      `${money(item.priceMinor, item.currency)} ${t('perUnit', { unit: t(`units.${item.saleUnit}`) })}`,
    ],
    [t('form.sku'), item.sku ?? '—'],
    [t('form.colors'), item.colors.map((color) => t(`colors.${color}`)).join(', ') || '—'],
    [t('form.tags'), item.tags.join(', ') || '—'],
    [t('form.prepMinutes'), item.prepMinutes?.toString() ?? '—'],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('form.sectionBasics')}</CardTitle>
        <CardDescription>{t('form.readOnly')}</CardDescription>
      </CardHeader>
      <CardContent>
        {item.description ? (
          <p className="mb-4 text-sm leading-relaxed">{item.description}</p>
        ) : null}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

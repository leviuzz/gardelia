export * from './errors';
export * from './logger';
export {
  ConfigurationError,
  isLocalAppUrl,
  readPlatformConfig,
  type PlatformConfig,
} from './config';
export {
  listTenantsPendingDeletion,
  listUserTenants,
  resolveTenantContext,
  type TenantPendingDeletion,
  type RequestMeta,
  type ResolveTenantContextInput,
  type TenantContext,
} from './context';
export { hasPermission, requirePermission } from './authorization';
export {
  MAINTENANCE_INTERVAL_MS,
  runDailyMaintenance,
  type MaintenanceResult,
} from './jobs/maintenance';
export {
  runOccasionPromos,
  type OccasionPromoDeps,
  type OccasionPromoRunResult,
} from './jobs/occasion-promos';
export { recordPlatformSecurityEvent } from './audit';
export {
  ConsoleMailer,
  MemoryMailer,
  SmtpMailer,
  createMailerFromEnv,
  getMailer,
  setMailer,
  type EmailMessage,
  type Mailer,
} from './mailer';
export {
  deleteAccountEmail,
  invitationEmail,
  passwordResetEmail,
  verificationEmail,
} from './email-templates';
export { occasionPromoEmail, type PromoEmailInput } from './promo-email';
export {
  createUnsubscribeToken,
  describeUnsubscribe,
  readUnsubscribeToken,
  unsubscribeFromPromotions,
  unsubscribeUrls,
  type UnsubscribeInfo,
} from './promo-unsubscribe';
export {
  GooglePlacesProvider,
  PlacesUnavailableError,
  getPlacesProvider,
  setPlacesProvider,
  type PlaceDetails,
  type PlaceSuggestion,
  type PlacesProvider,
} from './places';
export {
  cancelMarketplaceOrder,
  expireUnacceptedOrders,
  getCheckoutForm,
  listBuyerOrders,
  placeMarketplaceOrder,
  type BuyerOrderDto,
  type CheckoutFormDto,
  type CheckoutItemDto,
  type PlaceOrderOptions,
  type PlacedOrderDto,
} from './marketplace-orders';
export type { OrderMailDeps } from './order-mail';
export {
  listPublicStoreCities,
  refreshStoreCoordinates,
  searchPublicStores,
  type DirectoryStoreDto,
  type StoreSearchResultDto,
} from './public-directory';
export {
  getPublicStore,
  getPublicStoreImage,
  getPublicStoreItem,
  getPublicStoreItemPhoto,
  type PublicStoreDto,
  type PublicStoreItemDetailDto,
  type PublicStoreItemDto,
} from './public-store';
export {
  acceptPublicQuote,
  getPublicCareVisitPhoto,
  getPublicCareVisitReport,
  getPublicLineImage,
  getPublicOrder,
  getPublicOrderPhoto,
  getPublicQuote,
  getPublicShopLogo,
  publicLinkUrl,
  type AcceptQuoteResult,
  type PublicCareVisitDto,
  type PublicLineDto,
  type PublicOrderDto,
  type PublicQuoteDto,
  type PublicRecipeItem,
  type PublicShopDto,
} from './public-links';
export {
  AiProviderError,
  SimulatedImageProvider,
  createAiProviderFromEnv,
  getAiProvider,
  setAiProvider,
  type AiImageProvider,
  type AiProviderErrorCode,
  type GeneratedImage,
  type ImageInput,
} from './ai/providers';
export {
  FAL_MODEL_IDS,
  FalBackgroundRemover,
  FalBoxCounter,
  FalFlowerCounter,
  FalImageProvider,
  FalStyleDescriber,
  type FalModelId,
} from './ai/fal';
export {
  SimulatedFlowerCounter,
  TwoStepFlowerCounter,
  createFlowerCounterFromEnv,
  getFlowerCounter,
  setFlowerCounter,
  type CountOutcome,
  type FlowerCounter,
} from './ai/flower-counter';
export { bloomVisibility, renderBouquetSketch, renderSketch } from './ai/sketch-renderer';
export {
  ChromaKeyBackgroundRemover,
  createBackgroundRemoverFromEnv,
  finishCutout,
  getBackgroundRemover,
  setBackgroundRemover,
  type BackgroundRemover,
} from './ai/background-remover';
export {
  SimulatedStyleDescriber,
  createStyleDescriberFromEnv,
  getStyleDescriber,
  setStyleDescriber,
  type StyleDescriber,
  type StyleDescription,
} from './ai/style-describer';
export {
  MemoryStorage,
  createStorageFromEnv,
  getObjectStorage,
  setObjectStorage,
  type ObjectStorage,
} from './ai/storage';
export {
  DRAIN_RESERVE_MS,
  drainAiQueue,
  startAiWorker,
  type AiWorkerHandle,
  type DrainResult,
} from './ai/worker';
export { onAiJobQueued } from './ai/signal';
export * from './services/ai-previews';
export * from './services/catalog-photos';
export * from './services/style-references';
export * from './services/bouquet-photos';
export { normalizeUploadedPhoto, sniffImageType } from './media/images';
export * from './services/billing';
export * from './services/builder';
export * from './services/buyer-account';
export * from './services/catalog';
export * from './services/calendar';
export * from './services/customers';
export * from './services/dashboard';
export * from './services/inventory';
export * from './services/inventory-purchases';
export * from './services/inventory-reservations';
export * from './services/inventory-insights';
export * from './services/customer-timeline';
export * from './services/customer-tags';
export * from './services/customer-import';
export * from './services/promo-discounts';
export * from './services/promotions';
export * from './services/online-store';
export * from './services/orders';
export * from './services/order-inventory';
export * from './services/order-substitutions';
export * from './services/tenant-deletion';
export * from './services/order-schedule';
export * from './services/delivery-route';
export * from './services/order-handover';
export * from './services/delivery-settings';
// Floral Care (ADR-075): offerta, contratti, visite. Le funzioni interne (`…Tx`, posti nelle fasce)
// restano dentro il pacchetto.
export * from './services/care-settings';
export * from './services/care-contracts';
export * from './services/care-visits';
// La visita dal telefono, le foto, gli avvisi, il resoconto e la ruta del día (ADR-078).
export {
  addCareFollowUp,
  finishCareVisit,
  getCareVisitSheet,
  listCareMaterialOptions,
  markAllCarePlantsOk,
  markCareVisitNotDone,
  saveCareVisitNote,
  sendCareVisitReport,
  setCareVisitMaterial,
  setCareVisitPlantResult,
  setCareVisitServiceResult,
  startCareVisit,
  type CareChecklistItemDto,
  type CareMailDeps,
  type CareMaterialOptionDto,
  type CareReportDelivery,
  type CareVisitCloseResult,
  type CareVisitEmailDto,
  type CareVisitMaterialDto,
  type CareVisitPhotoDto,
  type CareVisitPlantDto,
  type CareVisitSheetDto,
} from './services/care-visit-work';
export {
  addCareVisitPhoto,
  getCareVisitPhotoImage,
  removeCareVisitPhoto,
  type CarePhotoUploadResult,
} from './services/care-photos';
export {
  listCareFollowUps,
  resolveCareFollowUp,
  type CareFollowUpDto,
  type CareFollowUpListDto,
} from './services/care-follow-ups';
// Visite extra, cotizaciones dal contratto e cambio di stagione (ADR-078, blocco 2b).
export {
  createCareExtraVisit,
  createCareQuote,
  getCareExtraVisitOptions,
  listCareContractQuotes,
  type CareContractQuoteDto,
  type CareExtraVisitOptionsDto,
} from './services/care-extras';
export type {
  CareReportPhotoDto,
  CareReportPlantDto,
  CareReportServiceDto,
  CareVisitReportDto,
} from './services/care-report';
// Cargos, pagamenti ed estado de cuenta (ADR-082, blocco 3). L'emissione (`…Tx`) resta interna.
export {
  getCareCharge,
  getCareChargesOverview,
  listCareCharges,
  listContractCharges,
  type CareChargeDetailDto,
  type CareChargeLineDto,
  type CareChargeListItemDto,
  type CareChargeListResult,
  type CareChargePaymentDto,
  type CareChargeSummaryDto,
  type CareChargesOverviewDto,
  type CareContractChargesDto,
} from './services/care-charges';
export {
  recordCareChargePayment,
  recordCustomerCarePayment,
  refundCareCharge,
  reverseCarePayment,
} from './services/care-payments';
export {
  getCustomerCareStatement,
  type CareStatementChargeDto,
  type CareStatementDto,
  type CareStatementPaymentDto,
} from './services/care-statement';
export {
  getDayRoute,
  type DayRouteDto,
  type DayRouteStop,
  type RouteVisitStopDto,
} from './services/day-route';
export { runCareMaintenance, type CareMaintenanceResult } from './jobs/care';
export * from './services/public-links';
export * from './services/quotes';
export * from './services/recipes';
export * from './services/team';
export * from './services/account-security';
export * from './services/letterhead';
export * from './services/opening-hours';
export * from './services/reports';
export * from './services/tenant-export';
export * from './services/tenants';

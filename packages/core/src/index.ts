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
  remindPendingOrders,
  type BuyerOrderDto,
  type CheckoutFormDto,
  type CheckoutItemDto,
  type PlaceOrderOptions,
  type PlacedOrderDto,
} from './marketplace-orders';
export type { OrderMailDeps } from './order-mail';
export {
  buyerReorderLines,
  getBuyerOrder,
  getBuyerOrderLineImage,
  getBuyerOrderMessagePhoto,
  getBuyerOrderPhoto,
  getBuyerOrderShopLogo,
  markBuyerOrderRead,
  postBuyerOrderMessage,
  type BuyerOrderDetailDto,
  type BuyerOrderMessagePostResult,
  type BuyerOrderShop,
  type BuyerOrderThreadDto,
  type BuyerReorderDto,
  type BuyerOrderChangeDto,
  type BuyerOrderMoneyDto,
  type BuyerPaymentProofDto,
} from './buyer-orders';
export {
  getBuyerPaymentProofPhoto,
  submitBuyerPaymentProof,
  type BuyerPaymentProofResult,
} from './buyer-order-money';
export {
  answerBuyerOrderQuestion,
  confirmBuyerOrderChange,
  declineBuyerOrderChange,
  type BuyerQuestionAnswerResult,
} from './buyer-order-changes';
export { askOrderChange, proposeOrderDate, type OrderChangeDto } from './services/order-changes';
export type { OrderMessageDto } from './order-message-internals';
export * from './services/order-messages';
export * from './services/order-money';
export {
  listPublicStoreCities,
  listPublicStoreOccasions,
  listSitemapEntries,
  refreshStoreCoordinates,
  searchPublicStores,
  type DirectoryStoreDto,
  type SitemapEntryDto,
  type StoreSearchResultDto,
} from './public-directory';
export {
  getPublicStore,
  getPublicStorefront,
  getPublicStoreImage,
  getPublicStoreItem,
  getPublicStoreItemPhoto,
  getPublicStoreService,
  getPublicStoreServicePhoto,
  type PublicStoreDto,
  type PublicStorefrontDto,
  type PublicCartSummaryDto,
  type PublicStoreItemDetailDto,
  type PublicStoreItemDto,
  type PublicStoreServiceDetailDto,
  type PublicStoreServiceDto,
} from './public-store';
// M5 (ADR-089): servizi in vetrina e richieste.
export {
  addStorefrontServicePhoto,
  archiveStorefrontService,
  createStorefrontService,
  getStorefrontServicePhotoImage,
  getStorefrontServicesSettings,
  moveStorefrontService,
  removeStorefrontServicePhoto,
  saveStorefrontService,
  setStorefrontServicePublished,
  type StorefrontServiceDto,
  type StorefrontServicePhotoDto,
  type StorefrontServicesSettingsDto,
  type StorefrontServiceTarget,
} from './services/storefront-services';
export {
  countNewServiceRequests,
  declineServiceRequest,
  getServiceRequest,
  getServiceRequestPhotoImage,
  listServiceRequests,
  purgeServiceRequestPhotos,
  serviceRequestsMenuCount,
  type ServiceRequestListItemDto,
  type ServiceRequestListResult,
  type ShopServiceRequestDto,
} from './services/service-requests';
export {
  cancelBuyerServiceRequest,
  getBuyerServiceRequest,
  getBuyerServiceRequestPhoto,
  getServiceRequestForm,
  listBuyerServiceRequests,
  submitServiceRequest,
  type BuyerServiceRequestDetailDto,
  type BuyerServiceRequestDto,
  type ServiceRequestFormDto,
  type SubmittedServiceRequestDto,
} from './buyer-service-requests';
export type { ServiceRequestDetailDto, ServiceRequestPhotoDto } from './service-request-internals';
export {
  getStorePreview,
  getStorePreviewItem,
  type StorePreviewDto,
  type StorePreviewItemDto,
} from './services/store-preview';
export {
  listFeaturedItems,
  moveCatalogItemPhoto,
  setCatalogItemFeatured,
  setCatalogItemsOnline,
  updateStorePolicies,
  type CatalogBulkOnlineResult,
  type FeaturedItemDto,
} from './services/storefront-tools';
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
  type CareAdjustmentDto,
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
  confirmCarePayment,
  listCareVisitCollections,
  listPendingCareCollections,
  rejectCarePayment,
  submitCareVisitCollection,
  type CareCollectionDto,
  type CarePendingCollectionDto,
} from './services/care-collections';
export { addCareChargeAdjustment, removeCareChargeAdjustment } from './services/care-adjustments';
export {
  createCareBlock,
  getCareBlock,
  listCareBlocks,
  previewCareBlock,
  reassignCareVisits,
  removeCareBlock,
  sendCareBlockNotice,
  type CareBlockChangeDto,
  type CareBlockContractDto,
  type CareBlockCounts,
  type CareBlockCreateResult,
  type CareBlockDetailDto,
  type CareBlockPreviewDto,
  type CareBlockSlotDto,
  type CareBlockSummaryDto,
  type CareBlocksDto,
  type CareBlockWhenDto,
  type CarePeakDaySuggestionDto,
} from './services/care-blocks';
export {
  carePortalInviteUrl,
  getCarePortalPanel,
  getCustomerCarePortalSummary,
  inviteCarePortal,
  resendCarePortalInvite,
  revokeCarePortalAccess,
  revokeCarePortalInvite,
  type CarePortalDeps,
  type CarePortalInviteDto,
  type CarePortalInviteResult,
  type CarePortalPanelDto,
  type CarePortalPersonDto,
  type CustomerCarePortalSummaryDto,
} from './services/care-portal';
export {
  countUnreadCareMessages,
  getCareMessagePhotoImage,
  getCareThread,
  listCareThreads,
  markCareThreadRead,
  postCareMessage,
  removeCareMessagePhoto,
  type CareMessageDto,
  type CareMessagePostResult,
  type CareThreadDto,
  type CareThreadListDto,
  type CareThreadSummaryDto,
  type CareUnreadMessagesDto,
} from './services/care-messages';
export {
  getAssistantCreditsPanel,
  getContractAssistantCredits,
  giveAssistantCredits,
  isPlantAssistantAvailable,
  type AssistantCreditsPanelDto,
  type AssistantSpeciesDto,
  type ContractAssistantCreditsDto,
} from './services/plant-assistant';
export {
  answerMyAssistantCase,
  askMyShopForAssistantCredits,
  getMyAssistant,
  getMyAssistantCase,
  getMyAssistantPanel,
  getMyAssistantPhoto,
  sendMyAssistantCaseToShop,
  startMyAssistantCase,
  type MyAssistantAnswerDto,
  type MyAssistantCaseDto,
  type MyAssistantCaseSummaryDto,
  type MyAssistantCreditsDto,
  type MyAssistantDto,
  type MyAssistantPanelDto,
  type StartMyAssistantCaseInput,
} from './services/my-plant-assistant';
export {
  ClaudePlantAssistant,
  SimulatedPlantAssistant,
  createPlantAssistantsFromEnv,
  getPlantAssistants,
  setPlantAssistant,
  type AssistantCallResult,
  type AssistantImage,
  type PlantAssistant,
  type PlantAssistants,
} from './ai/plant-assistant';
export {
  acceptCarePortalInvite,
  changeMyCareVisitDate,
  getCarePortalInvitePreview,
  getMyCareCharge,
  getMyCareContract,
  getMyCarePhoto,
  getMyCareThread,
  getMyCareVisitDateOptions,
  getMyCareVisitReport,
  listMyCareContracts,
  markMyCareThreadRead,
  postMyCareMessage,
  type MyCareMessageDto,
  type MyCareMessagePostResult,
  type MyCareThreadDto,
  type CarePortalInvitePreviewDto,
  type MyCareChangeDeps,
  type MyCareChangeResult,
  type MyCareChargeDto,
  type MyCareContractDto,
  type MyCareContractListItemDto,
  type MyCareDateOptionDto,
  type MyCareDateOptionsDto,
  type MyCareVisitDto,
  type MyCareVisitReportDto,
} from './services/my-floral-care';
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

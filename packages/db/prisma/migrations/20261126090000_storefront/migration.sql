-- Vetrina che vende (marketplace, blocco M1, ADR-087).

-- «In evidenza»: quando la fioreria ha messo il prodotto nella riga «Destacados» (NULL = no).
ALTER TABLE "CatalogItem" ADD COLUMN "featuredAt" TIMESTAMP(3);

-- Solo un prodotto online e attivo sta in evidenza: chi lo spegne o lo archivia toglie anche
-- l'evidenza nello stesso aggiornamento (servizi del catalogo).
ALTER TABLE "CatalogItem"
  ADD CONSTRAINT "CatalogItem_featured_online_check"
    CHECK ("featuredAt" IS NULL OR ("isOnline" AND "status" = 'ACTIVE'));

-- La riga «Destacados» e il conteggio del limite (al massimo 8 per fioreria, nel servizio).
CREATE INDEX "CatalogItem_featured_idx" ON "CatalogItem" ("tenantId", "featuredAt")
  WHERE "featuredAt" IS NOT NULL;

-- Politiche della fioreria verso chi compra: testi suoi, facoltativi (mai vuoti: NULL).
ALTER TABLE "OnlineStore"
  ADD COLUMN "policyChanges" TEXT,
  ADD COLUMN "policyCancellations" TEXT,
  ADD COLUMN "policySubstitutions" TEXT;

ALTER TABLE "OnlineStore"
  ADD CONSTRAINT "OnlineStore_policyChanges_check"
    CHECK ("policyChanges" IS NULL OR char_length("policyChanges") BETWEEN 1 AND 1000),
  ADD CONSTRAINT "OnlineStore_policyCancellations_check"
    CHECK ("policyCancellations" IS NULL OR char_length("policyCancellations") BETWEEN 1 AND 1000),
  ADD CONSTRAINT "OnlineStore_policySubstitutions_check"
    CHECK ("policySubstitutions" IS NULL OR char_length("policySubstitutions") BETWEEN 1 AND 1000);

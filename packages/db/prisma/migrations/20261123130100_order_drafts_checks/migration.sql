-- Borradores degli ordini diretti (ADR-054, blocco A1b), parte 2: i vincoli che usano 'DRAFT'.

-- Solo un borrador (o un borrador scartato) può non avere il giorno di consegna o ritiro: un
-- ordine confermato ha sempre la data, anche dopo l'annullamento.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_scheduled_date_check"
    CHECK ("status" IN ('DRAFT', 'CANCELLED') OR "scheduledDate" IS NOT NULL);

-- Il motivo dell'annullamento è obbligatorio per un ordine confermato; un borrador scartato
-- (annullato senza data) non ne ha uno. Fuori da CANCELLED il motivo non c'è mai.
ALTER TABLE "Order" DROP CONSTRAINT "Order_cancel_reason_check";
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_cancel_reason_check" CHECK (
    CASE
      WHEN "status" = 'CANCELLED' THEN "cancelReason" IS NOT NULL OR "scheduledDate" IS NULL
      ELSE "cancelReason" IS NULL
    END
  );

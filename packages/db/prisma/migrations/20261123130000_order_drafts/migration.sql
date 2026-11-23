-- Borradores degli ordini diretti (ADR-054, blocco A1b). Il vincolo che usa il nuovo valore è
-- nella migrazione successiva: un valore aggiunto con ALTER TYPE … ADD VALUE non è utilizzabile
-- nella stessa transazione.
ALTER TYPE "OrderStatus" ADD VALUE 'DRAFT' BEFORE 'PENDING_ACCEPTANCE';

ALTER TABLE "Order" ALTER COLUMN "scheduledDate" DROP NOT NULL;

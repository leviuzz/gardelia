-- Verifica in due passaggi (ADR-077): tabella di Better Auth con il segreto dell'app di autenticazione
-- e i codici di riserva, cifrati dalla libreria con BETTER_AUTH_SECRET. Tabella di identità senza RLS,
-- come Session e Account (la libreria la legge prima che esista un contesto).

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TwoFactor" (
    "id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwoFactor_userId_key" ON "TwoFactor"("userId");

-- AddForeignKey
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contatore dei tentativi falliti mai negativo.
ALTER TABLE "TwoFactor"
  ADD CONSTRAINT "TwoFactor_failedVerificationCount_check" CHECK ("failedVerificationCount" >= 0);

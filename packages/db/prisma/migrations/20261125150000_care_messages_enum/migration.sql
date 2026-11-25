-- Floral Care, blocco 5b (ADR-084): l'avviso al cliente quando la fioreria scrive un messaggio.
-- Solo il valore nuovo: Postgres non lo lascia usare prima del commit, quindi i vincoli che lo
-- nominano stanno nella migrazione dopo (come BLOCK_NOTICE, ADR-083).

-- AlterEnum
ALTER TYPE "CareEmailKind" ADD VALUE 'MESSAGE_NOTICE';

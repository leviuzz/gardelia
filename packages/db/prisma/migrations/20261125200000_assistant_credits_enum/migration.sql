-- Floral Care, blocco 6b (ADR-085): i crediti dell'Asistente de plantas comprati dalla fioreria.
-- Solo il valore nuovo: Postgres non lo lascia usare prima del commit (come MESSAGE_NOTICE, 5b).

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'PLANT_ASSISTANT';

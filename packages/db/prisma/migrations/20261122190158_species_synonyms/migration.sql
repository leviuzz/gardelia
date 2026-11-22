-- Tassonomia ampliata (ADR-043): altri nomi di ogni specie per lingua, usati dalla ricerca nel
-- campo Specie e per riconoscere la specie dal nome del prodotto. Tabella globale (non di una
-- fioreria): le policy esistenti restano valide (lettura per tutti, scrittura solo di sistema).
-- I valori arrivano con l'allineamento dei dati di riferimento a ogni rilascio.

-- AlterTable
ALTER TABLE "CanonicalFlower" ADD COLUMN     "synonyms" JSONB NOT NULL DEFAULT '{}';

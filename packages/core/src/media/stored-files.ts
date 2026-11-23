/**
 * File dell'archivio (foto, ritagli, anteprime) letti e scritti dai servizi, con UNA regola:
 *  - lettura: un file che manca è "non trovato" per l'utente e un avviso nei log (dato incoerente);
 *  - scrittura: i file si salvano PRIMA della transazione del database, mai dentro (una
 *    transazione non deve restare aperta, con i suoi blocchi, durante un caricamento in rete). Se
 *    poi la transazione fallisce o non trova il record, i file si cancellano.
 */
import { getObjectStorage } from '../ai/storage';
import { NotFoundError } from '../errors';
import { logger } from '../logger';

export interface StoredImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface FileToStore {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/** Byte di un'immagine dell'archivio; se il file manca l'immagine è "non trovata". */
export async function readStoredImage(
  key: string,
  contentType: string,
  entity: string,
): Promise<StoredImage> {
  const bytes = await getObjectStorage().get(key);
  if (!bytes) {
    logger.warn({ entity, key }, 'file mancante nell’archivio per un record esistente');
    throw new NotFoundError(entity);
  }
  return { bytes, contentType };
}

/** Cancellazione di pulizia: se non riesce si registra e si va avanti (non è l'errore principale). */
async function removeQuietly(
  keys: readonly string[],
  message = 'file non cancellato dopo un salvataggio non riuscito',
): Promise<void> {
  const storage = getObjectStorage();
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch (error) {
      logger.warn({ err: error, key }, message);
    }
  }
}

/**
 * Cancella file che nessun record usa più (es. le foto di un disegno eliminato, ADR-051). Va
 * chiamata DOPO il commit: se una cancellazione non riesce il file resta orfano nell'archivio
 * (si registra), ma non c'è mai un record che punta a un file sparito.
 */
export async function deleteUnusedFiles(keys: readonly string[]): Promise<void> {
  await removeQuietly(keys, 'file non più usato rimasto nell’archivio');
}

/**
 * Salva i file e poi esegue `commit` (la transazione che li registra). Se un salvataggio fallisce
 * si cancellano quelli già scritti; se `commit` fallisce o restituisce `null` (record non
 * trovato) si cancellano tutti. Così non restano file senza record.
 */
export async function storeFilesThenCommit<T>(
  files: readonly FileToStore[],
  commit: () => Promise<T | null>,
): Promise<T | null> {
  const storage = getObjectStorage();
  const written: string[] = [];
  try {
    for (const file of files) {
      await storage.put(file.key, file.bytes, file.contentType);
      written.push(file.key);
    }
  } catch (error) {
    await removeQuietly(written);
    throw error;
  }

  let result: T | null;
  try {
    result = await commit();
  } catch (error) {
    await removeQuietly(written);
    throw error;
  }
  if (result === null) await removeQuietly(written);
  return result;
}

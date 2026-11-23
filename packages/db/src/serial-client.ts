/**
 * Client `pg` che esegue UNA query alla volta, in coda, come pg già faceva internamente, ma
 * senza passare dalla sua coda deprecata: "Calling client.query() when the client is already
 * executing a query" è un avviso in pg 8 e diventa un errore in pg 9.
 *
 * Perché serve: in una transazione interattiva Prisma usa un solo client, e il suo interprete
 * delle query lancia in parallelo le letture indipendenti (per esempio le relazioni incluse),
 * come fa il nostro codice con `Promise.all` sulla transazione. Una connessione Postgres esegue
 * comunque una query per volta: metterle in fila qui non cambia nulla, se non che l'ordine è
 * deciso da noi e non da una funzione di pg che sta per sparire.
 *
 * Solo la forma con promessa (quella di Prisma) va in coda; quelle con callback o con un
 * oggetto "Submittable" (cursori, stream) passano invariate: le usa il pool su un client che
 * ha in mano da solo, mai insieme alle altre.
 */
import pg from 'pg';

type QueryFunction = (...args: unknown[]) => unknown;

function isPassThrough(args: readonly unknown[]): boolean {
  const first = args[0];
  const last = args[args.length - 1];
  return (
    typeof last === 'function' ||
    (typeof first === 'object' &&
      first !== null &&
      typeof (first as { submit?: unknown }).submit === 'function')
  );
}

/** Avvolge `query` di un client: le chiamate con promessa partono una dopo l'altra. */
export function serializeQueries(run: QueryFunction): QueryFunction {
  let tail: Promise<unknown> = Promise.resolve();
  return (...args: unknown[]) => {
    if (isPassThrough(args)) return run(...args);
    const result = tail.then(() => run(...args));
    // La coda va avanti anche se una query fallisce (l'errore resta a chi l'ha chiesta).
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

/** Client del pool con le query in fila (opzione `Client` di `pg.Pool`). */
export class SerialClient extends pg.Client {
  constructor(config?: string | pg.ClientConfig) {
    super(config);
    const run = pg.Client.prototype.query.bind(this) as QueryFunction;
    Object.defineProperty(this, 'query', { value: serializeQueries(run), writable: true });
  }
}

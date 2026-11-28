/**
 * Ruoli merchant e matrice dei permessi (RBAC).
 *
 * È l'UNICA fonte di verità sui permessi: i servizi in @floral/core la applicano lato server
 * su ogni operazione; la UI la usa solo per decidere cosa mostrare.
 * Proposta Sprint 0 (vedi docs/DECISIONS.md, D-T08): lo STAFF non vede costi e margini.
 */

export const MEMBERSHIP_ROLES = ['OWNER', 'MANAGER', 'STAFF'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

const ALL = ['OWNER', 'MANAGER', 'STAFF'] as const satisfies readonly MembershipRole[];
const MANAGEMENT = ['OWNER', 'MANAGER'] as const satisfies readonly MembershipRole[];
const OWNER_ONLY = ['OWNER'] as const satisfies readonly MembershipRole[];

export const PERMISSIONS = {
  /** Vedere dashboard e dati base della fioreria. */
  'tenant:read': ALL,
  /** Modificare profilo operativo: nome commerciale, contatti, fuso, sede. */
  'tenant:settings:update': MANAGEMENT,
  /** Modificare dati legali/fiscali (ragione sociale, RFC). */
  'tenant:legal:update': OWNER_ONLY,
  /** "Eliminar florería" e "Recuperar" (ADR-074). */
  'tenant:delete': OWNER_ONLY,
  /** Scaricare tutti i dati della fioreria (ADR-079): clienti compresi, solo il titolare. */
  'tenant:export': OWNER_ONLY,
  /** Vedere il piano della fioreria e cosa include. */
  'billing:read': MANAGEMENT,
  /** Gestire piano SaaS, addon e pagamenti (sprint billing). */
  'billing:manage': OWNER_ONLY,
  /** Vedere membri e inviti del team. */
  'members:read': MANAGEMENT,
  /** Invitare persone (limitato dai ruoli assegnabili, vedi `invitableRoles`). */
  'members:invite': MANAGEMENT,
  /** Cambiare ruoli, disattivare/riattivare membri. */
  'members:manage': OWNER_ONLY,
  'catalog:read': ALL,
  'catalog:write': MANAGEMENT,
  /** Vedere costi, distinta con costi e margini. */
  'catalog:costs:read': MANAGEMENT,
  /** Reportes (ADR-080): vendite, margini e costi, quindi solo chi gestisce. */
  'reports:read': MANAGEMENT,
  'customers:read': ALL,
  'customers:write': MANAGEMENT,
  'quotes:read': ALL,
  /** Creare e modificare preventivi, cambiarne lo stato. */
  'quotes:write': MANAGEMENT,
  /** Vedere ordini, consegne e pagamenti registrati. */
  'orders:read': ALL,
  /**
   * Creare ordini (anche da un preventivo), cambiarne consegna e tarjeta, accettare quelli del
   * marketplace e annullarli (ADR-054; coerente con O-08: lo staff non crea clienti né preventivi).
   */
  'orders:write': MANAGEMENT,
  /** Far avanzare un ordine al banco: in preparazione, pronto, in consegna, consegnato, ritirato. */
  'orders:fulfill': ALL,
  /** Registrare e stornare i pagamenti ricevuti (D-26: registrati a mano). */
  'orders:payments': MANAGEMENT,
  /**
   * Accettare, rifiutare, cambiare e chiedere conferma sugli ordini online da accettare (M3-3,
   * ADR-088): tutti i ruoli, ma il servizio lo concede allo staff solo se la fioreria lo permette
   * (`OnlineStore.staffCanAccept`, `canHandlePendingOnlineOrders`). Proprietario e gerente sempre.
   */
  'orders:accept': ALL,
  /**
   * Leggere e scrivere i messaggi con chi ha fatto un ordine online (M3, ADR-088): tutta la squadra,
   * staff compreso, come i messaggi di Floral Care.
   */
  'orders:messages': ALL,
  /**
   * Le richieste dei servizi della vetrina (M5, ADR-089): le vede tutta la squadra (anche lo staff
   * sa cosa arriva); rifiutarle e prepararne il preventivo spetta a proprietario e gerente.
   */
  'requests:read': ALL,
  'requests:write': MANAGEMENT,
  /**
   * Vedere giacenze, avvisi e movimenti dell'inventario (ADR-060). I costi solo con
   * `catalog:costs:read`: lo staff vede le quantità, mai i costi.
   */
  'inventory:read': ALL,
  /**
   * Registrare i movimenti (uso, merma, conteggio, anulación) e scegliere i prodotti da controllare
   * con il loro minimo: solo proprietario e manager (founder, 23/11/2026).
   */
  'inventory:write': MANAGEMENT,
  /**
   * Comporre bouquet nel Builder e salvarne il disegno (anche lo staff al banco); per
   * trasformarlo in preventivo serve `quotes:write`. Richiede il piano con il Builder.
   */
  'builder:use': ALL,
  /**
   * Eliminare per sempre un disegno con le sue foto generate (ADR-051): solo se nessun preventivo
   * lo usa; altrimenti si archivia. Irreversibile, quindi solo proprietario e manager.
   */
  'builder:delete': MANAGEMENT,
  /**
   * Caricare e archiviare le foto di "Mis ramos" (riferimenti di stile per le anteprime AI):
   * richiede di dare il consenso a nome della fioreria.
   */
  'builder:references:write': MANAGEMENT,
  /**
   * Promo delle date speciali: attivarla e scegliere lo sconto dell'email automatica ai clienti
   * che hanno accettato di ricevere promozioni.
   */
  'promotions:manage': MANAGEMENT,
  /** Vedere il registro attività (audit) della fioreria. */
  'audit:read': MANAGEMENT,
  /** Vedere contratti di Floral Care e suscripciones, e l'agenda delle visite (ADR-075). */
  'subscriptions:read': ALL,
  /** Offerta di Floral Care, contratti, piante, fasce di uscita e cambi di agenda. */
  'subscriptions:write': MANAGEMENT,
  /** Pagamenti dei cargos dei contratti (registrati a mano, come gli ordini). */
  'subscriptions:payments': MANAGEMENT,
  /** Fare le visite: segnarle fatte o non realizzate (anche lo staff). */
  'care:visit': ALL,
  /**
   * Leggere e scrivere i messaggi dei clienti di Floral Care (ADR-084): tutta la squadra, staff
   * compreso (decisione del founder del 24/11).
   */
  'care:messages': ALL,
  /**
   * Asistente de plantas (ADR-085): l'assistente è per i clienti (Mi Floral Care); qui si danno i
   * crediti comprati dalla fioreria ai contratti, quindi proprietario e gerente (costa soldi).
   */
  'care:assistant': MANAGEMENT,
} as const satisfies Record<string, readonly MembershipRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: MembershipRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly MembershipRole[]).includes(role);
}

/** Ruoli che un membro può assegnare tramite invito. */
export function invitableRoles(role: MembershipRole): readonly MembershipRole[] {
  switch (role) {
    case 'OWNER':
      return ['OWNER', 'MANAGER', 'STAFF'];
    case 'MANAGER':
      return ['STAFF'];
    case 'STAFF':
      return [];
  }
}

export function isMembershipRole(value: unknown): value is MembershipRole {
  return typeof value === 'string' && (MEMBERSHIP_ROLES as readonly string[]).includes(value);
}

/**
 * Verifica in due passaggi (ADR-077, scelta del founder del 24/11/2026: "obbligatoria dopo 14
 * giorni" per i titolari). Vale per chi entra con email e password: chi entra con Google è protetto
 * dalla verifica del suo account Google. Le fiorerie demo non contano.
 */

export const TWO_FACTOR_POLICY = {
  /** Giorni dal primo ruolo di titolare entro cui attivarla, poi la fioreria non si apre. */
  graceDays: 14,
  /** Codici di riserva generati all'attivazione (ognuno vale una volta). */
  backupCodes: 10,
  /** Giorni in cui un dispositivo segnato come "di fiducia" non richiede il codice. */
  trustDeviceDays: 30,
} as const;

export interface TwoFactorFacts {
  /** La persona ha la verifica attiva. */
  readonly enabled: boolean;
  /** Ha una password (conto email e password, non solo Google). */
  readonly hasPassword: boolean;
  /** Da quando è titolare di una fioreria vera e attiva (la più vecchia), o null se non lo è. */
  readonly ownerSince: Date | null;
}

export interface TwoFactorRequirement {
  readonly enabled: boolean;
  readonly hasPassword: boolean;
  /** Per questa persona è obbligatoria (titolare con password). */
  readonly required: boolean;
  /** Entro quando attivarla, se è obbligatoria e non è ancora attiva. */
  readonly deadline: Date | null;
  /** La scadenza è passata: le fiorerie non si aprono finché non la attiva. */
  readonly blocking: boolean;
}

export function twoFactorDeadline(ownerSince: Date): Date {
  return new Date(ownerSince.getTime() + TWO_FACTOR_POLICY.graceDays * 24 * 60 * 60 * 1000);
}

/** Cosa chiedere alla persona: niente, un avviso con la data, o di attivarla subito. */
export function twoFactorRequirement(
  facts: TwoFactorFacts,
  now: Date = new Date(),
): TwoFactorRequirement {
  const required = facts.hasPassword && facts.ownerSince !== null;
  const deadline =
    required && !facts.enabled && facts.ownerSince ? twoFactorDeadline(facts.ownerSince) : null;
  return {
    enabled: facts.enabled,
    hasPassword: facts.hasPassword,
    required,
    deadline,
    blocking: deadline !== null && deadline.getTime() <= now.getTime(),
  };
}

/** Codice dell'app di autenticazione: 6 cifre (spazi e trattini ignorati). */
export function normalizeTotpCode(value: string): string | null {
  const digits = value.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

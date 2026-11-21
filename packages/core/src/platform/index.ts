/**
 * API di piattaforma (bypass RLS): solo per la CLI amministrativa e i test.
 * Importarle dal web è vietato da ESLint (ADR-019).
 */
export * from './plans';

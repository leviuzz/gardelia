/**
 * API di piattaforma (bypass RLS): solo per la CLI amministrativa e i test.
 * Importarle dal web è vietato da ESLint (ADR-021).
 */
export * from './ai-credits';
export * from './plans';

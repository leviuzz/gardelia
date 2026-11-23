/**
 * API di piattaforma (bypass RLS): solo per la CLI amministrativa e i test.
 * Importarle dal web è vietato da ESLint (ADR-021).
 */
export * from './admins';
export * from './ai-credits';
export * from './plans';
export * from './test-data';
export * from './users';

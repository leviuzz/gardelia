import {
  ConfigurationError,
  configIssues,
  platformConfigSchema,
  type EnvSource,
} from '@floral/core/config';
import { serverEnvSchema } from './env';

/**
 * Tutti i problemi di configurazione insieme: variabili del server web (login, URL, database) e
 * della piattaforma (AI, archivio, email). All'avvio l'app non parte se la lista non è vuota.
 */
export function configurationIssues(env: EnvSource = process.env): string[] {
  const web = serverEnvSchema.safeParse(env);
  const platform = platformConfigSchema.safeParse(env);
  return [
    ...(web.success ? [] : configIssues(web.error)),
    ...(platform.success ? [] : configIssues(platform.error)),
  ];
}

export function assertConfiguration(env: EnvSource = process.env): void {
  const issues = configurationIssues(env);
  if (issues.length > 0) throw new ConfigurationError(issues);
}

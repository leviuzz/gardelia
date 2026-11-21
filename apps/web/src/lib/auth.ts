import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { getMailer, logger, passwordResetEmail, verificationEmail } from '@floral/core';
import { getDb } from '@floral/db';
import { BRAND, newId } from '@floral/domain';
import { googleCredentials, serverEnv } from './env';

/**
 * Autenticazione (identità) con Better Auth: email/password, verifica email obbligatoria,
 * reset password, sessioni su database, rate limiting condiviso su database, login con Google
 * facoltativo (ADR-036).
 *
 * L'AUTORIZZAZIONE (tenant, ruoli, permessi) NON è delegata alla libreria: vive in @floral/core.
 * Le tabelle di identità (User, Session, Account, Verification, RateLimit) non hanno RLS
 * perché la libreria vi accede prima che esista un contesto tenant.
 */
function createAuth() {
  const env = serverEnv();
  const baseURL = env.BETTER_AUTH_URL ?? env.APP_URL;
  const google = googleCredentials(env);

  return betterAuth({
    appName: BRAND.productName,
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(getDb(), { provider: 'postgresql' }),
    trustedOrigins: [env.APP_URL],
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await getMailer().send(passwordResetEmail({ to: user.email, name: user.name, url }));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await getMailer().send(verificationEmail({ to: user.email, name: user.name, url }));
      },
    },
    // Login con Google solo se configurato (senza chiavi il pulsante non compare).
    socialProviders: google
      ? {
          google: {
            clientId: google.clientId,
            clientSecret: google.clientSecret,
            // Scelta dell'account a ogni accesso: utile sui dispositivi condivisi della fioreria.
            prompt: 'select_account',
            // Stessa regola dell'email/password: senza email verificata, nessuna sessione.
            requireEmailVerification: true,
            // Minimizzazione dei dati: la foto del profilo Google non serve e non si salva.
            mapProfileToUser: () => ({ image: undefined }),
          },
        }
      : {},
    account: {
      // Non chiamiamo API di Google, ma Better Auth conserva i token del provider: cifrati.
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        // Collegamento automatico a un account esistente solo se l'email è verificata da Google
        // E nel nostro account: un account creato con l'email di un altro e mai confermato non
        // può essere "agganciato" (default di Better Auth, qui esplicito).
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
        updateUserInfoOnLink: false,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/sign-in/social': { window: 60, max: 10 },
        '/request-password-reset': { window: 300, max: 5 },
        '/send-verification-email': { window: 300, max: 5 },
      },
    },
    advanced: {
      database: { generateId: () => newId() },
      ipAddress: { ipAddressHeaders: [env.TRUSTED_IP_HEADER] },
      useSecureCookies: baseURL.startsWith('https://'),
    },
    databaseHooks: {
      session: {
        create: {
          // Gli utenti sospesi a livello di piattaforma non possono aprire sessioni.
          before: async (session) => {
            const user = await getDb().user.findUnique({
              where: { id: session.userId },
              select: { status: true },
            });
            if (user?.status !== 'ACTIVE') {
              logger.warn({ userId: session.userId }, 'sessione rifiutata: utente non attivo');
              return false;
            }
            return true;
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as typeof globalThis & { __floralAuth?: Auth };

/** Istanza creata alla prima richiesta (la build non richiede segreti a runtime). */
export function getAuth(): Auth {
  globalForAuth.__floralAuth ??= createAuth();
  return globalForAuth.__floralAuth;
}

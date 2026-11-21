/** Team e inviti [CORE-01]. */
import { z } from 'zod';
import { MEMBERSHIP_ROLES } from './permissions';
import { toTrimmedString } from './validation';

/** Validità di un invito. */
export const INVITATION_TTL_DAYS = 7;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const inviteMemberSchema = z.object({
  email: z.preprocess(
    (value) => {
      const trimmed = toTrimmedString(value);
      return typeof trimmed === 'string' ? trimmed.toLowerCase() : trimmed;
    },
    z.email({ error: 'invalid_email' }).max(254, { error: 'too_long' }),
  ),
  role: z.preprocess(toTrimmedString, z.enum(MEMBERSHIP_ROLES, { error: 'invalid_option' })),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const changeRoleSchema = z.object({
  role: z.preprocess(toTrimmedString, z.enum(MEMBERSHIP_ROLES, { error: 'invalid_option' })),
});

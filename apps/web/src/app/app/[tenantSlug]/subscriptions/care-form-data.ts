import 'server-only';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { CareContractFormDto } from '@floral/core';
import { careSiteContact, careSiteContactMatches } from '@floral/domain';
import type {
  CareServiceOption,
  CareSiteContact,
  CareSlotOption,
} from '@/components/care/contract-forms';
import { phoneForInput } from '@/lib/format';

/** Nome del giorno nella lingua di chi guarda (22/11/2026 è una domenica, giorno 0). */
export async function weekdayNamer(): Promise<(weekday: number) => string> {
  const format = await getFormatter();
  return (weekday: number) => {
    const name = format.dateTime(new Date(Date.UTC(2026, 10, 22 + weekday, 12)), {
      weekday: 'long',
      timeZone: 'UTC',
    });
    return name.charAt(0).toLocaleUpperCase() + name.slice(1);
  };
}

/** Le scelte del modulo del contratto già pronte da mostrare (fasce con il nome del giorno). */
export async function contractFormOptions(form: CareContractFormDto): Promise<{
  readonly slots: readonly CareSlotOption[];
  readonly services: readonly CareServiceOption[];
  readonly addresses: readonly {
    readonly id: string;
    readonly label: string;
    readonly line: string;
    readonly contact: CareSiteContact;
  }[];
}> {
  const t = await getTranslations();
  const dayName = await weekdayNamer();
  return {
    slots: form.slots.map((slot) => ({
      id: slot.id,
      weekday: slot.weekday,
      label: t('care.slots.label', {
        day: dayName(slot.weekday),
        start: slot.start,
        end: slot.end,
      }),
    })),
    services: form.services,
    addresses: form.addresses.map((address) => ({
      id: address.id,
      label: address.label ?? address.line,
      line: `${address.line}, ${address.city}`,
      contact: { name: address.contactName, phone: phoneForInput(address.contactPhone) },
    })),
  };
}

/**
 * «Usa i dati del cliente» per la sede di un contratto già salvato (bozza o dettagli): persona e
 * telefono proposti e se l'interruttore parte acceso (dati salvati vuoti o uguali, in E.164).
 */
export function siteContactFor(
  form: CareContractFormDto,
  addressId: string | null,
  saved: { readonly contactName: string | null; readonly contactPhone: string | null },
): { readonly contact: CareSiteContact; readonly useCustomerContact: boolean } {
  const address = form.addresses.find((item) => item.id === addressId);
  const proposed = address
    ? { name: address.contactName, phone: address.contactPhone }
    : careSiteContact({ name: form.customer.name, phone: form.customer.phone }, null);
  return {
    contact: { name: proposed.name, phone: phoneForInput(proposed.phone) },
    useCustomerContact: careSiteContactMatches(
      { name: saved.contactName, phone: saved.contactPhone },
      proposed,
    ),
  };
}

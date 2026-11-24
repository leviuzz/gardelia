import 'server-only';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { CareContractFormDto } from '@floral/core';
import type { CareServiceOption, CareSlotOption } from '@/components/care/contract-forms';

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
    })),
  };
}

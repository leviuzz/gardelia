import type { Availability, CatalogColor } from '@floral/domain';
import type { BadgeVariant } from '@/components/ui/badge';

/** Campioni colore (classi letterali: Tailwind le rileva nel sorgente). */
export const COLOR_SWATCH_CLASS: Record<CatalogColor, string> = {
  red: 'bg-[#c0392b]',
  pink: 'bg-[#f2a7b9]',
  fuchsia: 'bg-[#c2185b]',
  white: 'bg-white',
  cream: 'bg-[#f3e9d2]',
  yellow: 'bg-[#f6c945]',
  orange: 'bg-[#ef8a3c]',
  peach: 'bg-[#f7c6a3]',
  coral: 'bg-[#f27d72]',
  purple: 'bg-[#7e57c2]',
  lilac: 'bg-[#c8a2e0]',
  blue: 'bg-[#5b8def]',
  green: 'bg-[#5f8f5a]',
  burgundy: 'bg-[#7b1e3a]',
  multicolor: 'bg-[conic-gradient(#c0392b,#f6c945,#5f8f5a,#5b8def,#7e57c2,#c0392b)]',
  black: 'bg-[#1f1f1f]',
  gold: 'bg-[linear-gradient(135deg,#b8860b,#f3d36b,#b8860b)]',
  silver: 'bg-[linear-gradient(135deg,#9ea3a8,#eef0f2,#9ea3a8)]',
  brown: 'bg-[#8b5e3c]',
  transparent: 'bg-[repeating-conic-gradient(#e5e7eb_0%_25%,#ffffff_0%_50%)] bg-[length:8px_8px]',
};

export const AVAILABILITY_BADGE: Record<Availability, BadgeVariant> = {
  AVAILABLE: 'success',
  LIMITED: 'warning',
  OUT_OF_STOCK: 'danger',
  ON_REQUEST: 'info',
};

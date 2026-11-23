/**
 * Chiavi colore controllate (catalogo, foto, colore di carta e nastro nel Builder).
 * Modulo senza dipendenze: lo importano catalogo, Builder e foto senza cicli.
 * Le etichette es-MX sono in `messages/es-MX.json` → `catalog.colors.*`.
 */
export const CATALOG_COLORS = [
  'red',
  'pink',
  'fuchsia',
  'white',
  'cream',
  'yellow',
  'orange',
  'peach',
  'coral',
  'purple',
  'lilac',
  'blue',
  'green',
  'burgundy',
  'multicolor',
  // Carte, vasi e nastri (ADR-030).
  'black',
  'gold',
  'silver',
  'brown',
  'transparent',
] as const;
export type CatalogColor = (typeof CATALOG_COLORS)[number];

/**
 * Nome del colore (del vocabolario) per il colore medio dei petali di una foto (0–255 per canale).
 * Serve al controllo dei conteggi quando il catalogo non dice il colore del fiore (ADR-034, 23/11):
 * "Fiore 1" senza colore non dice nulla al modello di visione, "Fiore 1" (red) sì. null se il
 * colore è un grigio indistinto.
 */
export function colorNameOf(r: number, g: number, b: number): CatalogColor | null {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta > 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;

  if (lightness >= 0.9 || (saturation < 0.18 && lightness >= 0.7)) {
    return hue >= 35 && hue < 70 && saturation >= 0.3 && lightness < 0.95 ? 'cream' : 'white';
  }
  if (saturation < 0.12) return lightness < 0.2 ? 'black' : null;
  // Rossi (cremisi compreso): rosa se chiari, bordeaux se scuri.
  if (hue >= 340 || hue < 12) {
    if (lightness > 0.7) return 'pink';
    return lightness < 0.28 ? 'burgundy' : 'red';
  }
  if (hue < 40) return lightness > 0.72 ? 'peach' : 'orange';
  if (hue < 68) return saturation < 0.45 && lightness > 0.72 ? 'cream' : 'yellow';
  if (hue < 165) return 'green';
  if (hue < 255) return 'blue';
  if (hue < 290) return lightness > 0.68 ? 'lilac' : 'purple';
  // Magenta: fucsia se pieno e scuro, altrimenti rosa.
  return saturation > 0.55 && lightness < 0.6 ? 'fuchsia' : 'pink';
}

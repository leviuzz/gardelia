/**
 * Il dispositivo di una sessione, dalla stringa del browser ("Chrome · Android"), per la lista dei
 * dispositivi collegati (ADR-077). Riconosce solo i casi comuni; il resto è "sconosciuto".
 */

export interface DeviceDescription {
  readonly browser: string | null;
  readonly os: string | null;
}

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  // L'ordine conta: Edge, Opera e Samsung si presentano anche come Chrome; Chrome anche come Safari.
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'Mac'],
  [/\bLinux\b/, 'Linux'],
];

function first(table: readonly (readonly [RegExp, string])[], value: string): string | null {
  return table.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

export function describeUserAgent(userAgent: string | null | undefined): DeviceDescription {
  if (!userAgent) return { browser: null, os: null };
  const value = userAgent.slice(0, 512);
  return { browser: first(BROWSERS, value), os: first(SYSTEMS, value) };
}

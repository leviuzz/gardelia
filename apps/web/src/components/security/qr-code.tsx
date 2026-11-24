'use client';

import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * QR disegnato in SVG nel browser (ADR-077): il testo (la chiave dell'app di autenticazione) non
 * passa da nessun server né da un URL. Moduli neri su bianco con il margine standard, anche in tema
 * scuro, perché le fotocamere lo leggano.
 */
export function QrCode({
  value,
  label,
  size = 192,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const path = useMemo(() => {
    const { data } = encode(value, { border: 2 });
    let d = '';
    data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { d, modules: data.length };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${path.modules} ${path.modules}`}
      shapeRendering="crispEdges"
      className="rounded-lg border bg-white"
    >
      <rect width={path.modules} height={path.modules} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

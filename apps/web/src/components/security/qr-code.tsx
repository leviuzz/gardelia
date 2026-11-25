'use client';

import { useMemo } from 'react';
import { encode } from 'uqr';

/** Moduli del QR con il margine standard: li usano il disegno SVG e il PNG da scaricare. */
export function qrModules(value: string): readonly (readonly boolean[])[] {
  return encode(value, { border: 2 }).data;
}

/**
 * Il QR in PNG (circa `size` pixel di lato), moduli neri su bianco, da stampare (link del negozio,
 * M1-2). Disegnato nel browser, senza librerie in più.
 */
export async function qrPngBlob(value: string, size = 1024): Promise<Blob> {
  const modules = qrModules(value);
  const scale = Math.max(1, Math.floor(size / modules.length));
  const canvas = document.createElement('canvas');
  canvas.width = modules.length * scale;
  canvas.height = modules.length * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas non disponibile');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) context.fillRect(x * scale, y * scale, scale, scale);
    });
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG non creato'))),
      'image/png',
    );
  });
}

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
    const data = qrModules(value);
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

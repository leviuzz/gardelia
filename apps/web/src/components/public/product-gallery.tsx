'use client';

import { ChevronLeft, ChevronRight, Flower2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface GalleryPhoto {
  readonly id: string;
  /** Foto grande (fino a 1600 px) e miniatura (fino a 480 px). */
  readonly src: string;
  readonly thumbSrc: string;
}

/**
 * Le foto del prodotto nella vetrina (M1): le miniature cambiano la foto grande, toccandola si apre
 * a schermo intero con avanti e indietro (anche con le frecce della tastiera).
 */
export function ProductGallery({
  photos,
  name,
}: {
  readonly photos: readonly GalleryPhoto[];
  readonly name: string;
}) {
  const t = useTranslations('publicStore');
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const count = photos.length;
  const current = photos[Math.min(index, count - 1)];
  if (!current) {
    return (
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border bg-muted">
        <Flower2 className="size-14 text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }
  const go = (delta: number) => setIndex((value) => (value + delta + count) % count);
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('galleryOpen', { index: index + 1, count })}
        className="block aspect-square w-full cursor-zoom-in overflow-hidden rounded-2xl border bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        data-testid="gallery-main"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- foto servite dall'app. */}
        <img src={current.src} alt={t('photoAlt', { name })} className="size-full object-cover" />
      </button>
      {count > 1 ? (
        <ul className="grid grid-cols-5 gap-2">
          {photos.map((photo, at) => (
            <li key={photo.id}>
              <button
                type="button"
                onClick={() => setIndex(at)}
                aria-label={t('galleryShow', { index: at + 1, count })}
                aria-current={at === index ? 'true' : undefined}
                className={cn(
                  'block aspect-square w-full overflow-hidden rounded-xl border bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                  at === index && 'ring-2 ring-primary',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- miniature servite dall'app. */}
                <img
                  src={photo.thumbSrc}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          closeLabel={t('galleryClose')}
          className="max-w-3xl gap-3 p-3 pt-12 sm:p-4 sm:pt-12"
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') go(-1);
            if (event.key === 'ArrowRight') go(1);
          }}
          data-testid="gallery-dialog"
        >
          <DialogTitle className="sr-only">{t('galleryTitle', { name })}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element -- foto servite dall'app. */}
          <img
            src={current.src}
            alt={t('photoAlt', { name })}
            className="max-h-[70dvh] w-full rounded-xl object-contain"
          />
          {count > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => go(-1)}
                aria-label={t('galleryPrevious')}
              >
                <ChevronLeft />
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t('galleryCounter', { index: index + 1, count })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => go(1)}
                aria-label={t('galleryNext')}
              >
                <ChevronRight />
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

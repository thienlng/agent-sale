import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * A cover photo that fills its (positioned) box like `object-cover`, kept sharp.
 *
 * Browsers shrink a large photo (owners upload ~2000 px phone shots) into a ~370 px card with a
 * fast filter that looks soft. Once the photo has loaded, a canvas on top redraws it at the box's
 * device-pixel size with high-quality smoothing, and again whenever the box resizes. The plain
 * <img> stays underneath as the fallback (no canvas, cross-origin or decode failure).
 */
export function CoverImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string | undefined;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || typeof ResizeObserver === 'undefined') return;
    const draw = () => {
      const w = Math.round(canvas.clientWidth * window.devicePixelRatio);
      const h = Math.round(canvas.clientHeight * window.devicePixelRatio);
      const { naturalWidth: nw, naturalHeight: nh } = img;
      if (!img.complete || !nw || !nh || !w || !h) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      // object-cover: scale to fill, crop the overflow evenly on both sides.
      const scale = Math.max(w / nw, h / nh);
      const sw = w / scale;
      const sh = h / scale;
      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      try {
        ctx.drawImage(img, (nw - sw) / 2, (nh - sh) / 2, sw, sh, 0, 0, w, h);
        canvas.dataset.ready = 'true';
      } catch {
        delete canvas.dataset.ready;
      }
    };
    img.addEventListener('load', draw);
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => {
      img.removeEventListener('load', draw);
      observer.disconnect();
    };
  }, [src]);

  return (
    <>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className={cn('absolute inset-0 size-full object-cover', className)}
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full opacity-0 data-[ready=true]:opacity-100"
      />
    </>
  );
}

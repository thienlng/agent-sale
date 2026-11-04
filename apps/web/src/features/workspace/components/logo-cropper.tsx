import { LOGO_RULES } from '@agent-sales/contracts';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** On-screen side of the square crop frame, in CSS pixels. */
const FRAME = 280;
/** Side of the exported logo; the server accepts 128–2048, 720 is the recommended size. */
const OUTPUT = 720;
const MAX_ZOOM = 4;

export interface CropState {
  zoom: number;
  /** Offset of the image's top-left corner from the frame's, in frame pixels (≤ 0). */
  x: number;
  y: number;
}

/** Scale at zoom 1: the image just covers the frame (its short side fills it). */
export function coverScale(width: number, height: number, frame = FRAME): number {
  return Math.max(frame / width, frame / height);
}

/** Keeps the frame fully covered by the image, so the crop never shows empty space. */
export function clampCrop(
  state: CropState,
  width: number,
  height: number,
  frame = FRAME,
): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, state.zoom));
  const scale = coverScale(width, height, frame) * zoom;
  const minX = frame - width * scale;
  const minY = frame - height * scale;
  return {
    zoom,
    x: Math.min(0, Math.max(minX, state.x)),
    y: Math.min(0, Math.max(minY, state.y)),
  };
}

/** The source rectangle (in image pixels) that the frame shows. */
export function cropRect(state: CropState, width: number, height: number, frame = FRAME) {
  const scale = coverScale(width, height, frame) * state.zoom;
  return { sx: -state.x / scale, sy: -state.y / scale, side: frame / scale };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Renders the crop to a square PNG (keeps transparency) and falls back to JPEG
 * on a white background when the PNG would exceed the server's size limit.
 */
async function exportCrop(img: HTMLImageElement, state: CropState): Promise<File> {
  const { sx, sy, side } = cropRect(state, img.naturalWidth, img.naturalHeight);
  const out = Math.round(Math.min(OUTPUT, Math.max(LOGO_RULES.minSide, side)));
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out);
  const png = await toBlob(canvas, 'image/png');
  if (png && png.size <= LOGO_RULES.maxBytes) {
    return new File([png], 'logo.png', { type: 'image/png' });
  }
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out, out);
  for (const quality of [0.92, 0.8, 0.65]) {
    const jpg = await toBlob(canvas, 'image/jpeg', quality);
    if (jpg && jpg.size <= LOGO_RULES.maxBytes) {
      return new File([jpg], 'logo.jpg', { type: 'image/jpeg' });
    }
  }
  throw new Error('logo too large after export');
}

/**
 * Facebook-style logo picker: any image the browser can open, cropped to a
 * square by dragging and zooming, then exported at 720 × 720 for the server.
 */
export function LogoCropper({
  file,
  onCancel,
  onDone,
  onUnreadable,
}: {
  file: File | null;
  onCancel: () => void;
  onDone: (logo: File) => void;
  onUnreadable: () => void;
}) {
  const { t } = useTranslation();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CropState>({ zoom: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  // Latest callback without reloading the image when the parent re-renders.
  const unreadable = useRef(onUnreadable);
  unreadable.current = onUnreadable;
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    setImg(null);
    if (!file) return;
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      const w = el.naturalWidth;
      const h = el.naturalHeight;
      const scale = coverScale(w, h);
      // Start centred.
      setCrop({ zoom: 1, x: (FRAME - w * scale) / 2, y: (FRAME - h * scale) / 2 });
      setImg(el);
    };
    el.onerror = () => unreadable.current();
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const w = img?.naturalWidth ?? 1;
  const h = img?.naturalHeight ?? 1;
  const scale = coverScale(w, h) * crop.zoom;

  /** Zooms around the frame centre so the subject stays in view. */
  const zoomTo = (zoom: number) => {
    setCrop((c) => {
      const next = Math.min(MAX_ZOOM, Math.max(1, zoom));
      const ratio = next / c.zoom;
      const mid = FRAME / 2;
      return clampCrop(
        { zoom: next, x: mid - (mid - c.x) * ratio, y: mid - (mid - c.y) * ratio },
        w,
        h,
      );
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setCrop((c) => clampCrop({ ...c, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }, w, h));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const save = async () => {
    if (!img) return;
    setBusy(true);
    try {
      onDone(await exportCrop(img, crop));
    } catch {
      onUnreadable();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={file !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('wsettings.logo.cropTitle')}</DialogTitle>
          <DialogDescription>{t('wsettings.logo.cropHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4">
          <div
            role="img"
            aria-label={t('wsettings.logo.cropArea')}
            className="relative touch-none overflow-hidden rounded-xl bg-muted select-none"
            style={{ width: FRAME, height: FRAME, cursor: img ? 'grab' : 'default' }}
            onPointerDown={img ? onPointerDown : undefined}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={(e) => img && zoomTo(crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
          >
            {img ? (
              <img
                src={img.src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
                style={{
                  width: w,
                  height: h,
                  transform: `translate(${crop.x}px, ${crop.y}px) scale(${scale})`,
                }}
              />
            ) : null}
            {/* Grid guides, like most photo croppers. */}
            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 rounded-xl ring-1 ring-white/70 ring-inset">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} className="border-[0.5px] border-white/30" />
              ))}
            </div>
          </div>
          <div className="flex w-full items-center gap-2">
            <ZoomOut className="size-4 text-muted-foreground" aria-hidden />
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={crop.zoom}
              disabled={!img}
              aria-label={t('wsettings.logo.zoom')}
              className="w-full accent-primary"
              onChange={(e) => zoomTo(Number(e.target.value))}
            />
            <ZoomIn className="size-4 text-muted-foreground" aria-hidden />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={!img || busy} onClick={() => void save()}>
            {t('wsettings.logo.cropSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

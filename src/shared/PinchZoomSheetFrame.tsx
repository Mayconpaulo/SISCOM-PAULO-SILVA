import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { useTabletCanvasBounds } from './WorkspaceSplitLayout';

interface PinchZoomSheetFrameProps {
  children: React.ReactNode;
  maxWidthClass?: string;
  className?: string;
  /** Natural width/height aspect ratio of the sheet (defaults to A4 portrait 210/297) */
  sheetAspectRatio?: number;
  /** Optional vertical pixels reserved for page header labels above the sheet */
  reserveHeight?: number;
}

interface PinchState {
  startDist: number;
  startZoom: number;
  ratioX: number;
  ratioY: number;
}

interface PendingScroll {
  ratioX: number;
  ratioY: number;
  midX: number;
  midY: number;
  nextZoom: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3.5;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function getTouchDistance(t0: Touch, t1: Touch): number {
  return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
}

export const PinchZoomSheetFrame: React.FC<PinchZoomSheetFrameProps> = ({
  children,
  maxWidthClass = 'max-w-[620px]',
  className = '',
  sheetAspectRatio = 210 / 297,
  reserveHeight = 0,
}) => {
  const tabletBounds = useTabletCanvasBounds();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [baseWidth, setBaseWidth] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1);

  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const baseWidthRef = useRef(0);
  baseWidthRef.current = baseWidth;

  const pinchRef = useRef<PinchState | null>(null);
  const pendingScrollRef = useRef<PendingScroll | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const updateWidth = () => {
      const w = el.clientWidth;
      if (w > 0) {
        setBaseWidth(w);
      }
    };

    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateWidth);
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!pending || !viewport || !content) return;
    pendingScrollRef.current = null;

    const contentW = content.offsetWidth || viewport.clientWidth;
    const contentH = content.offsetHeight || viewport.clientHeight;
    const maxScrollX = Math.max(0, contentW - viewport.clientWidth);
    const maxScrollY = Math.max(0, contentH - viewport.clientHeight);

    viewport.scrollLeft = Math.min(
      maxScrollX,
      Math.max(0, pending.ratioX * contentW - pending.midX)
    );
    viewport.scrollTop = Math.min(
      maxScrollY,
      Math.max(0, pending.ratioY * contentH - pending.midY)
    );
  }, [zoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const content = contentRef.current;
        const rect = viewport.getBoundingClientRect();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = getTouchDistance(t0, t1);
        if (dist <= 0) return;

        const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const midY = (t0.clientY + t1.clientY) / 2 - rect.top;
        const contentW = content?.offsetWidth || viewport.clientWidth || 1;
        const contentH = content?.offsetHeight || viewport.clientHeight || 1;

        pinchRef.current = {
          startDist: dist,
          startZoom: zoomRef.current,
          ratioX: Math.min(1, Math.max(0, (viewport.scrollLeft + midX) / contentW)),
          ratioY: Math.min(1, Math.max(0, (viewport.scrollTop + midY) / contentH)),
        };
        lastTapRef.current = null;
      } else if (e.touches.length === 1) {
        pinchRef.current = null;
        const t = e.touches[0];
        const now = Date.now();
        const prev = lastTapRef.current;
        if (
          prev &&
          now - prev.time < 280 &&
          Math.hypot(t.clientX - prev.x, t.clientY - prev.y) < 26
        ) {
          lastTapRef.current = null;
          e.preventDefault();
          const currentZ = zoomRef.current;
          if (currentZ > 1.05) {
            pendingScrollRef.current = {
              ratioX: 0.5,
              ratioY: 0.5,
              midX: viewport.clientWidth / 2,
              midY: viewport.clientHeight / 2,
              nextZoom: 1,
            };
            setZoom(1);
          } else {
            const content = contentRef.current;
            const rect = viewport.getBoundingClientRect();
            const midX = t.clientX - rect.left;
            const midY = t.clientY - rect.top;
            const contentW = content?.offsetWidth || viewport.clientWidth || 1;
            const contentH = content?.offsetHeight || viewport.clientHeight || 1;
            const nextZoom = 2.0;
            pendingScrollRef.current = {
              ratioX: Math.min(1, Math.max(0, (viewport.scrollLeft + midX) / contentW)),
              ratioY: Math.min(1, Math.max(0, (viewport.scrollTop + midY) / contentH)),
              midX,
              midY,
              nextZoom,
            };
            setZoom(nextZoom);
          }
        } else {
          lastTapRef.current = { time: now, x: t.clientX, y: t.clientY };
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const curDist = getTouchDistance(t0, t1);
        const start = pinchRef.current;
        if (start.startDist <= 0) return;

        const nextZoom = clampZoom(start.startZoom * (curDist / start.startDist));
        const midX = (t0.clientX + t1.clientX) / 2 - rect.left;
        const midY = (t0.clientY + t1.clientY) / 2 - rect.top;

        pendingScrollRef.current = {
          ratioX: start.ratioX,
          ratioY: start.ratioY,
          midX,
          midY,
          nextZoom,
        };
        setZoom(nextZoom);
      } else if (e.touches.length === 1 && lastTapRef.current) {
        const t = e.touches[0];
        if (Math.hypot(t.clientX - lastTapRef.current.x, t.clientY - lastTapRef.current.y) > 12) {
          lastTapRef.current = null;
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchRef.current = null;
        if (zoomRef.current < 1.05 && zoomRef.current !== 1) {
          setZoom(1);
        }
      }
    };

    viewport.addEventListener('touchstart', handleTouchStart, { passive: false });
    viewport.addEventListener('touchmove', handleTouchMove, { passive: false });
    viewport.addEventListener('touchend', handleTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      viewport.removeEventListener('touchstart', handleTouchStart);
      viewport.removeEventListener('touchmove', handleTouchMove);
      viewport.removeEventListener('touchend', handleTouchEnd);
      viewport.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  const isZoomed = zoom > 1.02;

  const adjustZoomStep = (delta: number) => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const nextZoom = clampZoom(Math.round((zoom + delta) * 100) / 100);
    const snapped = nextZoom < 1.05 ? 1 : nextZoom;
    if (viewport && content) {
      const midX = viewport.clientWidth / 2;
      const midY = viewport.clientHeight / 2;
      const contentW = content.offsetWidth || viewport.clientWidth || 1;
      const contentH = content.offsetHeight || viewport.clientHeight || 1;
      pendingScrollRef.current = {
        ratioX: (viewport.scrollLeft + midX) / contentW,
        ratioY: (viewport.scrollTop + midY) / contentH,
        midX,
        midY,
        nextZoom: snapped,
      };
    }
    setZoom(snapped);
  };

  const tabletFitWidth =
    tabletBounds && tabletBounds.width > 0 && tabletBounds.height > 0
      ? Math.max(
          220,
          Math.floor(
            Math.min(
              tabletBounds.width,
              Math.max(180, tabletBounds.height - reserveHeight) * sheetAspectRatio
            )
          )
        )
      : null;

  const zoomedMaxHeight =
    isZoomed && tabletBounds && tabletBounds.height > 0
      ? `${Math.max(260, tabletBounds.height - reserveHeight - 44)}px`
      : isZoomed
        ? '76dvh'
        : undefined;

  return (
    <div
      style={tabletFitWidth ? { width: `${tabletFitWidth}px`, maxWidth: '100%' } : undefined}
      className={`${
        tabletFitWidth ? 'my-auto' : `w-full ${maxWidthClass}`
      } mx-auto relative print-zoom-reset print-wrapper`}
    >
      {isZoomed && (
        <div className="no-print mb-2 flex items-center justify-between gap-2 rounded-xl siscom-liquid-panel px-2.5 py-1.5 text-xs text-[#E8E4D8]">
          <span className="font-mono text-[#E5C17B]">{Math.round(zoom * 100)}%</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => adjustZoomStep(-0.35)}
              aria-label="Diminuir zoom"
              className="h-7 w-7 inline-flex items-center justify-center rounded-lg border border-white/14 bg-white/[0.06] hover:bg-white/[0.12] text-[#E8E4D8] cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => adjustZoomStep(0.35)}
              aria-label="Aumentar zoom"
              className="h-7 w-7 inline-flex items-center justify-center rounded-lg border border-white/14 bg-white/[0.06] hover:bg-white/[0.12] text-[#E8E4D8] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="h-7 px-2.5 inline-flex items-center gap-1 rounded-lg border border-[#C9A961]/42 bg-[#C9A961]/14 hover:bg-[#C9A961]/24 text-[11px] font-medium text-[#F4E6C4] cursor-pointer"
            >
              <Maximize2 className="w-3 h-3" />
              <span>Folha inteira</span>
            </button>
          </div>
        </div>
      )}

      <div
        ref={viewportRef}
        style={{
          touchAction: 'pan-x pan-y',
          WebkitOverflowScrolling: 'touch',
          maxHeight: zoomedMaxHeight,
        }}
        className={`w-full print-zoom-reset print-wrapper ${
          isZoomed ? 'overflow-auto' : 'overflow-hidden'
        } ${className}`}
      >
        <div
          ref={contentRef}
          style={{
            width: isZoomed && baseWidth > 0 ? `${Math.round(baseWidth * zoom)}px` : '100%',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
          className="print-zoom-reset"
        >
          {children}
        </div>
      </div>
    </div>
  );
};

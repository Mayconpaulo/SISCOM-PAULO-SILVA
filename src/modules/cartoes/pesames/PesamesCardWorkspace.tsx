import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { logActivity } from '../../../core/audit/activityLogger';
import {
  Download,
  Minus,
  Move,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  PESAMES_BG_ASSET,
  PESAMES_CIRCLE,
  PESAMES_H_PX,
  PESAMES_W_PX,
  type PesamesCardData,
  type PesamesPhotoMode,
  type PesamesPrefix,
  computeCircleImageGeometry,
  fitPesamesRecipientText,
  formatPesamesRecipientLine,
  generatePesamesPngBlob,
} from './pesamesCard';
import { isSafeImageObjectOrDataUrl } from '../../../shared/htmlSanitizer';
import { getSecureVaultItem, setSecureVaultItem } from '../../../core/privacy/privacyVault';
import { PinchZoomSheetFrame } from '../../../shared/PinchZoomSheetFrame';
import {
  WorkspaceSplitLayout,
  type TabletWorkspaceDrawer,
} from '../../../shared/WorkspaceSplitLayout';
import {
  TabletRibbonButton,
  TabletRibbonDivider,
  TabletRibbonGroup,
  TabletRibbonIconButton,
  TabletRibbonRow,
  TabletRibbonSegment,
} from '../../../shared/TabletRibbonPrimitives';
import { fadeSlideVariants } from '../../../shared/motion';
import { SiscomAlert, SiscomSegmentedTabs, SiscomSpinner } from '../../../shared/ui';

const PESAMES_STORAGE_KEY = 'siscom_pesames_state_v1';

interface StoredPesamesPrefs {
  prefix: PesamesPrefix;
  recipientName: string;
  photoMode: PesamesPhotoMode;
  photoScale: number;
  photoOffsetX: number;
  photoOffsetY: number;
  migratedRemetentePlaceholder?: boolean;
}

function loadInitialPesamesPrefs(): StoredPesamesPrefs {
  const fallback: StoredPesamesPrefs = {
    prefix: 'À',
    recipientName: '',
    photoMode: 'com_foto',
    photoScale: 1,
    photoOffsetX: 0,
    photoOffsetY: 0,
    migratedRemetentePlaceholder: true,
  };
  try {
    const raw = getSecureVaultItem(PESAMES_STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<StoredPesamesPrefs>;
    const savedName = typeof p.recipientName === 'string' ? p.recipientName : '';
    const isOldDefault = savedName.trim().toUpperCase() === 'SRA. LIA';
    return {
      prefix: p.prefix === 'AO' ? 'AO' : 'À',
      recipientName:
        !p.migratedRemetentePlaceholder && isOldDefault ? '' : savedName,
      photoMode: p.photoMode === 'sem_foto' ? 'sem_foto' : 'com_foto',
      photoScale:
        typeof p.photoScale === 'number' && Number.isFinite(p.photoScale)
          ? Math.min(4, Math.max(0.4, p.photoScale))
          : 1,
      photoOffsetX:
        typeof p.photoOffsetX === 'number' && Number.isFinite(p.photoOffsetX)
          ? p.photoOffsetX
          : 0,
      photoOffsetY:
        typeof p.photoOffsetY === 'number' && Number.isFinite(p.photoOffsetY)
          ? p.photoOffsetY
          : 0,
      migratedRemetentePlaceholder: true,
    };
  } catch {
    return fallback;
  }
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface PesamesCardWorkspaceProps {
  onSwitchToBoasVindas: () => void;
  onSwitchToAniversario: () => void;
  externalDownloadSignal?: number;
}

const CROP_UI_DIAM = 200;

export const PesamesCardWorkspace: React.FC<PesamesCardWorkspaceProps> = ({
  onSwitchToBoasVindas,
  onSwitchToAniversario,
  externalDownloadSignal = 0,
}) => {
  const [initial] = useState<StoredPesamesPrefs>(() => loadInitialPesamesPrefs());
  const [prefix, setPrefix] = useState<PesamesPrefix>(initial.prefix);
  const [recipientName, setRecipientName] = useState<string>(initial.recipientName);
  const [photoMode, setPhotoMode] = useState<PesamesPhotoMode>(initial.photoMode);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoNaturalW, setPhotoNaturalW] = useState<number>(0);
  const [photoNaturalH, setPhotoNaturalH] = useState<number>(0);
  const [photoFileName, setPhotoFileName] = useState<string | null>(null);
  const [photoScale, setPhotoScale] = useState<number>(initial.photoScale);
  const [photoOffsetX, setPhotoOffsetX] = useState<number>(initial.photoOffsetX);
  const [photoOffsetY, setPhotoOffsetY] = useState<number>(initial.photoOffsetY);

  const [isExportingPng, setIsExportingPng] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tabletPhotoDrawerOpen, setTabletPhotoDrawerOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cropAreaRef = useRef<HTMLDivElement>(null);
  const activeObjectUrlRef = useRef<string | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origOffsetX: number;
    origOffsetY: number;
  } | null>(null);
  const cropPinchRef = useRef<{ startDist: number; startScale: number } | null>(null);
  const photoScaleRef = useRef<number>(photoScale);
  photoScaleRef.current = photoScale;

  useEffect(() => {
    try {
      const payload: StoredPesamesPrefs = {
        prefix,
        recipientName,
        photoMode,
        photoScale,
        photoOffsetX,
        photoOffsetY,
        migratedRemetentePlaceholder: true,
      };
      setSecureVaultItem(PESAMES_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, [prefix, recipientName, photoMode, photoScale, photoOffsetX, photoOffsetY]);

  useEffect(() => {
    const handlePurged = () => {
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
      setPrefix('À');
      setRecipientName('');
      setPhotoMode('com_foto');
      setPhotoUrl(null);
      setPhotoNaturalW(0);
      setPhotoNaturalH(0);
      setPhotoFileName(null);
      setPhotoScale(1);
      setPhotoOffsetX(0);
      setPhotoOffsetY(0);
      setErrorMsg(null);
    };
    window.addEventListener('siscom:vault-purged', handlePurged);
    return () => window.removeEventListener('siscom:vault-purged', handlePurged);
  }, []);

  useEffect(() => {
    return () => {
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
    };
  }, []);

  // Support two-finger pinch resize directly on the interactive circle framing box
  useEffect(() => {
    const el = cropAreaRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        dragRef.current = null;
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        if (dist > 0) {
          cropPinchRef.current = { startDist: dist, startScale: photoScaleRef.current };
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && cropPinchRef.current) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const curDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        const start = cropPinchRef.current;
        if (start.startDist > 0) {
          const next = Math.min(4, Math.max(0.4, start.startScale * (curDist / start.startDist)));
          setPhotoScale(Number(next.toFixed(3)));
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        cropPinchRef.current = null;
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [photoUrl, photoMode]);

  const handleUploadPhoto = (file: File) => {
    setErrorMsg(null);
    if (file.type.toLowerCase() === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
      setErrorMsg('Por segurança, use imagens rasterizadas (PNG, JPG, WEBP ou GIF).');
      return;
    }
    // Zero limit on file size or dimensions: use Object URL directly
    const nextObjectUrl = URL.createObjectURL(file);
    if (!isSafeImageObjectOrDataUrl(nextObjectUrl)) {
      URL.revokeObjectURL(nextObjectUrl);
      setErrorMsg('Formato de URL de imagem inválido.');
      return;
    }
    const probe = new Image();
    probe.onload = () => {
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
      }
      activeObjectUrlRef.current = nextObjectUrl;
      setPhotoUrl(nextObjectUrl);
      setPhotoNaturalW(probe.naturalWidth || PESAMES_CIRCLE.diam);
      setPhotoNaturalH(probe.naturalHeight || PESAMES_CIRCLE.diam);
      setPhotoFileName(file.name);
      setPhotoScale(1);
      setPhotoOffsetX(0);
      setPhotoOffsetY(0);
      setPhotoMode('com_foto');
    };
    probe.onerror = () => {
      URL.revokeObjectURL(nextObjectUrl);
      setErrorMsg('Não foi possível abrir esta imagem. Tente outro arquivo.');
    };
    probe.src = nextObjectUrl;
  };

  const handleRemovePhoto = () => {
    if (activeObjectUrlRef.current) {
      URL.revokeObjectURL(activeObjectUrlRef.current);
      activeObjectUrlRef.current = null;
    }
    setPhotoUrl(null);
    setPhotoNaturalW(0);
    setPhotoNaturalH(0);
    setPhotoFileName(null);
    setPhotoScale(1);
    setPhotoOffsetX(0);
    setPhotoOffsetY(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const recipientLine = useMemo(
    () => formatPesamesRecipientLine(prefix, recipientName),
    [prefix, recipientName]
  );

  const fittedRecipient = useMemo(
    () => fitPesamesRecipientText(recipientLine),
    [recipientLine]
  );

  const circlePhotoGeom = useMemo(() => {
    if (!photoUrl || photoNaturalW <= 0 || photoNaturalH <= 0) return null;
    return computeCircleImageGeometry(
      photoNaturalW,
      photoNaturalH,
      PESAMES_CIRCLE.cx,
      PESAMES_CIRCLE.cy,
      PESAMES_CIRCLE.diam,
      photoScale,
      photoOffsetX,
      photoOffsetY
    );
  }, [photoUrl, photoNaturalW, photoNaturalH, photoScale, photoOffsetX, photoOffsetY]);

  const miniCropGeom = useMemo(() => {
    if (!photoUrl || photoNaturalW <= 0 || photoNaturalH <= 0) return null;
    const uiRatio = CROP_UI_DIAM / PESAMES_CIRCLE.diam;
    return computeCircleImageGeometry(
      photoNaturalW,
      photoNaturalH,
      CROP_UI_DIAM / 2,
      CROP_UI_DIAM / 2,
      CROP_UI_DIAM,
      photoScale,
      photoOffsetX * uiRatio,
      photoOffsetY * uiRatio
    );
  }, [photoUrl, photoNaturalW, photoNaturalH, photoScale, photoOffsetX, photoOffsetY]);

  const cardData: PesamesCardData = useMemo(
    () => ({
      prefix,
      recipientName,
      photoMode,
      photoUrl,
      photoNaturalW,
      photoNaturalH,
      photoScale,
      photoOffsetX,
      photoOffsetY,
    }),
    [
      prefix,
      recipientName,
      photoMode,
      photoUrl,
      photoNaturalW,
      photoNaturalH,
      photoScale,
      photoOffsetX,
      photoOffsetY,
    ]
  );

  const handleDownloadPng = async () => {
    setErrorMsg(null);
    setIsExportingPng(true);
    try {
      const blob = await generatePesamesPngBlob(cardData);
      const slug = (recipientLine || 'pesames')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 60);
      triggerBlobDownload(blob, `cartao-pesames-${slug || 'militar'}.png`);
      void logActivity({
        module: 'cartoes',
        action: 'export_pesames_png',
        summary: `Exportou cartão de pêsames: ${recipientLine || 'Militar'}`,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao exportar PNG.');
    } finally {
      setIsExportingPng(false);
    }
  };

  useEffect(() => {
    if (externalDownloadSignal > 0) {
      void handleDownloadPng();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalDownloadSignal]);

  const cardScaleFactor = PESAMES_CIRCLE.diam / CROP_UI_DIAM;

  const photoCropEditor =
    photoUrl && miniCropGeom ? (
      <div className="siscom-liquid-subcard rounded-xl p-3.5 space-y-3.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-[#C6D4CC] font-medium">
            <Move className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Ajustar foto</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setPhotoScale(1);
              setPhotoOffsetX(0);
              setPhotoOffsetY(0);
            }}
            className="inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A8D6BC] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Centralizar</span>
          </button>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div
            ref={cropAreaRef}
            onPointerDown={(e) => {
              if (e.button !== 0 && e.pointerType === 'mouse') return;
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                origOffsetX: photoOffsetX,
                origOffsetY: photoOffsetY,
              };
            }}
            onPointerMove={(e) => {
              const drag = dragRef.current;
              if (!drag || drag.pointerId !== e.pointerId || cropPinchRef.current) return;
              const dx = (e.clientX - drag.startX) * cardScaleFactor;
              const dy = (e.clientY - drag.startY) * cardScaleFactor;
              setPhotoOffsetX(
                Math.min(500, Math.max(-500, Math.round(drag.origOffsetX + dx)))
              );
              setPhotoOffsetY(
                Math.min(500, Math.max(-500, Math.round(drag.origOffsetY + dy)))
              );
            }}
            onPointerUp={(e) => {
              if (dragRef.current?.pointerId === e.pointerId) {
                dragRef.current = null;
              }
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.08 : -0.08;
              setPhotoScale((prev) =>
                Math.min(4, Math.max(0.4, Number((prev + delta).toFixed(3))))
              );
            }}
            style={{
              width: `${CROP_UI_DIAM}px`,
              height: `${CROP_UI_DIAM}px`,
              touchAction: 'none',
            }}
            className="relative rounded-full overflow-hidden border-2 border-[#83B499]/55 bg-[#141414] cursor-grab active:cursor-grabbing select-none shadow-inner"
          >
            <img
              src={photoUrl}
              alt="Ajuste da foto no círculo"
              draggable={false}
              style={{
                position: 'absolute',
                left: `${miniCropGeom.x}px`,
                top: `${miniCropGeom.y}px`,
                width: `${miniCropGeom.width}px`,
                height: `${miniCropGeom.height}px`,
                maxWidth: 'none',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#98A89F]">Tamanho da foto</span>
            <span className="font-mono text-[#E5C17B]">
              {Math.round(photoScale * 100)}%
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setPhotoScale((prev) =>
                  Math.max(0.4, Number((prev - 0.1).toFixed(2)))
                )
              }
              aria-label="Diminuir foto"
              className="siscom-btn siscom-btn-secondary !min-h-[38px] !w-[38px] !px-0 shrink-0"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>

            <input
              type="range"
              aria-label="Redimensionar foto no círculo"
              min={0.4}
              max={4}
              step={0.02}
              value={photoScale}
              onChange={(e) => setPhotoScale(Number(e.target.value))}
              className="flex-1 accent-[#2D5A43] cursor-pointer"
            />

            <button
              type="button"
              onClick={() =>
                setPhotoScale((prev) =>
                  Math.min(4, Number((prev + 0.1).toFixed(2)))
                )
              }
              aria-label="Aumentar foto"
              className="siscom-btn siscom-btn-secondary !min-h-[38px] !w-[38px] !px-0 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    ) : null;

  const activeTabletDrawer: TabletWorkspaceDrawer | null =
    tabletPhotoDrawerOpen && photoMode === 'com_foto' && photoCropEditor
      ? {
          title: 'Ajustar Foto no Círculo',
          anchor: 'top',
          onClose: () => setTabletPhotoDrawerOpen(false),
          content: photoCropEditor,
        }
      : null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleUploadPhoto(file);
            setTabletPhotoDrawerOpen(true);
          }
        }}
      />

      <WorkspaceSplitLayout
        sidebarWidthClass="lg:w-[300px] xl:w-[325px]"
        rightSidebarWidthClass="lg:w-[275px] xl:w-[295px]"
        tabletDrawer={activeTabletDrawer}
        tabletTopBar={
          <TabletRibbonRow className="justify-between">
            <TabletRibbonGroup>
              <TabletRibbonSegment
                ariaLabel="Modelo de cartão"
                value="pesames"
                onChange={(val) => {
                  if (val === 'boas_vindas') onSwitchToBoasVindas();
                  if (val === 'aniversario') onSwitchToAniversario();
                }}
                options={[
                  { value: 'boas_vindas', label: 'Boas-Vindas' },
                  { value: 'aniversario', label: 'Aniversário' },
                  { value: 'pesames', label: 'Pêsames' },
                ]}
              />

              <TabletRibbonDivider />

              <TabletRibbonSegment
                ariaLabel="Modo de foto"
                value={photoMode}
                onChange={(next) => {
                  setPhotoMode(next);
                  if (next === 'sem_foto') setTabletPhotoDrawerOpen(false);
                }}
                options={[
                  { value: 'sem_foto', label: 'Sem foto' },
                  { value: 'com_foto', label: 'Com foto' },
                ]}
              />

              {photoMode === 'com_foto' && (
                <>
                  <TabletRibbonButton
                    variant="gold"
                    onClick={() => fileInputRef.current?.click()}
                    icon={<Upload className="w-3.5 h-3.5" />}
                  >
                    {photoUrl ? 'Trocar foto' : 'Enviar foto'}
                  </TabletRibbonButton>

                  {photoUrl && (
                    <>
                      <TabletRibbonButton
                        chevron
                        open={tabletPhotoDrawerOpen}
                        onClick={() => setTabletPhotoDrawerOpen((v) => !v)}
                        icon={<Move className="w-3.5 h-3.5 text-[#83B499]" />}
                      >
                        Ajustar
                      </TabletRibbonButton>

                      <TabletRibbonIconButton
                        onClick={() => {
                          setTabletPhotoDrawerOpen(false);
                          handleRemovePhoto();
                        }}
                        aria-label="Remover foto"
                        className="!text-red-300 hover:!bg-red-950/60"
                      >
                        <Trash2 className="w-4 h-4" />
                      </TabletRibbonIconButton>
                    </>
                  )}
                </>
              )}
            </TabletRibbonGroup>

            <TabletRibbonGroup>
              {errorMsg && (
                <button
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  className="min-h-[34px] px-2.5 rounded-lg text-[11px] font-medium border bg-red-950/60 border-red-400/35 text-red-200 whitespace-nowrap cursor-pointer"
                >
                  {errorMsg}
                </button>
              )}

              <TabletRibbonButton
                variant="primary"
                onClick={handleDownloadPng}
                disabled={isExportingPng}
                icon={
                  isExportingPng ? (
                    <SiscomSpinner className="w-3.5 h-3.5" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )
                }
              >
                {isExportingPng ? 'Gerando...' : 'Baixar PNG'}
              </TabletRibbonButton>
            </TabletRibbonGroup>
          </TabletRibbonRow>
        }
        tabletBottomBar={
          <TabletRibbonRow>
            <TabletRibbonGroup>
              <TabletRibbonSegment
                ariaLabel="Tratamento"
                value={prefix}
                onChange={setPrefix}
                options={[
                  { value: 'À', label: 'À' },
                  { value: 'AO', label: 'AO' },
                ]}
              />
            </TabletRibbonGroup>

            <TabletRibbonDivider />

            <div className="flex-1 min-w-[300px] flex items-center gap-2">
              <span className="text-[11px] font-medium text-[#A2B1A8] whitespace-nowrap shrink-0">
                Nome completo
              </span>
              <input
                type="text"
                aria-label="Nome completo do destinatário"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="(REMETENTE)"
                className="siscom-input flex-1 !min-h-[40px] !rounded-xl text-xs sm:text-sm uppercase"
              />
            </div>
          </TabletRibbonRow>
        }
        sidebar={
        <div className="metal-surface lg:bg-transparent lg:border-0 lg:shadow-none rounded-xl lg:rounded-none p-4 sm:p-5 lg:p-1 space-y-5">
        {/* Card Model Switcher */}
        <div className="space-y-2">
          <span className="siscom-field-label">Modelo</span>

          <div className="siscom-tab-track grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={onSwitchToBoasVindas}
              className="min-h-[40px] rounded-[7px] text-xs font-medium transition-colors px-1.5 text-[#98A89F] hover:text-[#E4EAE6] whitespace-nowrap"
            >
              Boas-Vindas
            </button>
            <button
              type="button"
              onClick={onSwitchToAniversario}
              className="min-h-[40px] rounded-[7px] text-xs font-medium transition-colors px-1.5 text-[#98A89F] hover:text-[#E4EAE6] whitespace-nowrap"
            >
              Aniversário
            </button>
            <button
              type="button"
              aria-current="page"
              className="min-h-[40px] rounded-[7px] text-xs font-medium transition-all px-1.5 bg-[#2D5A43] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_2px_8px_-2px_rgba(0,0,0,0.5)] whitespace-nowrap"
            >
              Pêsames
            </button>
          </div>
        </div>

        {/* Photo Option: Sem foto / Com foto + Upload + Circular Resizing */}
        <section className="space-y-3.5 border-t border-white/8 pt-4">
          <span className="siscom-field-label">Foto no cartão</span>

          <SiscomSegmentedTabs
            layoutId="pesames-photo-mode"
            ariaLabel="Modo de foto no cartão"
            value={photoMode}
            onChange={setPhotoMode}
            options={[
              { value: 'sem_foto', label: 'Sem foto' },
              { value: 'com_foto', label: 'Com foto' },
            ]}
          />

          <AnimatePresence initial={false}>
            {photoMode === 'com_foto' && (
              <motion.div
                key="pesames-photo-controls"
                variants={fadeSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-3.5"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 min-h-[44px] rounded-lg border border-dashed border-[#83B499]/45 bg-[#0F1B16]/52 hover:bg-[#172921]/65 backdrop-blur-md px-3 py-2 flex items-center justify-center gap-2 text-xs sm:text-sm font-medium text-[#E4EAE6] transition-all active:scale-[0.985] min-w-0"
                  >
                    <Upload className="w-4 h-4 text-[#83B499] shrink-0" />
                    <span className="truncate">
                      {photoFileName ? `Trocar (${photoFileName})` : 'Enviar foto'}
                    </span>
                  </button>

                  {photoUrl && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      title="Remover foto"
                      aria-label="Remover foto"
                      className="siscom-btn siscom-btn-danger !min-h-[44px] !w-11 !px-0 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {photoCropEditor}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Export PNG Action */}
        <section className="space-y-2.5 border-t border-white/8 pt-4">
          <button
            type="button"
            onClick={handleDownloadPng}
            disabled={isExportingPng}
            className="siscom-btn siscom-btn-primary w-full text-sm"
          >
            {isExportingPng ? (
              <SiscomSpinner className="w-4 h-4" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{isExportingPng ? 'Gerando...' : 'Baixar PNG'}</span>
          </button>

          <AnimatePresence>
            {errorMsg && (
              <SiscomAlert tone="error" onDismiss={() => setErrorMsg(null)}>
                {errorMsg}
              </SiscomAlert>
            )}
          </AnimatePresence>
        </section>
        </div>
      }
      rightSidebar={
        <div className="metal-surface lg:bg-transparent lg:border-0 lg:shadow-none rounded-xl lg:rounded-none p-4 sm:p-5 lg:p-1 space-y-5">
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.07]">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#E5C17B]">
            Texto do Cartão
          </span>
          <span className="font-mono text-[10px] text-[#98A89F]">
            {PESAMES_W_PX}×{PESAMES_H_PX} PNG
          </span>
        </div>

        {/* Editable Recipient (ONLY text editable section: AO/À + Nome completo) */}
        <section className="space-y-3.5">
          <span className="siscom-field-label">Destinatário</span>

          <div className="space-y-1.5">
            <span className="siscom-field-label !text-[11px]">Tratamento</span>
            <SiscomSegmentedTabs
              layoutId="pesames-prefix-tabs"
              size="sm"
              ariaLabel="Tratamento"
              value={prefix}
              onChange={setPrefix}
              options={[
                { value: 'À', label: 'À' },
                { value: 'AO', label: 'AO' },
              ]}
            />
          </div>

          <label className="block space-y-1.5 min-w-0">
            <span className="siscom-field-label !text-[11px]">Nome completo</span>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="(REMETENTE)"
              className="siscom-input !min-h-[42px] text-xs sm:text-sm uppercase"
            />
          </label>
        </section>

        <div className="pt-3 border-t border-white/[0.07] flex items-center justify-between text-[11px] text-[#98A89F]">
          <span>Pêsames · {photoMode === 'com_foto' ? 'Com foto' : 'Sem foto'}</span>
          <span className="font-mono text-[#E5C17B]">PNG</span>
        </div>
        </div>
      }
    >
      <div className="w-full flex flex-col items-center">
        <div className="w-full max-w-[520px]">
          <PinchZoomSheetFrame
            maxWidthClass="max-w-[520px]"
            className="rounded-xl shadow-2xl border border-white/10 bg-black"
          >
            <svg
              viewBox={`0 0 ${PESAMES_W_PX} ${PESAMES_H_PX}`}
              className="w-full h-auto bg-black block select-none"
              role="img"
              aria-label={`Pré-visualização do cartão de pêsames para ${recipientLine || 'destinatário'}`}
            >
              <defs>
                <linearGradient id="pesames-recipient-mask" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#000000" stopOpacity={0} />
                  <stop offset="49%" stopColor="#000000" stopOpacity={1} />
                  <stop offset="91%" stopColor="#000000" stopOpacity={1} />
                  <stop offset="100%" stopColor="#000000" stopOpacity={0} />
                </linearGradient>

                <clipPath id="pesames-photo-circle-clip">
                  <circle
                    cx={PESAMES_CIRCLE.cx}
                    cy={PESAMES_CIRCLE.cy}
                    r={PESAMES_CIRCLE.r}
                  />
                </clipPath>
              </defs>

              {/* Base Template */}
              <image
                href={PESAMES_BG_ASSET}
                x={0}
                y={0}
                width={PESAMES_W_PX}
                height={PESAMES_H_PX}
                preserveAspectRatio="none"
              />

              {/* Seamless black fade over sample recipient band above the cross (†) */}
              <rect
                x={0}
                y={540}
                width={PESAMES_W_PX}
                height={159}
                fill="url(#pesames-recipient-mask)"
              />

              {/* Circular Photo Frame when "Com foto" */}
              {photoMode === 'com_foto' && (
                <>
                  {photoUrl && circlePhotoGeom ? (
                    <g clipPath="url(#pesames-photo-circle-clip)">
                      <rect
                        x={PESAMES_CIRCLE.cx - PESAMES_CIRCLE.r}
                        y={PESAMES_CIRCLE.cy - PESAMES_CIRCLE.r}
                        width={PESAMES_CIRCLE.diam}
                        height={PESAMES_CIRCLE.diam}
                        fill="#111111"
                      />
                      <image
                        href={photoUrl}
                        x={circlePhotoGeom.x}
                        y={circlePhotoGeom.y}
                        width={circlePhotoGeom.width}
                        height={circlePhotoGeom.height}
                        preserveAspectRatio="none"
                      />
                    </g>
                  ) : (
                    <g>
                      <circle
                        cx={PESAMES_CIRCLE.cx}
                        cy={PESAMES_CIRCLE.cy}
                        r={PESAMES_CIRCLE.r}
                        fill="rgba(12, 16, 14, 0.55)"
                        stroke="rgba(255, 255, 255, 0.45)"
                        strokeWidth={3}
                        strokeDasharray="12 10"
                      />
                      <text
                        x={PESAMES_CIRCLE.cx}
                        y={PESAMES_CIRCLE.cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="rgba(255, 255, 255, 0.72)"
                        fontFamily="'Plus Jakarta Sans', Arial, sans-serif"
                        fontSize={24}
                        fontWeight={500}
                      >
                        Envie uma foto
                      </text>
                    </g>
                  )}
                </>
              )}

              {/* Editable Recipient Line (À / AO + Nome completo) */}
              {fittedRecipient.lines.map((line, idx) => {
                const startY =
                  653 - ((fittedRecipient.lines.length - 1) * fittedRecipient.lineHeightPx) / 2;
                return (
                  <text
                    key={idx}
                    x={PESAMES_W_PX / 2}
                    y={
                      fittedRecipient.lines.length === 1
                        ? 653
                        : startY + idx * fittedRecipient.lineHeightPx
                    }
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#FFFFFF"
                    fontFamily="'Plus Jakarta Sans', 'Manrope', Arial, sans-serif"
                    fontWeight={400}
                    fontSize={fittedRecipient.fontSizePx}
                    letterSpacing={fittedRecipient.letterSpacingPx}
                  >
                    {line}
                  </text>
                );
              })}
            </svg>
          </PinchZoomSheetFrame>
        </div>
      </div>
    </WorkspaceSplitLayout>
    </>
  );
};

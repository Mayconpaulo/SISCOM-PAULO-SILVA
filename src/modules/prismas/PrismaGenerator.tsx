import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Image as ImageIcon, Minus, PencilLine, Plus, Printer, RotateCcw } from 'lucide-react';
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  BORDER_MM,
  clampPrismaFontPt,
  computeFittedFontPt,
  computePrismaLineOffsetsMm,
  DEFAULT_PRISMA_FONT_SETTINGS,
  FACE_HEIGHT_MM,
  generateA4PdfBlob,
  generateA4PngBlob,
  getPrismaTopPositionsMm,
  LEFT_CREST,
  MAX_CUSTOM_FONT_PT,
  MIN_CUSTOM_FONT_PT,
  PRISMA_HEIGHT_MM,
  PRISMA_LEFT_MM,
  PRISMA_WIDTH_MM,
  RIGHT_CREST,
  STANDARD_FONT_PT,
  TEXT_CENTER_X_MM,
  type PrismaData,
  type PrismaFontSettings,
} from './prismaPdf';
import { getSecureVaultItem, setSecureVaultItem } from '../../core/privacy/privacyVault';
import { PinchZoomSheetFrame } from '../../shared/PinchZoomSheetFrame';
import {
  WorkspaceSplitLayout,
  type TabletWorkspaceDrawer,
} from '../../shared/WorkspaceSplitLayout';
import {
  TabletRibbonButton,
  TabletRibbonDivider,
  TabletRibbonGroup,
  TabletRibbonIconButton,
  TabletRibbonRow,
  TabletRibbonSegment,
} from '../../shared/TabletRibbonPrimitives';
import { fadeSlideVariants } from '../../shared/motion';
import { SiscomAlert, SiscomSegmentedTabs, SiscomSpinner } from '../../shared/ui';
import { logActivity } from '../../core/audit/activityLogger';

const DEFAULT_PRISMAS: [PrismaData, PrismaData] = [
  { nome: 'TEN NETO', funcao: 'CHEFE COMSOC' },
  { nome: 'CEL SANSEVERINO', funcao: 'ANTIGO COMANDANTE' },
];

const STORAGE_KEY = 'siscom_prisma_state_v1';

interface StoredPrismaState {
  count: 1 | 2;
  prismas: [PrismaData, PrismaData];
  uppercase: boolean;
  fontSettings: PrismaFontSettings;
}

function loadInitialPrismaState(): StoredPrismaState {
  try {
    const raw = getSecureVaultItem(STORAGE_KEY);
    if (!raw) {
      return {
        count: 2,
        prismas: DEFAULT_PRISMAS,
        uppercase: true,
        fontSettings: { ...DEFAULT_PRISMA_FONT_SETTINGS },
      };
    }
    const parsed = JSON.parse(raw) as Partial<StoredPrismaState>;
    const count = parsed.count === 1 || parsed.count === 2 ? parsed.count : 2;
    const p0 = parsed.prismas?.[0];
    const p1 = parsed.prismas?.[1];
    const prismas: [PrismaData, PrismaData] = [
      {
        nome: typeof p0?.nome === 'string' ? p0.nome : DEFAULT_PRISMAS[0].nome,
        funcao: typeof p0?.funcao === 'string' ? p0.funcao : DEFAULT_PRISMAS[0].funcao,
      },
      {
        nome: typeof p1?.nome === 'string' ? p1.nome : DEFAULT_PRISMAS[1].nome,
        funcao: typeof p1?.funcao === 'string' ? p1.funcao : DEFAULT_PRISMAS[1].funcao,
      },
    ];
    const uppercase = typeof parsed.uppercase === 'boolean' ? parsed.uppercase : true;
    const fontSettings: PrismaFontSettings = {
      nomePt:
        typeof parsed.fontSettings?.nomePt === 'number'
          ? clampPrismaFontPt(parsed.fontSettings.nomePt)
          : STANDARD_FONT_PT,
      funcaoPt:
        typeof parsed.fontSettings?.funcaoPt === 'number'
          ? clampPrismaFontPt(parsed.fontSettings.funcaoPt)
          : STANDARD_FONT_PT,
    };
    return { count, prismas, uppercase, fontSettings };
  } catch {
    return {
      count: 2,
      prismas: DEFAULT_PRISMAS,
      uppercase: true,
      fontSettings: { ...DEFAULT_PRISMA_FONT_SETTINGS },
    };
  }
}

interface PrismaSheetPreviewProps {
  count: 1 | 2;
  prismas: [PrismaData, PrismaData];
  uppercase: boolean;
  fontSettings: PrismaFontSettings;
}

const PrismaSheetPreview: React.FC<PrismaSheetPreviewProps> = ({
  count,
  prismas,
  uppercase,
  fontSettings,
}) => {
  const topsMm = getPrismaTopPositionsMm(count);
  const activePrismas = count === 1 ? [prismas[0]] : [prismas[0], prismas[1]];
  const viewBox = `0 0 ${A4_WIDTH_MM} ${A4_HEIGHT_MM}`;

  return (
    <svg
      viewBox={viewBox}
      className="print-a4-sheet w-full h-auto bg-white block select-none"
      role="img"
      aria-label="Pré-visualização da folha A4 com prismas centralizados"
    >
      <rect x={0} y={0} width={A4_WIDTH_MM} height={A4_HEIGHT_MM} fill="#FFFFFF" />

      {activePrismas.map((item, idx) => {
        const topY = topsMm[idx];
        const rawNome = item.nome.trim();
        const rawFuncao = item.funcao.trim();
        const nome = uppercase ? rawNome.toUpperCase() : rawNome;
        const funcao = uppercase ? rawFuncao.toUpperCase() : rawFuncao;

        const nomePt = computeFittedFontPt(nome, '700', fontSettings.nomePt);
        const funcaoPt = computeFittedFontPt(funcao, '400', fontSettings.funcaoPt);
        const { nomeOffsetMm, funcaoOffsetMm } = computePrismaLineOffsetsMm(nomePt, funcaoPt);

        const nomeMm = (nomePt * 25.4) / 72;
        const funcaoMm = (funcaoPt * 25.4) / 72;

        const renderFace = (faceTopY: number, rotated: boolean) => {
          const leftCrestX = PRISMA_LEFT_MM + LEFT_CREST.insetLeftMm;
          const leftCrestY = faceTopY + (FACE_HEIGHT_MM - LEFT_CREST.heightMm) / 2;

          const rightCrestX =
            PRISMA_LEFT_MM + PRISMA_WIDTH_MM - RIGHT_CREST.insetRightMm - RIGHT_CREST.widthMm;
          const rightCrestY = faceTopY + (FACE_HEIGHT_MM - RIGHT_CREST.heightMm) / 2;

          const textX = PRISMA_LEFT_MM + TEXT_CENTER_X_MM;
          const faceCenterY = faceTopY + FACE_HEIGHT_MM / 2;

          return (
            <g key={rotated ? 'top' : 'bottom'}>
              <image
                href={LEFT_CREST.src}
                x={leftCrestX}
                y={leftCrestY}
                width={LEFT_CREST.widthMm}
                height={LEFT_CREST.heightMm}
                preserveAspectRatio="xMidYMid meet"
                transform={
                  rotated
                    ? `rotate(180 ${leftCrestX + LEFT_CREST.widthMm / 2} ${leftCrestY + LEFT_CREST.heightMm / 2})`
                    : undefined
                }
              />

              <image
                href={RIGHT_CREST.src}
                x={rightCrestX}
                y={rightCrestY}
                width={RIGHT_CREST.widthMm}
                height={RIGHT_CREST.heightMm}
                preserveAspectRatio="xMidYMid meet"
                transform={
                  rotated
                    ? `rotate(180 ${rightCrestX + RIGHT_CREST.widthMm / 2} ${rightCrestY + RIGHT_CREST.heightMm / 2})`
                    : undefined
                }
              />

              <g
                transform={rotated ? `rotate(180 ${textX} ${faceCenterY})` : undefined}
                style={{ fontFamily: '"Open Sans", Arial, sans-serif' }}
              >
                {nome && funcao ? (
                  <>
                    <text
                      x={textX}
                      y={faceCenterY + nomeOffsetMm}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#000000"
                      fontWeight={700}
                      fontSize={nomeMm}
                    >
                      {nome}
                    </text>
                    <text
                      x={textX}
                      y={faceCenterY + funcaoOffsetMm}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#000000"
                      fontWeight={400}
                      fontSize={funcaoMm}
                    >
                      {funcao}
                    </text>
                  </>
                ) : nome ? (
                  <text
                    x={textX}
                    y={faceCenterY}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#000000"
                    fontWeight={700}
                    fontSize={nomeMm}
                  >
                    {nome}
                  </text>
                ) : funcao ? (
                  <text
                    x={textX}
                    y={faceCenterY}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#000000"
                    fontWeight={400}
                    fontSize={funcaoMm}
                  >
                    {funcao}
                  </text>
                ) : null}
              </g>
            </g>
          );
        };

        return (
          <g key={`prisma-${idx}`}>
            {renderFace(topY, true)}
            {renderFace(topY + FACE_HEIGHT_MM, false)}

            <rect
              x={PRISMA_LEFT_MM + BORDER_MM / 2}
              y={topY + BORDER_MM / 2}
              width={PRISMA_WIDTH_MM - BORDER_MM}
              height={PRISMA_HEIGHT_MM - BORDER_MM}
              fill="none"
              stroke="#000000"
              strokeWidth={BORDER_MM}
            />
          </g>
        );
      })}
    </svg>
  );
};

interface FontSizeControlProps {
  id: string;
  label: string;
  sliderAriaLabel: string;
  value: number;
  onChange: (next: number) => void;
}

const FontSizeControl: React.FC<FontSizeControlProps> = ({
  id,
  label,
  sliderAriaLabel,
  value,
  onChange,
}) => {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commitDraft = () => {
    const parsed = Number(draft.replace(',', '.'));
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = clampPrismaFontPt(parsed);
    onChange(clamped);
    setDraft(String(clamped));
  };

  return (
    <div className="siscom-liquid-subcard rounded-lg px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-[#E4EAE6]">
          {label}
        </label>
        <div className="flex items-center gap-1">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={MIN_CUSTOM_FONT_PT}
            max={MAX_CUSTOM_FONT_PT}
            step={1}
            value={draft}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              const parsed = Number(raw.replace(',', '.'));
              if (
                raw.trim() !== '' &&
                Number.isFinite(parsed) &&
                parsed >= MIN_CUSTOM_FONT_PT &&
                parsed <= MAX_CUSTOM_FONT_PT
              ) {
                onChange(clampPrismaFontPt(parsed));
              }
            }}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitDraft();
              }
            }}
            className="siscom-input !w-16 !min-h-[30px] !py-1 !px-2 font-mono text-center text-xs"
          />
          <span className="font-mono text-[11px] text-[#83B499]">pt</span>
        </div>
      </div>
      <input
        type="range"
        aria-label={sliderAriaLabel}
        min={MIN_CUSTOM_FONT_PT}
        max={MAX_CUSTOM_FONT_PT}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#2D5A43] cursor-pointer"
      />
    </div>
  );
};

export interface PrismaGeneratorProps {
  externalDownloadSignal?: number;
}

export const PrismaGenerator: React.FC<PrismaGeneratorProps> = ({ externalDownloadSignal }) => {
  const initial = useMemo(() => loadInitialPrismaState(), []);
  const [count, setCount] = useState<1 | 2>(initial.count);
  const [prismas, setPrismas] = useState<[PrismaData, PrismaData]>(initial.prismas);
  const [uppercase, setUppercase] = useState(initial.uppercase);
  const [fontSettings, setFontSettings] = useState<PrismaFontSettings>(initial.fontSettings);
  const [exporting, setExporting] = useState<'pdf' | 'png' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fontsTick, setFontsTick] = useState(0);
  const [tabletDrawer, setTabletDrawer] = useState<'prisma1' | 'prisma2' | null>(null);

  const toggleTabletDrawer = (key: 'prisma1' | 'prisma2') => {
    setTabletDrawer((prev) => (prev === key ? null : key));
  };

  useEffect(() => {
    try {
      setSecureVaultItem(
        STORAGE_KEY,
        JSON.stringify({ count, prismas, uppercase, fontSettings })
      );
    } catch {
      // Ignore storage quota issues cleanly
    }
  }, [count, prismas, uppercase, fontSettings]);

  useEffect(() => {
    const handlePurged = () => {
      setCount(2);
      setPrismas(DEFAULT_PRISMAS);
      setUppercase(true);
      setFontSettings({ ...DEFAULT_PRISMA_FONT_SETTINGS });
      setNotice(null);
    };
    window.addEventListener('siscom:vault-purged', handlePurged);
    return () => window.removeEventListener('siscom:vault-purged', handlePurged);
  }, []);

  useEffect(() => {
    let active = true;
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(() => {
        if (active) setFontsTick((t) => t + 1);
      });
    }
    return () => {
      active = false;
    };
  }, []);

  const updatePrisma = (index: 0 | 1, field: keyof PrismaData, value: string) => {
    setPrismas((prev) => {
      const next: [PrismaData, PrismaData] = [{ ...prev[0] }, { ...prev[1] }];
      next[index][field] = value;
      return next;
    });
  };

  const sizeDiagnostics = useMemo(() => {
    void fontsTick;
    const list = count === 1 ? [prismas[0]] : prismas;
    return list.map((p) => {
      const n = uppercase ? p.nome.trim().toUpperCase() : p.nome.trim();
      const f = uppercase ? p.funcao.trim().toUpperCase() : p.funcao.trim();
      const nomePt = computeFittedFontPt(n, '700', fontSettings.nomePt);
      const funcaoPt = computeFittedFontPt(f, '400', fontSettings.funcaoPt);
      return {
        nomePt,
        funcaoPt,
        sameSize: nomePt === funcaoPt,
      };
    });
  }, [count, prismas, uppercase, fontSettings, fontsTick]);

  const isCustomFontSize =
    fontSettings.nomePt !== STANDARD_FONT_PT || fontSettings.funcaoPt !== STANDARD_FONT_PT;

  const updateFontPt = (field: keyof PrismaFontSettings, rawValue: number) => {
    if (!Number.isFinite(rawValue)) return;
    setFontSettings((prev) => ({
      ...prev,
      [field]: clampPrismaFontPt(rawValue),
    }));
  };

  const handleDownloadPdf = async () => {
    setExporting('pdf');
    setNotice(null);
    try {
      const blob = await generateA4PdfBlob(count, prismas, uppercase, fontSettings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prismas-a4-${count}x.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('PDF gerado.');
      void logActivity({
        module: 'prismas',
        action: 'export_pdf',
        summary: `Exportou PDF de ${count} prisma(s)`,
      });
    } catch {
      setNotice('Erro ao gerar PDF.');
    } finally {
      setExporting(null);
    }
  };

  useEffect(() => {
    if (externalDownloadSignal && externalDownloadSignal > 0) {
      void handleDownloadPdf();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalDownloadSignal]);

  const handleDownloadPng = async () => {
    setExporting('png');
    setNotice(null);
    try {
      const blob = await generateA4PngBlob(count, prismas, uppercase, fontSettings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prismas-a4-${count}x.png`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('PNG gerado.');
      void logActivity({
        module: 'prismas',
        action: 'export_png',
        summary: `Exportou PNG de ${count} prisma(s)`,
      });
    } catch {
      setNotice('Erro ao gerar PNG.');
    } finally {
      setExporting(null);
    }
  };

  const handlePrint = () => {
    setNotice(null);
    void logActivity({
      module: 'prismas',
      action: 'print',
      summary: `Imprimiu ${count} prisma(s)`,
    });
    window.print();
  };

  const activeTabletDrawer: TabletWorkspaceDrawer | null = useMemo(() => {
    if (!tabletDrawer) return null;
    if (tabletDrawer === 'prisma2' && count === 1) return null;
    const idx: 0 | 1 = tabletDrawer === 'prisma2' ? 1 : 0;
    const diag = sizeDiagnostics[idx];
    const diagLabel = diag
      ? diag.sameSize
        ? `${diag.nomePt} pt`
        : `${diag.nomePt} / ${diag.funcaoPt} pt`
      : `${fontSettings.nomePt} pt`;

    return {
      title: count === 1 ? 'Prisma' : idx === 0 ? 'Prisma 1' : 'Prisma 2',
      anchor: 'bottom',
      onClose: () => setTabletDrawer(null),
      headerAction: (
        <span className="font-mono text-[11px] text-[#83B499] px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08]">
          {diagLabel}
        </span>
      ),
      content: (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor={`tablet-p${idx + 1}-nome`} className="siscom-field-label">
              Nome
            </label>
            <input
              id={`tablet-p${idx + 1}-nome`}
              type="text"
              value={prismas[idx].nome}
              onChange={(e) => updatePrisma(idx, 'nome', e.target.value)}
              placeholder={idx === 0 ? 'TEN NETO' : 'CEL SANSEVERINO'}
              className="siscom-input"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`tablet-p${idx + 1}-funcao`} className="siscom-field-label">
              Função
            </label>
            <input
              id={`tablet-p${idx + 1}-funcao`}
              type="text"
              value={prismas[idx].funcao}
              onChange={(e) => updatePrisma(idx, 'funcao', e.target.value)}
              placeholder={idx === 0 ? 'CHEFE COMSOC' : 'ANTIGO COMANDANTE'}
              className="siscom-input"
            />
          </div>
        </div>
      ),
    };
  }, [tabletDrawer, count, prismas, sizeDiagnostics, fontSettings.nomePt]);

  return (
    <WorkspaceSplitLayout
      sidebarWidthClass="lg:w-[285px] xl:w-[310px]"
      rightSidebarWidthClass="lg:w-[285px] xl:w-[315px]"
      tabletDrawer={activeTabletDrawer}
      tabletTopBar={
        <TabletRibbonRow className="justify-between">
          <TabletRibbonGroup>
            <TabletRibbonSegment
              ariaLabel="Quantidade de prismas por folha"
              value={String(count) as '1' | '2'}
              onChange={(val) => {
                const next = val === '1' ? 1 : 2;
                setCount(next);
                if (next === 1 && tabletDrawer === 'prisma2') setTabletDrawer(null);
              }}
              options={[
                { value: '1', label: '1 Prisma' },
                { value: '2', label: '2 Prismas' },
              ]}
            />
            {notice && (
              <button
                type="button"
                onClick={() => setNotice(null)}
                className={`min-h-[34px] px-2.5 rounded-lg text-[11px] font-medium border whitespace-nowrap cursor-pointer ${
                  notice.startsWith('Erro')
                    ? 'bg-red-950/60 border-red-400/35 text-red-200'
                    : 'bg-[#2D5A43]/40 border-[#8AC0A3]/35 text-[#D8F0E2]'
                }`}
              >
                {notice}
              </button>
            )}
          </TabletRibbonGroup>

          <TabletRibbonGroup>
            <TabletRibbonButton
              variant="primary"
              disabled={exporting !== null}
              onClick={handleDownloadPdf}
              icon={
                exporting === 'pdf' ? (
                  <SiscomSpinner className="w-3.5 h-3.5" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )
              }
            >
              {exporting === 'pdf' ? 'Gerando...' : 'PDF'}
            </TabletRibbonButton>
            <TabletRibbonButton
              disabled={exporting !== null}
              onClick={handleDownloadPng}
              icon={
                exporting === 'png' ? (
                  <SiscomSpinner className="w-3.5 h-3.5" tone="olive" />
                ) : (
                  <ImageIcon className="w-3.5 h-3.5 text-[#83B499]" />
                )
              }
            >
              PNG
            </TabletRibbonButton>
            <TabletRibbonButton
              onClick={handlePrint}
              icon={<Printer className="w-3.5 h-3.5 text-[#83B499]" />}
            >
              Imprimir
            </TabletRibbonButton>
          </TabletRibbonGroup>
        </TabletRibbonRow>
      }
      tabletBottomBar={
        <TabletRibbonRow>
          <TabletRibbonGroup>
            <TabletRibbonButton
              chevron
              open={tabletDrawer === 'prisma1'}
              onClick={() => toggleTabletDrawer('prisma1')}
              icon={<PencilLine className="w-3.5 h-3.5 text-[#E5C17B]" />}
              badge={prismas[0].nome.trim().slice(0, 14) || 'Vazio'}
            >
              {count === 1 ? 'Prisma' : 'Prisma 1'}
            </TabletRibbonButton>

            {count === 2 && (
              <TabletRibbonButton
                chevron
                open={tabletDrawer === 'prisma2'}
                onClick={() => toggleTabletDrawer('prisma2')}
                icon={<PencilLine className="w-3.5 h-3.5 text-[#E5C17B]" />}
                badge={prismas[1].nome.trim().slice(0, 14) || 'Vazio'}
              >
                Prisma 2
              </TabletRibbonButton>
            )}
          </TabletRibbonGroup>

          <TabletRibbonDivider />

          <TabletRibbonGroup>
            <TabletRibbonButton
              variant={uppercase ? 'active' : 'default'}
              onClick={() => setUppercase((prev) => !prev)}
            >
              AA Maiúsculas
            </TabletRibbonButton>
          </TabletRibbonGroup>

          <TabletRibbonDivider />

          <TabletRibbonGroup>
            <div className="inline-flex items-center gap-1 bg-black/35 border border-white/[0.11] rounded-xl px-2 py-1 shrink-0">
              <span className="text-[11px] font-medium text-[#A2B1A8] px-1">Nome</span>
              <TabletRibbonIconButton
                className="!w-8 !h-8 !rounded-lg"
                aria-label="Diminuir tamanho do nome"
                disabled={fontSettings.nomePt <= MIN_CUSTOM_FONT_PT}
                onClick={() => updateFontPt('nomePt', fontSettings.nomePt - 1)}
              >
                <Minus className="w-3.5 h-3.5" />
              </TabletRibbonIconButton>
              <span className="font-mono text-xs text-[#F4E6C4] w-11 text-center">
                {fontSettings.nomePt}pt
              </span>
              <TabletRibbonIconButton
                className="!w-8 !h-8 !rounded-lg"
                aria-label="Aumentar tamanho do nome"
                disabled={fontSettings.nomePt >= MAX_CUSTOM_FONT_PT}
                onClick={() => updateFontPt('nomePt', fontSettings.nomePt + 1)}
              >
                <Plus className="w-3.5 h-3.5" />
              </TabletRibbonIconButton>
            </div>

            <div className="inline-flex items-center gap-1 bg-black/35 border border-white/[0.11] rounded-xl px-2 py-1 shrink-0">
              <span className="text-[11px] font-medium text-[#A2B1A8] px-1">Função</span>
              <TabletRibbonIconButton
                className="!w-8 !h-8 !rounded-lg"
                aria-label="Diminuir tamanho da função"
                disabled={fontSettings.funcaoPt <= MIN_CUSTOM_FONT_PT}
                onClick={() => updateFontPt('funcaoPt', fontSettings.funcaoPt - 1)}
              >
                <Minus className="w-3.5 h-3.5" />
              </TabletRibbonIconButton>
              <span className="font-mono text-xs text-[#F4E6C4] w-11 text-center">
                {fontSettings.funcaoPt}pt
              </span>
              <TabletRibbonIconButton
                className="!w-8 !h-8 !rounded-lg"
                aria-label="Aumentar tamanho da função"
                disabled={fontSettings.funcaoPt >= MAX_CUSTOM_FONT_PT}
                onClick={() => updateFontPt('funcaoPt', fontSettings.funcaoPt + 1)}
              >
                <Plus className="w-3.5 h-3.5" />
              </TabletRibbonIconButton>
            </div>

            {isCustomFontSize && (
              <TabletRibbonButton
                onClick={() => setFontSettings({ ...DEFAULT_PRISMA_FONT_SETTINGS })}
                icon={<RotateCcw className="w-3.5 h-3.5 text-[#83B499]" />}
              >
                {STANDARD_FONT_PT}pt
              </TabletRibbonButton>
            )}
          </TabletRibbonGroup>
        </TabletRibbonRow>
      }
      sidebar={
        <div className="metal-surface lg:bg-transparent lg:border-0 lg:shadow-none rounded-xl lg:rounded-none p-4 sm:p-5 lg:p-1 space-y-5">
        {/* 1 or 2 Prismas per Page */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="siscom-field-label">Modelo / Quantidade</span>
            <span className="font-mono text-[10px] text-[#E5C17B]">A4 210×297mm</span>
          </div>
          <SiscomSegmentedTabs
            layoutId="prisma-count-tabs"
            ariaLabel="Quantidade de prismas por folha"
            value={String(count) as '1' | '2'}
            onChange={(val) => setCount(val === '1' ? 1 : 2)}
            options={[
              { value: '1', label: '1 Prisma' },
              { value: '2', label: '2 Prismas' },
            ]}
          />
        </div>

        {/* Export / Print Actions */}
        <div className="pt-4 border-t border-white/8 space-y-2.5">
          <span className="siscom-field-label">Exportar</span>
          <button
            type="button"
            disabled={exporting !== null}
            onClick={handleDownloadPdf}
            className="siscom-btn siscom-btn-primary w-full text-xs"
          >
            {exporting === 'pdf' ? (
              <SiscomSpinner className="w-3.5 h-3.5" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{exporting === 'pdf' ? 'Gerando...' : 'Baixar PDF'}</span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={exporting !== null}
              onClick={handleDownloadPng}
              className="siscom-btn siscom-btn-secondary text-xs"
            >
              {exporting === 'png' ? (
                <SiscomSpinner className="w-3.5 h-3.5" tone="olive" />
              ) : (
                <ImageIcon className="w-3.5 h-3.5 text-[#83B499]" />
              )}
              <span>{exporting === 'png' ? 'Gerando...' : 'PNG'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="siscom-btn siscom-btn-secondary text-xs"
            >
              <Printer className="w-3.5 h-3.5 text-[#83B499]" />
              <span>Imprimir</span>
            </button>
          </div>
        </div>

        <AnimatePresence>
          {notice && (
            <SiscomAlert
              tone={notice.startsWith('Erro') ? 'error' : 'success'}
              onDismiss={() => setNotice(null)}
            >
              {notice}
            </SiscomAlert>
          )}
        </AnimatePresence>
        </div>
      }
      rightSidebar={
        <div className="metal-surface lg:bg-transparent lg:border-0 lg:shadow-none rounded-xl lg:rounded-none p-4 sm:p-5 lg:p-1 space-y-5">
          {/* Uppercase & Font Size options */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="siscom-field-label">Texto e Estilo</span>
              {isCustomFontSize && (
                <button
                  type="button"
                  onClick={() => setFontSettings({ ...DEFAULT_PRISMA_FONT_SETTINGS })}
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-[#83B499] hover:text-[#F4E6C4] transition-colors cursor-pointer"
                  title="Restaurar 20 pt"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>{STANDARD_FONT_PT} pt</span>
                </button>
              )}
            </div>
            <label
              htmlFor="uppercase-toggle"
              className="siscom-liquid-subcard rounded-lg px-3 min-h-[42px] flex items-center justify-between gap-3 cursor-pointer select-none"
            >
              <span className="text-xs font-medium text-[#E4EAE6]">Sempre maiúsculas</span>
              <input
                id="uppercase-toggle"
                type="checkbox"
                checked={uppercase}
                onChange={(e) => setUppercase(e.target.checked)}
                className="h-4 w-4 accent-[#2D5A43] rounded cursor-pointer"
              />
            </label>

            <FontSizeControl
              id="prisma-font-nome"
              label="Tamanho do Nome"
              sliderAriaLabel="Tamanho da fonte do nome"
              value={fontSettings.nomePt}
              onChange={(next) => updateFontPt('nomePt', next)}
            />

            <FontSizeControl
              id="prisma-font-funcao"
              label="Tamanho da Função"
              sliderAriaLabel="Tamanho da fonte da função"
              value={fontSettings.funcaoPt}
              onChange={(next) => updateFontPt('funcaoPt', next)}
            />
          </div>

          {/* Prisma 1 Inputs */}
          <div className="space-y-3 pt-4 border-t border-white/8">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-display font-semibold text-[#F4E6C4]">
                {count === 1 ? 'Prisma' : 'Prisma 1'}
              </span>
              <span className="font-mono text-[11px] text-[#83B499]">
                {sizeDiagnostics[0].sameSize
                  ? `${sizeDiagnostics[0].nomePt} pt`
                  : `${sizeDiagnostics[0].nomePt} / ${sizeDiagnostics[0].funcaoPt} pt`}
              </span>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="p1-nome" className="siscom-field-label">
                Nome
              </label>
              <input
                id="p1-nome"
                type="text"
                value={prismas[0].nome}
                onChange={(e) => updatePrisma(0, 'nome', e.target.value)}
                placeholder="TEN NETO"
                className="siscom-input"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="p1-funcao" className="siscom-field-label">
                Função
              </label>
              <input
                id="p1-funcao"
                type="text"
                value={prismas[0].funcao}
                onChange={(e) => updatePrisma(0, 'funcao', e.target.value)}
                placeholder="CHEFE COMSOC"
                className="siscom-input"
              />
            </div>
          </div>

          {/* Prisma 2 Inputs */}
          <AnimatePresence initial={false}>
            {count === 2 && (
              <motion.div
                key="prisma-2-fields"
                variants={fadeSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-3 pt-4 border-t border-white/8"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-display font-semibold text-[#F4E6C4]">Prisma 2</span>
                  <span className="font-mono text-[11px] text-[#83B499]">
                    {sizeDiagnostics[1]?.sameSize
                      ? `${sizeDiagnostics[1].nomePt} pt`
                      : `${sizeDiagnostics[1]?.nomePt ?? fontSettings.nomePt} / ${sizeDiagnostics[1]?.funcaoPt ?? fontSettings.funcaoPt} pt`}
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="p2-nome" className="siscom-field-label">
                    Nome
                  </label>
                  <input
                    id="p2-nome"
                    type="text"
                    value={prismas[1].nome}
                    onChange={(e) => updatePrisma(1, 'nome', e.target.value)}
                    placeholder="CEL SANSEVERINO"
                    className="siscom-input"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="p2-funcao" className="siscom-field-label">
                    Função
                  </label>
                  <input
                    id="p2-funcao"
                    type="text"
                    value={prismas[1].funcao}
                    onChange={(e) => updatePrisma(1, 'funcao', e.target.value)}
                    placeholder="ANTIGO COMANDANTE"
                    className="siscom-input"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      }
    >
      <div className="w-full min-h-full flex flex-col items-center print-wrapper">
        <PinchZoomSheetFrame
          maxWidthClass="max-w-[620px]"
          className="rounded-lg border border-white/15 shadow-2xl bg-white"
        >
          <div className="print-page-item w-full bg-white">
            <PrismaSheetPreview
              count={count}
              prismas={prismas}
              uppercase={uppercase}
              fontSettings={fontSettings}
            />
          </div>
        </PinchZoomSheetFrame>
      </div>
    </WorkspaceSplitLayout>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Image as ImageIcon, Printer } from 'lucide-react';
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  BORDER_MM,
  computeFittedFontPt,
  FACE_HEIGHT_MM,
  generateA4PdfBlob,
  generateA4PngBlob,
  getPrismaTopPositionsMm,
  LEFT_CREST,
  PRISMA_HEIGHT_MM,
  PRISMA_LEFT_MM,
  PRISMA_WIDTH_MM,
  RIGHT_CREST,
  STANDARD_FONT_PT,
  TEXT_CENTER_X_MM,
  type PrismaData,
} from './prismaPdf';
import { getSecureVaultItem, setSecureVaultItem } from '../../core/privacy/privacyVault';
import { PinchZoomSheetFrame } from '../../shared/PinchZoomSheetFrame';
import { WorkspaceSplitLayout } from '../../shared/WorkspaceSplitLayout';
import { fadeSlideVariants } from '../../shared/motion';
import { SiscomAlert, SiscomSegmentedTabs, SiscomSpinner } from '../../shared/ui';

const DEFAULT_PRISMAS: [PrismaData, PrismaData] = [
  { nome: 'TEN NETO', funcao: 'CHEFE COMSOC' },
  { nome: 'CEL SANSEVERINO', funcao: 'ANTIGO COMANDANTE' },
];

const STORAGE_KEY = 'siscom_prisma_state_v1';

interface StoredPrismaState {
  count: 1 | 2;
  prismas: [PrismaData, PrismaData];
  uppercase: boolean;
}

function loadInitialPrismaState(): StoredPrismaState {
  try {
    const raw = getSecureVaultItem(STORAGE_KEY);
    if (!raw) return { count: 2, prismas: DEFAULT_PRISMAS, uppercase: true };
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
    return { count, prismas, uppercase };
  } catch {
    return { count: 2, prismas: DEFAULT_PRISMAS, uppercase: true };
  }
}

interface PrismaSheetPreviewProps {
  count: 1 | 2;
  prismas: [PrismaData, PrismaData];
  uppercase: boolean;
}

const PrismaSheetPreview: React.FC<PrismaSheetPreviewProps> = ({ count, prismas, uppercase }) => {
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

        const nomePt = computeFittedFontPt(nome, '700');
        const funcaoPt = computeFittedFontPt(funcao, '400');

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
          const lineOffset = 4.2;

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
                      y={faceCenterY - lineOffset}
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
                      y={faceCenterY + lineOffset}
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

export interface PrismaGeneratorProps {
  externalDownloadSignal?: number;
}

export const PrismaGenerator: React.FC<PrismaGeneratorProps> = ({ externalDownloadSignal }) => {
  const initial = useMemo(() => loadInitialPrismaState(), []);
  const [count, setCount] = useState<1 | 2>(initial.count);
  const [prismas, setPrismas] = useState<[PrismaData, PrismaData]>(initial.prismas);
  const [uppercase, setUppercase] = useState(initial.uppercase);
  const [exporting, setExporting] = useState<'pdf' | 'png' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fontsTick, setFontsTick] = useState(0);

  useEffect(() => {
    try {
      setSecureVaultItem(STORAGE_KEY, JSON.stringify({ count, prismas, uppercase }));
    } catch {
      // Ignore storage quota issues cleanly
    }
  }, [count, prismas, uppercase]);

  useEffect(() => {
    const handlePurged = () => {
      setCount(2);
      setPrismas(DEFAULT_PRISMAS);
      setUppercase(true);
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
      const nomePt = computeFittedFontPt(n, '700');
      const funcaoPt = computeFittedFontPt(f, '400');
      return {
        nomePt,
        funcaoPt,
        adjusted: nomePt < STANDARD_FONT_PT || funcaoPt < STANDARD_FONT_PT,
      };
    });
  }, [count, prismas, uppercase, fontsTick]);

  const handleDownloadPdf = async () => {
    setExporting('pdf');
    setNotice(null);
    try {
      const blob = await generateA4PdfBlob(count, prismas, uppercase);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prismas-a4-${count}x.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('PDF gerado.');
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
      const blob = await generateA4PngBlob(count, prismas, uppercase);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prismas-a4-${count}x.png`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice('PNG gerado.');
    } catch {
      setNotice('Erro ao gerar PNG.');
    } finally {
      setExporting(null);
    }
  };

  const handlePrint = () => {
    setNotice(null);
    window.print();
  };

  return (
    <WorkspaceSplitLayout
      sidebarWidthClass="lg:w-[285px] xl:w-[310px]"
      rightSidebarWidthClass="lg:w-[285px] xl:w-[315px]"
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
          {/* Uppercase option */}
          <div className="space-y-2">
            <span className="siscom-field-label">Texto e Estilo</span>
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
          </div>

          {/* Prisma 1 Inputs */}
          <div className="space-y-3 pt-4 border-t border-white/8">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-display font-semibold text-[#F4E6C4]">
                {count === 1 ? 'Prisma' : 'Prisma 1'}
              </span>
              <span className="font-mono text-[11px] text-[#83B499]">
                {sizeDiagnostics[0].adjusted
                  ? `${sizeDiagnostics[0].nomePt} / ${sizeDiagnostics[0].funcaoPt} pt`
                  : `${STANDARD_FONT_PT} pt`}
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
                    {sizeDiagnostics[1]?.adjusted
                      ? `${sizeDiagnostics[1].nomePt} / ${sizeDiagnostics[1].funcaoPt} pt`
                      : `${STANDARD_FONT_PT} pt`}
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
      <div className="w-full flex flex-col items-center print-wrapper">
        <PinchZoomSheetFrame
          maxWidthClass="max-w-[620px]"
          className="rounded-lg border border-white/15 shadow-2xl bg-white"
        >
          <div className="print-page-item w-full bg-white">
            <PrismaSheetPreview count={count} prismas={prismas} uppercase={uppercase} />
          </div>
        </PinchZoomSheetFrame>
      </div>
    </WorkspaceSplitLayout>
  );
};

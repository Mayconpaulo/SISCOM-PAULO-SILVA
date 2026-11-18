import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Download,
  Image as ImageIcon,
  Layers,
  Printer,
  RotateCcw,
} from 'lucide-react';
import { AniversarioCardWorkspace } from './AniversarioCardWorkspace';
import { PesamesCardWorkspace } from './PesamesCardWorkspace';
import { PinchZoomSheetFrame } from './PinchZoomSheetFrame';
import { BOAS_VINDAS_TITLE_PATH, BOAS_VINDAS_TITLE_VIEWBOX } from '../lib/boasVindasVectorTitle';
import {
  A4_H_MM,
  A4_W_MM,
  type BoasVindasConfig,
  CARTAO_ASSET_RATIOS,
  CARTOES_ASSETS,
  type CartaoModel,
  computeCartaoLayout,
  DEFAULT_BOAS_VINDAS_CONFIG,
  DEFAULT_BOAS_VINDAS_DATE,
  DEFAULT_BOAS_VINDAS_TEXT,
  fitBoasVindasBodyText,
  generateCartoesPdfBlob,
  generateCartoesPngBlob,
  getBoasVindasCardMetrics,
  getMaxCardsPerPage,
} from '../lib/cartoesPdf';

const STORAGE_KEY = 'siscom_cartoes_state_v1';

interface StoredCartoesState {
  model: CartaoModel;
  boasVindas: BoasVindasConfig;
}

function loadInitialCartoesState(): StoredCartoesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { model: 'boas_vindas', boasVindas: DEFAULT_BOAS_VINDAS_CONFIG };
    }
    const parsed = JSON.parse(raw) as Partial<StoredCartoesState>;
    const model: CartaoModel =
      parsed.model === 'aniversario'
        ? 'aniversario'
        : parsed.model === 'pesames'
          ? 'pesames'
          : 'boas_vindas';
    const bv = parsed.boasVindas;
    const widthMm =
      typeof bv?.cardWidthMm === 'number' && bv.cardWidthMm >= 45
        ? bv.cardWidthMm
        : DEFAULT_BOAS_VINDAS_CONFIG.cardWidthMm;
    const heightMm =
      typeof bv?.cardHeightMm === 'number' && bv.cardHeightMm >= 35
        ? bv.cardHeightMm
        : DEFAULT_BOAS_VINDAS_CONFIG.cardHeightMm;
    const maxPerPage = getMaxCardsPerPage(widthMm, heightMm).maxPerPage;
    const rawCount =
      typeof bv?.countPerPage === 'number' && bv.countPerPage >= 1
        ? Math.floor(bv.countPerPage)
        : DEFAULT_BOAS_VINDAS_CONFIG.countPerPage;

    return {
      model,
      boasVindas: {
        cardWidthMm: widthMm,
        cardHeightMm: heightMm,
        countPerPage: Math.min(maxPerPage, rawCount),
        bodyText: typeof bv?.bodyText === 'string' ? bv.bodyText : DEFAULT_BOAS_VINDAS_TEXT,
        dateText: typeof bv?.dateText === 'string' ? bv.dateText : DEFAULT_BOAS_VINDAS_DATE,
      },
    };
  } catch {
    return { model: 'boas_vindas', boasVindas: DEFAULT_BOAS_VINDAS_CONFIG };
  }
}

function formatTodayQuartelDate(): string {
  const now = new Date();
  const months = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];
  const day = now.getDate();
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  return `Quartel na Vila Militar, RJ, ${day} de ${month} de ${year}.`;
}

function estimateSvgFittedFontSizeMm(text: string, baseMm: number, maxWidthMm: number): number {
  const approxWidthMm = text.length * baseMm * 0.48;
  if (approxWidthMm > maxWidthMm && approxWidthMm > 0) {
    return Math.max(baseMm * 0.55, baseMm * (maxWidthMm / approxWidthMm));
  }
  return baseMm;
}

const BoasVindasCardSvgContent: React.FC<{
  cardW: number;
  cardH: number;
  config: BoasVindasConfig;
  clipId: string;
}> = ({ cardW, cardH, config, clipId }) => {
  const m = getBoasVindasCardMetrics(cardW, cardH);

  // Watermark fit
  let wmW = m.innerW * 0.96;
  let wmH = wmW / CARTAO_ASSET_RATIOS.marcaDagua;
  if (wmH > m.innerH * 0.94) {
    wmH = m.innerH * 0.94;
    wmW = wmH * CARTAO_ASSET_RATIOS.marcaDagua;
  }
  const wmX = cardW / 2 - wmW / 2;
  const wmY = m.innerTop + (m.innerH - wmH) * 0.58;

  const fitted = fitBoasVindasBodyText(config.bodyText, m.bodyBox.maxW, m.bodyBox.maxH, cardH);
  const dateText = config.dateText.trim();
  const dateFontMm = estimateSvgFittedFontSizeMm(dateText, m.dateSize, m.dateMaxW);

  const cmdName = 'ALEX FERREIRA GOMES JÚNIOR - TC';
  const cmdTitle = 'Comandante do 1º Batalhão de Infantaria Mecanizado (Escola)';
  const cmdNameSize = estimateSvgFittedFontSizeMm(cmdName, m.cmdNameSize, m.cmdMaxW);
  const cmdTitleSize = estimateSvgFittedFontSizeMm(cmdTitle, m.cmdTitleSize, m.cmdMaxW);

  const innerClipId = `${clipId}-inner`;

  return (
    <g clipPath={`url(#${clipId})`}>
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={cardW} height={cardH} />
        </clipPath>
        <clipPath id={innerClipId}>
          <rect
            x={m.blueThickness + m.whiteGap * 0.2}
            y={m.blueThickness + m.whiteGap * 0.2}
            width={cardW - (m.blueThickness + m.whiteGap * 0.2) * 2}
            height={cardH - (m.blueThickness + m.whiteGap * 0.2) * 2}
          />
        </clipPath>
      </defs>

      <rect x={0} y={0} width={cardW} height={cardH} fill="#FFFFFF" />

      {/* Outer blue frame */}
      <rect
        x={m.blueThickness / 2}
        y={m.blueThickness / 2}
        width={cardW - m.blueThickness}
        height={cardH - m.blueThickness}
        fill="none"
        stroke="#4A94FA"
        strokeWidth={m.blueThickness}
      />

      {/* Inner red frame */}
      <rect
        x={m.redInset + m.redThickness / 2}
        y={m.redInset + m.redThickness / 2}
        width={cardW - (m.redInset + m.redThickness / 2) * 2}
        height={cardH - (m.redInset + m.redThickness / 2) * 2}
        fill="none"
        stroke="#FC2902"
        strokeWidth={m.redThickness}
      />

      {/* Watermark */}
      <image
        href={CARTOES_ASSETS.marcaDagua}
        x={wmX}
        y={wmY}
        width={wmW}
        height={wmH}
        opacity={0.48}
        preserveAspectRatio="xMidYMid meet"
      />

      {/* Patches & Crest */}
      <image
        href={CARTOES_ASSETS.distintivo1BiMec}
        x={m.leftPatch.x}
        y={m.leftPatch.y}
        width={m.leftPatch.w}
        height={m.leftPatch.h}
      />
      <image
        href={CARTOES_ASSETS.distintivoFeb}
        x={m.rightPatch.x}
        y={m.rightPatch.y}
        width={m.rightPatch.w}
        height={m.rightPatch.h}
      />
      <image
        href={CARTOES_ASSETS.brasaoRepublica}
        x={m.repCrest.x}
        y={m.repCrest.y}
        width={m.repCrest.size}
        height={m.repCrest.size}
      />

      {/* Header lines (all bold, compact height matching side logos) */}
      {m.headerLines.map((hl, i) => {
        const fSize = estimateSvgFittedFontSizeMm(hl.text, hl.size, m.headerMaxW);
        return (
          <text
            key={i}
            x={cardW / 2}
            y={hl.y}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#000000"
            fontFamily="'Times New Roman', Georgia, serif"
            fontWeight={hl.bold ? 700 : 400}
            fontSize={fSize}
          >
            {hl.text}
          </text>
        );
      })}

      {/* Exact EngraversOldEnglishBT-Regular Vector Title */}
      <svg
        x={m.titleBox.x}
        y={m.titleBox.y}
        width={m.titleBox.w}
        height={m.titleBox.h}
        viewBox={BOAS_VINDAS_TITLE_VIEWBOX}
      >
        <path d={BOAS_VINDAS_TITLE_PATH} fill="#000000" />
      </svg>

      {/* Editable Welcome Body Text (justified edge-to-edge inside red border) */}
      {fitted.lines.map((line, idx) => (
        <g key={idx}>
          {line.words.map((word, wIdx) => (
            <text
              key={wIdx}
              x={m.bodyBox.x + word.xOffsetMm}
              y={m.bodyBox.y + idx * fitted.lineHeightMm}
              textAnchor="start"
              dominantBaseline="hanging"
              fill="#111111"
              fontFamily="'Open Sans', 'Plus Jakarta Sans', Arial, sans-serif"
              fontStyle="italic"
              fontWeight={400}
              fontSize={fitted.fontSizeMm}
            >
              {word.text}
            </text>
          ))}
        </g>
      ))}

      {/* Editable Date */}
      {dateText && (
        <text
          x={cardW / 2}
          y={m.dateY}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#111111"
          fontFamily="'Open Sans', 'Plus Jakarta Sans', Arial, sans-serif"
          fontStyle="italic"
          fontWeight={400}
          fontSize={dateFontMm}
        >
          {dateText}
        </text>
      )}

      {/* Commander Handwritten Signature */}
      <image
        href={CARTOES_ASSETS.assinaturaCmt}
        x={m.sigBox.x}
        y={m.sigBox.y}
        width={m.sigBox.w}
        height={m.sigBox.h}
      />

      <text
        x={cardW / 2}
        y={m.cmdNameY}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#000000"
        fontFamily="'Times New Roman', Georgia, serif"
        fontWeight={700}
        fontSize={cmdNameSize}
      >
        {cmdName}
      </text>
      <text
        x={cardW / 2}
        y={m.cmdTitleY}
        textAnchor="middle"
        dominantBaseline="central"
        fill="#000000"
        fontFamily="'Times New Roman', Georgia, serif"
        fontWeight={400}
        fontSize={cmdTitleSize}
      >
        {cmdTitle}
      </text>

      {/* Bottom-right Army Crest + Red/Blue Ribbon strictly inside outer blue border */}
      <g clipPath={`url(#${innerClipId})`}>
        <image
          href={CARTOES_ASSETS.brasaoExercitoFita}
          x={m.brasaoFitaBox.x}
          y={m.brasaoFitaBox.y}
          width={m.brasaoFitaBox.w}
          height={m.brasaoFitaBox.h}
        />
      </g>
    </g>
  );
};

interface CartoesGeneratorProps {
  externalDownloadSignal?: number;
  onModelChange?: (model: CartaoModel) => void;
}

export const CartoesGenerator: React.FC<CartoesGeneratorProps> = ({
  externalDownloadSignal = 0,
  onModelChange,
}) => {
  const [initial] = useState<StoredCartoesState>(() => loadInitialCartoesState());
  const [model, setModel] = useState<CartaoModel>(initial.model);
  const [config, setConfig] = useState<BoasVindasConfig>(initial.boasVindas);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [capNotice, setCapNotice] = useState<string | null>(null);
  const [anivDownloadSignal, setAnivDownloadSignal] = useState(0);
  const [pesamesDownloadSignal, setPesamesDownloadSignal] = useState(0);

  useEffect(() => {
    onModelChange?.(model);
  }, [model, onModelChange]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ model, boasVindas: config }));
    } catch {
      // Ignore storage quota errors
    }
  }, [model, config]);

  const layout = useMemo(
    () => computeCartaoLayout(config.cardWidthMm, config.cardHeightMm, config.countPerPage),
    [config.cardWidthMm, config.cardHeightMm, config.countPerPage]
  );

  // Check if the welcome text was auto-shrunk to fit
  const bodyFitInfo = useMemo(() => {
    const m = getBoasVindasCardMetrics(layout.cardW, layout.cardH);
    const fitted = fitBoasVindasBodyText(config.bodyText, m.bodyBox.maxW, m.bodyBox.maxH, layout.cardH);
    const baseSize = 3.15 * Math.min(layout.cardH / 95, m.bodyBox.maxW / (134 * 0.83));
    return {
      shrunk: fitted.fontSizeMm < baseSize - 0.1,
      lineCount: fitted.lines.length,
    };
  }, [config.bodyText, layout.cardW, layout.cardH]);

  const handleSizeChange = (field: 'cardWidthMm' | 'cardHeightMm', rawValue: string) => {
    const num = Number(rawValue);
    if (!Number.isFinite(num)) return;
    const nextW = field === 'cardWidthMm' ? num : config.cardWidthMm;
    const nextH = field === 'cardHeightMm' ? num : config.cardHeightMm;
    const newMax = getMaxCardsPerPage(nextW, nextH).maxPerPage;

    setConfig((prev) => {
      const clampedCount = Math.min(prev.countPerPage, newMax);
      if (clampedCount < prev.countPerPage) {
        setCapNotice(
          `Quantidade ajustada para ${clampedCount} cartão(ões) (máximo que cabe em A4 nesta medida).`
        );
      } else {
        setCapNotice(null);
      }
      return {
        ...prev,
        [field]: num,
        countPerPage: clampedCount,
      };
    });
  };

  const handleCountChange = (nextCount: number) => {
    const clamped = Math.max(1, Math.min(layout.maxPerPage, Math.floor(nextCount) || 1));
    setCapNotice(
      nextCount > layout.maxPerPage
        ? `Limite máximo para ${layout.cardW} × ${layout.cardH} mm é ${layout.maxPerPage} cartão(ões) por folha.`
        : null
    );
    setConfig((prev) => ({ ...prev, countPerPage: clamped }));
  };

  const handleDownloadPdf = async () => {
    if (model !== 'boas_vindas') return;
    setErrorMsg(null);
    setIsExportingPdf(true);
    try {
      const blob = await generateCartoesPdfBlob(config);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cartao-boas-vindas-${layout.effectiveCount}x-a4.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao gerar PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleDownloadPng = async () => {
    if (model !== 'boas_vindas') return;
    setErrorMsg(null);
    setIsExportingPng(true);
    try {
      const blob = await generateCartoesPngBlob(config);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cartao-boas-vindas-${layout.effectiveCount}x-a4.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao gerar PNG.');
    } finally {
      setIsExportingPng(false);
    }
  };

  useEffect(() => {
    if (externalDownloadSignal <= 0) return;
    if (model === 'boas_vindas') {
      void handleDownloadPdf();
    } else if (model === 'aniversario') {
      setAnivDownloadSignal((prev) => prev + 1);
    } else {
      setPesamesDownloadSignal((prev) => prev + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalDownloadSignal]);

  if (model === 'aniversario') {
    return (
      <AniversarioCardWorkspace
        onSwitchToBoasVindas={() => setModel('boas_vindas')}
        onSwitchToPesames={() => setModel('pesames')}
        externalDownloadSignal={anivDownloadSignal}
      />
    );
  }

  if (model === 'pesames') {
    return (
      <PesamesCardWorkspace
        onSwitchToBoasVindas={() => setModel('boas_vindas')}
        onSwitchToAniversario={() => setModel('aniversario')}
        externalDownloadSignal={pesamesDownloadSignal}
      />
    );
  }

  const bx0 = layout.blockXMm;
  const by0 = layout.blockYMm;
  const bx1 = layout.blockXMm + layout.blockWMm;
  const by1 = layout.blockYMm + layout.blockHMm;
  const tickLen = 2.6;
  const tickOffset = 0.6;
  const allVerticalXs = [bx0, ...layout.sharedVerticalSeamsMm, bx1];
  const allHorizontalYs = [by0, ...layout.sharedHorizontalSeamsMm, by1];

  return (
    <main className="max-w-[1440px] mx-auto w-full px-4 sm:px-6 py-5 grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6 items-start">
      {/* Left Configuration Panel */}
      <aside className="no-print bg-[#121715] border border-white/10 rounded-xl p-4 sm:p-5 space-y-5">
        <div className="space-y-2">
          <span className="block text-xs font-medium text-[#C6D4CC]">Modelo</span>

          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-[#0B0E0D] border border-white/10">
            <button
              type="button"
              onClick={() => setModel('boas_vindas')}
              className="min-h-[38px] rounded-md text-xs font-medium transition-colors px-1.5 bg-[#2D5A43] text-white whitespace-nowrap"
            >
              Boas-Vindas
            </button>
            <button
              type="button"
              onClick={() => setModel('aniversario')}
              className="min-h-[38px] rounded-md text-xs font-medium transition-colors px-1.5 text-[#98A89F] hover:text-[#E4EAE6] whitespace-nowrap"
            >
              Aniversário
            </button>
            <button
              type="button"
              onClick={() => setModel('pesames')}
              className="min-h-[38px] rounded-md text-xs font-medium transition-colors px-1.5 text-[#98A89F] hover:text-[#E4EAE6] whitespace-nowrap"
            >
              Pêsames
            </button>
          </div>
        </div>

        {/* Size Controls */}
        <section className="space-y-3 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#C6D4CC]">
                  Tamanho (mm)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCapNotice(null);
                    setConfig((prev) => ({
                      ...prev,
                      cardWidthMm: DEFAULT_BOAS_VINDAS_CONFIG.cardWidthMm,
                      cardHeightMm: DEFAULT_BOAS_VINDAS_CONFIG.cardHeightMm,
                      countPerPage: 4,
                    }));
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A8D6BC]"
                >
                  <RotateCcw className="w-3 h-3" />
                  Padrão
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="block text-xs text-[#98A89F]">Largura</span>
                  <input
                    type="number"
                    min={45}
                    max={290}
                    step={1}
                    value={config.cardWidthMm}
                    onChange={(e) => handleSizeChange('cardWidthMm', e.target.value)}
                    className="w-full h-10 rounded-lg bg-[#0B0E0D] border border-white/12 px-3 text-sm font-mono text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-xs text-[#98A89F]">Altura</span>
                  <input
                    type="number"
                    min={35}
                    max={290}
                    step={1}
                    value={config.cardHeightMm}
                    onChange={(e) => handleSizeChange('cardHeightMm', e.target.value)}
                    className="w-full h-10 rounded-lg bg-[#0B0E0D] border border-white/12 px-3 text-sm font-mono text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
                  />
                </label>
              </div>

              <div className="flex items-center justify-between rounded-lg bg-[#0B0E0D] border border-white/8 px-3 py-2 text-xs">
                <span className="text-[#98A89F]">Máx. A4</span>
                <span className="font-mono font-semibold text-[#83B499]">
                  {layout.maxPerPage} {layout.maxPerPage === 1 ? 'cartão' : 'cartões'}
                </span>
              </div>

              {layout.oversizedWarning && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-950/30 p-2.5 text-xs text-amber-200">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                  <span>{layout.oversizedWarning}</span>
                </div>
              )}
            </section>

            {/* Count Per Page Controls */}
            <section className="space-y-3 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#C6D4CC] flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#83B499]" />
                  Por página
                </span>
                <span className="font-mono text-xs text-[#83B499]">
                  {layout.effectiveCount} / {layout.maxPerPage}
                </span>
              </div>

              {layout.maxPerPage <= 6 ? (
                <div className="grid grid-cols-6 gap-1.5">
                  {Array.from({ length: layout.maxPerPage }, (_, idx) => idx + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handleCountChange(n)}
                      className={`h-9 rounded-lg text-sm font-mono font-semibold transition-colors border ${
                        layout.effectiveCount === n
                          ? 'bg-[#2D5A43] border-[#83B499]/60 text-white'
                          : 'bg-[#0B0E0D] border-white/10 text-[#98A89F] hover:text-[#E4EAE6]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={layout.maxPerPage}
                    value={layout.effectiveCount}
                    onChange={(e) => handleCountChange(Number(e.target.value))}
                    className="flex-1 accent-[#2D5A43]"
                  />
                  <input
                    type="number"
                    min={1}
                    max={layout.maxPerPage}
                    value={layout.effectiveCount}
                    onChange={(e) => handleCountChange(Number(e.target.value))}
                    className="w-20 h-9 rounded-lg bg-[#0B0E0D] border border-white/12 px-2.5 text-sm font-mono text-center text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
                  />
                </div>
              )}

              {capNotice && (
                <p className="text-[11px] text-amber-300 leading-snug">{capNotice}</p>
              )}
            </section>

            {/* Editable Date */}
            <section className="space-y-2.5 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="cartao-data-input"
                  className="text-xs font-medium text-[#C6D4CC] flex items-center gap-1.5"
                >
                  <Calendar className="w-3.5 h-3.5 text-[#83B499]" />
                  Data
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setConfig((prev) => ({ ...prev, dateText: formatTodayQuartelDate() }))
                  }
                  className="text-[11px] text-[#83B499] hover:text-[#A8D6BC]"
                >
                  Hoje
                </button>
              </div>

              <input
                id="cartao-data-input"
                type="text"
                value={config.dateText}
                onChange={(e) => setConfig((prev) => ({ ...prev, dateText: e.target.value }))}
                placeholder={DEFAULT_BOAS_VINDAS_DATE}
                className="w-full h-10 rounded-lg bg-[#0B0E0D] border border-[#83B499]/40 px-3 text-sm text-[#E4EAE6] focus:outline-none focus:border-[#83B499]"
              />
            </section>

            {/* Editable Welcome Text */}
            <section className="space-y-2.5 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="cartao-texto-input"
                  className="text-xs font-medium text-[#C6D4CC]"
                >
                  Texto
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setConfig((prev) => ({ ...prev, bodyText: DEFAULT_BOAS_VINDAS_TEXT }))
                  }
                  className="inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A8D6BC]"
                >
                  <RotateCcw className="w-3 h-3" />
                  Padrão
                </button>
              </div>

              <textarea
                id="cartao-texto-input"
                rows={4}
                value={config.bodyText}
                onChange={(e) => setConfig((prev) => ({ ...prev, bodyText: e.target.value }))}
                className="w-full rounded-lg bg-[#0B0E0D] border border-white/12 p-3 text-xs sm:text-sm text-[#E4EAE6] leading-relaxed focus:outline-none focus:border-[#83B499] resize-y"
              />
              {bodyFitInfo.shrunk && (
                <p className="text-[11px] text-[#83B499]">
                  Ajustado ({bodyFitInfo.lineCount} linhas)
                </p>
              )}
            </section>

            {/* Export Buttons */}
            <section className="space-y-2.5 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={isExportingPdf}
                className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] disabled:opacity-60 px-4 text-sm font-medium text-white transition-colors"
              >
                <Download className="w-4 h-4" />
                {isExportingPdf ? 'Gerando...' : 'PDF'}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleDownloadPng}
                  disabled={isExportingPng}
                  className="min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#161D1A] hover:bg-[#1E2824] disabled:opacity-60 px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-[#83B499]" />
                  {isExportingPng ? 'Gerando...' : 'PNG'}
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="min-h-[38px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#161D1A] hover:bg-[#1E2824] px-3 text-xs font-medium text-[#E4EAE6] transition-colors"
                >
                  <Printer className="w-3.5 h-3.5 text-[#83B499]" />
                  Imprimir
                </button>
              </div>

              {errorMsg && (
                <p className="text-xs text-red-400 bg-red-950/40 border border-red-500/30 rounded-lg p-2.5">
                  {errorMsg}
                </p>
              )}
        </section>
      </aside>

      {/* Right Live A4 Preview */}
      <section className="min-w-0 w-full flex flex-col items-center">
        <div className="w-full max-w-[680px]">
            <div className="no-print flex items-center justify-between text-xs text-[#98A89F] mb-2.5 px-1">
              <span>
                A4 · {layout.effectiveCount}× ({layout.cardW} × {layout.cardH} mm)
              </span>
              <span className="font-mono text-[#83B499]">210 × 297 mm</span>
            </div>

            <PinchZoomSheetFrame
              maxWidthClass="max-w-[680px]"
              className="rounded-xl shadow-2xl border border-white/10 bg-white"
            >
              <svg
                viewBox={`0 0 ${A4_W_MM} ${A4_H_MM}`}
                className="print-a4-sheet w-full h-auto bg-white block select-none"
                role="img"
                aria-label="Pré-visualização em folha A4 dos Cartões de Boas-Vindas grudados"
              >
                <rect x={0} y={0} width={A4_W_MM} height={A4_H_MM} fill="#FFFFFF" />

                {layout.placedCards.map((unit) => {
                  const transform = unit.rotated90
                    ? `translate(${unit.xMm + unit.slotW}, ${unit.yMm}) rotate(90)`
                    : `translate(${unit.xMm}, ${unit.yMm})`;
                  return (
                    <g key={unit.index} transform={transform}>
                      <BoasVindasCardSvgContent
                        cardW={unit.cardW}
                        cardH={unit.cardH}
                        config={config}
                        clipId={`bv-card-clip-${unit.index}`}
                      />
                    </g>
                  );
                })}

                {/* External crop ticks in outer margin */}
                <g stroke="rgba(15, 23, 42, 0.55)" strokeWidth={0.18}>
                  {allVerticalXs.map((vx, i) => (
                    <React.Fragment key={`vx-${i}`}>
                      <line
                        x1={vx}
                        y1={Math.max(0, by0 - tickOffset - tickLen)}
                        x2={vx}
                        y2={Math.max(0, by0 - tickOffset)}
                      />
                      <line
                        x1={vx}
                        y1={Math.min(A4_H_MM, by1 + tickOffset)}
                        x2={vx}
                        y2={Math.min(A4_H_MM, by1 + tickOffset + tickLen)}
                      />
                    </React.Fragment>
                  ))}
                  {allHorizontalYs.map((hy, i) => (
                    <React.Fragment key={`hy-${i}`}>
                      <line
                        x1={Math.max(0, bx0 - tickOffset - tickLen)}
                        y1={hy}
                        x2={Math.max(0, bx0 - tickOffset)}
                        y2={hy}
                      />
                      <line
                        x1={Math.min(A4_W_MM, bx1 + tickOffset)}
                        y1={hy}
                        x2={Math.min(A4_W_MM, bx1 + tickOffset + tickLen)}
                        y2={hy}
                      />
                    </React.Fragment>
                  ))}
                </g>

                {/* Thin cut-seam guides between adjacent glued cards */}
                <g stroke="rgba(0, 0, 0, 0.35)" strokeWidth={0.14}>
                  {layout.sharedVerticalSeamsMm.map((vx, i) => (
                    <line key={`seam-v-${i}`} x1={vx} y1={by0} x2={vx} y2={by1} />
                  ))}
                  {layout.sharedHorizontalSeamsMm.map((hy, i) => (
                    <line key={`seam-h-${i}`} x1={bx0} y1={hy} x2={bx1} y2={hy} />
                  ))}
                </g>
              </svg>
            </PinchZoomSheetFrame>
          </div>
      </section>
    </main>
  );
};

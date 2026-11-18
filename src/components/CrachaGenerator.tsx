import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, Image as ImageIcon, ListOrdered, Printer, RotateCcw } from 'lucide-react';
import {
  A4_H_MM,
  A4_W_MM,
  computeCrachaLayout,
  CRACHA_CREST_SRC,
  DEFAULT_IDENTIFICACAO_COLORS,
  DEFAULT_RP_COLORS,
  generateCrachaPngBlob,
  generateCrachasPdfBlob,
  getCrachaTextDiagnostics,
  wrapAndFitText,
  type CrachaColors,
  type CrachaConfig,
  type CrachaEntry,
  type CrachaMode,
  type CrachaSidedness,
  type PlacedBadgeUnit,
} from '../lib/crachaPdf';
import { PinchZoomSheetFrame } from './PinchZoomSheetFrame';

const STORAGE_KEY = 'siscom_cracha_state_v2';

function createDefaultEntry(mode: CrachaMode, index: number): CrachaEntry {
  if (mode === 'identificacao') {
    return {
      nomeCompleto: index === 0 ? 'JOÃO SILVA DOS SANTOS' : '',
      cpf: index === 0 ? '000.000.000-00' : '',
      rpTexto: String(index + 1),
      versoIgual: true,
      versoTexto: '',
    };
  }
  return {
    nomeCompleto: '',
    cpf: '',
    rpTexto: index === 0 ? '15' : String(15 + index),
    versoIgual: true,
    versoTexto: '',
  };
}

function createDefaultConfig(mode: CrachaMode): CrachaConfig {
  if (mode === 'identificacao') {
    return {
      mode: 'identificacao',
      perPage: 4,
      widthMm: 95,
      heightMm: 70,
      sidedness: 'frente_verso',
      topText: 'OBRA',
      bottomText: 'PERMISSIONÁRIO',
      rpHeaderText: '',
      uppercase: true,
      colors: { ...DEFAULT_IDENTIFICACAO_COLORS },
      entries: Array.from({ length: 4 }, (_, i) => createDefaultEntry('identificacao', i)),
    };
  }
  return {
    mode: 'rp',
    perPage: 4,
    widthMm: 95,
    heightMm: 70,
    sidedness: 'frente_verso',
    topText: '',
    bottomText: 'MILITAR ATIVA',
    rpHeaderText: '',
    uppercase: true,
    colors: { ...DEFAULT_RP_COLORS },
    entries: Array.from({ length: 4 }, (_, i) => createDefaultEntry('rp', i)),
  };
}

interface StoredCrachaState {
  activeMode: CrachaMode;
  configs: Record<CrachaMode, CrachaConfig>;
}

function sanitizeConfig(raw: unknown, fallbackMode: CrachaMode): CrachaConfig {
  const def = createDefaultConfig(fallbackMode);
  if (!raw || typeof raw !== 'object') return def;
  const obj = raw as Partial<CrachaConfig>;
  const perPage =
    typeof obj.perPage === 'number' && Number.isFinite(obj.perPage)
      ? Math.max(1, Math.min(24, Math.floor(obj.perPage)))
      : def.perPage;
  const widthMm =
    typeof obj.widthMm === 'number' && Number.isFinite(obj.widthMm)
      ? Math.max(30, Math.min(200, obj.widthMm))
      : def.widthMm;
  const heightMm =
    typeof obj.heightMm === 'number' && Number.isFinite(obj.heightMm)
      ? Math.max(25, Math.min(280, obj.heightMm))
      : def.heightMm;
  const sidedness: CrachaSidedness =
    obj.sidedness === 'frente' || obj.sidedness === 'frente_verso' ? obj.sidedness : def.sidedness;

  const rawColors = (obj.colors || {}) as Partial<CrachaColors>;
  const colors: CrachaColors = {
    topBg: typeof rawColors.topBg === 'string' ? rawColors.topBg : def.colors.topBg,
    topText: typeof rawColors.topText === 'string' ? rawColors.topText : def.colors.topText,
    divider: typeof rawColors.divider === 'string' ? rawColors.divider : def.colors.divider,
    centerBg: typeof rawColors.centerBg === 'string' ? rawColors.centerBg : def.colors.centerBg,
    centerText:
      typeof rawColors.centerText === 'string' ? rawColors.centerText : def.colors.centerText,
    bottomBg: typeof rawColors.bottomBg === 'string' ? rawColors.bottomBg : def.colors.bottomBg,
    bottomText:
      typeof rawColors.bottomText === 'string' ? rawColors.bottomText : def.colors.bottomText,
  };

  const rawEntries = Array.isArray(obj.entries) ? obj.entries : [];
  const entries: CrachaEntry[] = Array.from({ length: Math.max(perPage, rawEntries.length) }, (_, i) => {
    const e = rawEntries[i] as Partial<CrachaEntry> | undefined;
    const base = createDefaultEntry(fallbackMode, i);
    return {
      nomeCompleto: typeof e?.nomeCompleto === 'string' ? e.nomeCompleto : base.nomeCompleto,
      cpf: typeof e?.cpf === 'string' ? e.cpf : base.cpf,
      rpTexto: typeof e?.rpTexto === 'string' ? e.rpTexto : base.rpTexto,
      versoIgual: typeof e?.versoIgual === 'boolean' ? e.versoIgual : true,
      versoTexto: typeof e?.versoTexto === 'string' ? e.versoTexto : '',
    };
  });

  return {
    mode: fallbackMode,
    perPage,
    widthMm,
    heightMm,
    sidedness,
    topText: typeof obj.topText === 'string' ? obj.topText : def.topText,
    bottomText: typeof obj.bottomText === 'string' ? obj.bottomText : def.bottomText,
    rpHeaderText: typeof obj.rpHeaderText === 'string' ? obj.rpHeaderText : def.rpHeaderText,
    uppercase: typeof obj.uppercase === 'boolean' ? obj.uppercase : def.uppercase,
    colors,
    entries,
  };
}

function loadInitialState(): StoredCrachaState {
  const defaults: StoredCrachaState = {
    activeMode: 'identificacao',
    configs: {
      identificacao: createDefaultConfig('identificacao'),
      rp: createDefaultConfig('rp'),
    },
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<StoredCrachaState>;
    const activeMode: CrachaMode =
      parsed.activeMode === 'rp' || parsed.activeMode === 'identificacao'
        ? parsed.activeMode
        : 'identificacao';
    return {
      activeMode,
      configs: {
        identificacao: sanitizeConfig(parsed.configs?.identificacao, 'identificacao'),
        rp: sanitizeConfig(parsed.configs?.rp, 'rp'),
      },
    };
  } catch {
    return defaults;
  }
}

const ptToMm = (pt: number) => (pt * 25.4) / 72;

interface SingleFaceSvgProps {
  config: CrachaConfig;
  entry: CrachaEntry;
  isBack: boolean;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  rotated180?: boolean;
}

const SingleFaceSvg: React.FC<SingleFaceSvgProps> = ({
  config,
  entry,
  isBack,
  xMm,
  yMm,
  wMm,
  hMm,
  rotated180 = false,
}) => {
  const { colors, mode, uppercase } = config;
  const fmt = (s: string) => (uppercase ? s.trim().toUpperCase() : s.trim());
  const topText = fmt(config.topText);
  const bottomText = fmt(config.bottomText);
  const rpHeaderText = fmt(config.rpHeaderText);

  const transform = rotated180
    ? `translate(${xMm} ${yMm}) rotate(180 ${wMm / 2} ${hMm / 2})`
    : `translate(${xMm} ${yMm})`;

  const borderStroke = 0.55;

  if (mode === 'identificacao') {
    const topH = hMm * 0.22;
    const divH = hMm * 0.04;
    const bottomH = hMm * 0.22;
    const centerY = topH + divH;
    const centerH = hMm - topH - divH * 2 - bottomH;

    const crestH = Math.min(centerH * 0.76, hMm * 0.36);
    const crestW = crestH * (291 / 405);
    const crestPadX = wMm * 0.045;
    const crestY = centerY + (centerH - crestH) / 2;

    const textSafeW = Math.max(15, wMm - (crestPadX + crestW + 4.0) * 2);
    const centerMidY = centerY + centerH / 2;

    const fittedTop = topText
      ? wrapAndFitText({
          text: topText,
          maxWidthMm: wMm * 0.88,
          maxHeightMm: topH * 0.78,
          startPt: Math.min(26, topH * 1.45),
          maxLines: 1,
        })
      : null;

    const fittedBot = bottomText
      ? wrapAndFitText({
          text: bottomText,
          maxWidthMm: wMm * 0.9,
          maxHeightMm: bottomH * 0.78,
          startPt: Math.min(26, bottomH * 1.45),
          maxLines: 1,
        })
      : null;

    const useCustomBack = isBack && !entry.versoIgual && Boolean(entry.versoTexto.trim());
    const customBackFit = useCustomBack
      ? wrapAndFitText({
          text: fmt(entry.versoTexto),
          maxWidthMm: textSafeW,
          maxHeightMm: centerH * 0.82,
          startPt: 13,
          maxLines: 4,
        })
      : null;

    const nome = fmt(entry.nomeCompleto);
    const cpf = fmt(entry.cpf);
    const nomeFit = !useCustomBack
      ? wrapAndFitText({
          text: nome,
          maxWidthMm: textSafeW,
          maxHeightMm: centerH * (cpf ? 0.52 : 0.78),
          startPt: 12.5,
          maxLines: 2,
        })
      : null;
    const cpfFit =
      !useCustomBack && cpf
        ? wrapAndFitText({
            text: cpf,
            maxWidthMm: textSafeW,
            maxHeightMm: centerH * 0.28,
            startPt: 13,
            maxLines: 1,
          })
        : null;

    const renderNomeCpf = () => {
      if (customBackFit) {
        const fontMm = ptToMm(customBackFit.fontPt);
        const lh = fontMm * 1.18;
        const startY = centerMidY - ((customBackFit.lines.length - 1) * lh) / 2;
        return customBackFit.lines.map((ln, idx) => (
          <text
            key={idx}
            x={wMm / 2}
            y={startY + idx * lh}
            textAnchor="middle"
            dominantBaseline="central"
            fill={colors.centerText}
            fontWeight={700}
            fontSize={fontMm}
          >
            {ln}
          </text>
        ));
      }

      const nomeLines = nomeFit?.lines || [];
      const nomeMm = ptToMm(nomeFit?.fontPt || 12.5);
      const nomeLh = nomeMm * 1.15;
      const cpfMm = cpfFit ? ptToMm(cpfFit.fontPt) : 0;
      const gap = cpf && nomeLines.length > 0 ? 1.8 : 0;
      const totalBlockH = nomeLines.length * nomeLh + gap + (cpf ? cpfMm : 0);
      let cursorY = centerMidY - totalBlockH / 2 + nomeLh / 2;

      const elements: React.ReactNode[] = [];
      nomeLines.forEach((ln, idx) => {
        elements.push(
          <text
            key={`n-${idx}`}
            x={wMm / 2}
            y={cursorY}
            textAnchor="middle"
            dominantBaseline="central"
            fill={colors.centerText}
            fontWeight={700}
            fontSize={nomeMm}
          >
            {ln}
          </text>
        );
        cursorY += nomeLh;
      });
      if (cpf && cpfFit) {
        cursorY += gap + cpfMm / 2 - nomeLh / 2;
        elements.push(
          <text
            key="cpf"
            x={wMm / 2}
            y={cursorY}
            textAnchor="middle"
            dominantBaseline="central"
            fill={colors.centerText}
            fontWeight={700}
            fontSize={cpfMm}
          >
            {cpfFit.lines[0] || cpf}
          </text>
        );
      }
      return elements;
    };

    return (
      <g transform={transform} style={{ fontFamily: '"Open Sans", Arial, sans-serif' }}>
        <rect x={0} y={0} width={wMm} height={topH} fill={colors.topBg} />
        <rect x={0} y={topH} width={wMm} height={divH} fill={colors.divider} />
        <rect x={0} y={centerY} width={wMm} height={centerH} fill={colors.centerBg} />
        <rect x={0} y={centerY + centerH} width={wMm} height={divH} fill={colors.divider} />
        <rect x={0} y={hMm - bottomH} width={wMm} height={bottomH} fill={colors.bottomBg} />

        {fittedTop && fittedTop.lines[0] && (
          <text
            x={wMm / 2}
            y={topH / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={colors.topText}
            fontWeight={700}
            fontSize={ptToMm(fittedTop.fontPt)}
          >
            {fittedTop.lines[0]}
          </text>
        )}

        {fittedBot && fittedBot.lines[0] && (
          <text
            x={wMm / 2}
            y={hMm - bottomH / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={colors.bottomText}
            fontWeight={700}
            fontSize={ptToMm(fittedBot.fontPt)}
          >
            {fittedBot.lines[0]}
          </text>
        )}

        <image
          href={CRACHA_CREST_SRC}
          x={crestPadX}
          y={crestY}
          width={crestW}
          height={crestH}
          preserveAspectRatio="xMidYMid meet"
        />
        <image
          href={CRACHA_CREST_SRC}
          x={wMm - crestPadX - crestW}
          y={crestY}
          width={crestW}
          height={crestH}
          preserveAspectRatio="xMidYMid meet"
        />

        {renderNomeCpf()}

        <rect
          x={borderStroke / 2}
          y={borderStroke / 2}
          width={wMm - borderStroke}
          height={hMm - borderStroke}
          fill="none"
          stroke="#000000"
          strokeWidth={borderStroke}
        />
      </g>
    );
  }

  // RP Mode
  const topBodyH = hMm * 0.65;
  const divH = hMm * 0.05;
  const bottomH = hMm - topBodyH - divH;
  const innerPad = 1.6;
  const innerW = wMm - innerPad * 2;
  const innerTopH = topBodyH - innerPad;
  const innerBotH = bottomH - innerPad;

  const crestH = Math.min(innerTopH * 0.62, hMm * 0.37);
  const crestW = crestH * (291 / 405);
  const crestPadX = innerPad + wMm * 0.045;
  const crestY = innerPad + (innerTopH - crestH) / 2;

  const textSafeW = Math.max(15, wMm - (crestPadX + crestW + 3.5) * 2);
  const bodyText = fmt(
    isBack && !entry.versoIgual && entry.versoTexto.trim() ? entry.versoTexto : entry.rpTexto
  );

  const hdrH = rpHeaderText ? innerTopH * 0.24 : 0;
  const hdrFit = rpHeaderText
    ? wrapAndFitText({
        text: rpHeaderText,
        maxWidthMm: textSafeW,
        maxHeightMm: hdrH,
        startPt: 13,
        maxLines: 1,
      })
    : null;

  const mainAreaY = innerPad + hdrH;
  const mainAreaH = innerTopH - hdrH;

  const bodyStartPt =
    bodyText.length <= 4 ? Math.min(62, mainAreaH * 1.4) : Math.min(28, mainAreaH * 0.9);
  const bodyFit = bodyText
    ? wrapAndFitText({
        text: bodyText,
        maxWidthMm: textSafeW,
        maxHeightMm: mainAreaH * 0.85,
        startPt: bodyStartPt,
        maxLines: 3,
      })
    : null;

  const botFit = bottomText
    ? wrapAndFitText({
        text: bottomText,
        maxWidthMm: innerW * 0.9,
        maxHeightMm: innerBotH * 0.78,
        startPt: Math.min(28, innerBotH * 1.35),
        maxLines: 1,
      })
    : null;

  const bodyFontMm = bodyFit ? ptToMm(bodyFit.fontPt) : 0;
  const bodyLh = bodyFontMm * 1.12;
  const bodyStartY = bodyFit
    ? mainAreaY + mainAreaH / 2 - ((bodyFit.lines.length - 1) * bodyLh) / 2
    : 0;

  return (
    <g transform={transform} style={{ fontFamily: '"Open Sans", Arial, sans-serif' }}>
      <rect x={0} y={0} width={wMm} height={hMm} fill="#FFFFFF" />
      <rect x={innerPad} y={innerPad} width={innerW} height={innerTopH} fill={colors.topBg} />
      <rect x={innerPad} y={topBodyH} width={innerW} height={divH} fill={colors.divider} />
      <rect
        x={innerPad}
        y={topBodyH + divH}
        width={innerW}
        height={innerBotH}
        fill={colors.bottomBg}
      />

      <image
        href={CRACHA_CREST_SRC}
        x={crestPadX}
        y={crestY}
        width={crestW}
        height={crestH}
        preserveAspectRatio="xMidYMid meet"
      />
      <image
        href={CRACHA_CREST_SRC}
        x={wMm - crestPadX - crestW}
        y={crestY}
        width={crestW}
        height={crestH}
        preserveAspectRatio="xMidYMid meet"
      />

      {hdrFit && hdrFit.lines[0] && (
        <text
          x={wMm / 2}
          y={innerPad + hdrH * 0.65}
          textAnchor="middle"
          dominantBaseline="central"
          fill={colors.topText}
          fontWeight={700}
          fontSize={ptToMm(hdrFit.fontPt)}
        >
          {hdrFit.lines[0]}
        </text>
      )}

      {bodyFit &&
        bodyFit.lines.map((ln, idx) => (
          <text
            key={idx}
            x={wMm / 2}
            y={bodyStartY + idx * bodyLh}
            textAnchor="middle"
            dominantBaseline="central"
            fill={colors.centerText}
            fontWeight={700}
            fontSize={bodyFontMm}
          >
            {ln}
          </text>
        ))}

      {botFit && botFit.lines[0] && (
        <text
          x={wMm / 2}
          y={topBodyH + divH + innerBotH / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={colors.bottomText}
          fontWeight={700}
          fontSize={ptToMm(botFit.fontPt)}
        >
          {botFit.lines[0]}
        </text>
      )}

      <rect
        x={borderStroke / 2}
        y={borderStroke / 2}
        width={wMm - borderStroke}
        height={hMm - borderStroke}
        fill="none"
        stroke="#000000"
        strokeWidth={borderStroke}
      />
    </g>
  );
};

interface CrachaSheetSvgProps {
  config: CrachaConfig;
  pageUnits: PlacedBadgeUnit[];
  pageIndex: number;
}

const CrachaSheetSvg: React.FC<CrachaSheetSvgProps> = ({ config, pageUnits, pageIndex }) => {
  const singleW = Math.max(30, Math.min(200, Number(config.widthMm) || 95));
  const singleH = Math.max(25, Math.min(280, Number(config.heightMm) || 70));

  return (
    <svg
      viewBox={`0 0 ${A4_W_MM} ${A4_H_MM}`}
      className="print-a4-sheet w-full h-auto bg-white block select-none"
      role="img"
      aria-label={`Folha A4 de crachás — página ${pageIndex + 1}`}
    >
      <rect x={0} y={0} width={A4_W_MM} height={A4_H_MM} fill="#FFFFFF" />
      {pageUnits.map((unit) => {
        const entry = config.entries[unit.entryIndex] || config.entries[0];
        if (!entry) return null;

        if (unit.foldMode === 'none') {
          return (
            <SingleFaceSvg
              key={`u-${unit.entryIndex}`}
              config={config}
              entry={entry}
              isBack={false}
              xMm={unit.xMm}
              yMm={unit.yMm}
              wMm={singleW}
              hMm={singleH}
            />
          );
        }

        if (unit.foldMode === 'horizontal') {
          return (
            <g key={`u-${unit.entryIndex}`}>
              <SingleFaceSvg
                config={config}
                entry={entry}
                isBack={false}
                xMm={unit.xMm}
                yMm={unit.yMm}
                wMm={singleW}
                hMm={singleH}
              />
              <SingleFaceSvg
                config={config}
                entry={entry}
                isBack={true}
                xMm={unit.xMm + singleW}
                yMm={unit.yMm}
                wMm={singleW}
                hMm={singleH}
              />
              {/* Non-printed fold seam guide */}
              <line
                className="no-print"
                x1={unit.xMm + singleW}
                y1={unit.yMm}
                x2={unit.xMm + singleW}
                y2={unit.yMm + singleH}
                stroke="#0F172A"
                strokeOpacity={0.35}
                strokeWidth={0.4}
                strokeDasharray="1.8 1.4"
              />
            </g>
          );
        }

        return (
          <g key={`u-${unit.entryIndex}`}>
            <SingleFaceSvg
              config={config}
              entry={entry}
              isBack={true}
              xMm={unit.xMm}
              yMm={unit.yMm}
              wMm={singleW}
              hMm={singleH}
              rotated180
            />
            <SingleFaceSvg
              config={config}
              entry={entry}
              isBack={false}
              xMm={unit.xMm}
              yMm={unit.yMm + singleH}
              wMm={singleW}
              hMm={singleH}
            />
            <line
              className="no-print"
              x1={unit.xMm}
              y1={unit.yMm + singleH}
              x2={unit.xMm + singleW}
              y2={unit.yMm + singleH}
              stroke="#0F172A"
              strokeOpacity={0.35}
              strokeWidth={0.4}
              strokeDasharray="1.8 1.4"
            />
          </g>
        );
      })}
    </svg>
  );
};

interface ColorFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const ColorField: React.FC<ColorFieldProps> = ({ id, label, value, onChange }) => (
  <label
    htmlFor={id}
    className="flex items-center justify-between gap-2.5 rounded-lg bg-[#0E1211] border border-white/10 px-3 py-2 cursor-pointer hover:border-white/20 transition-colors"
  >
    <div className="min-w-0">
      <span className="block text-xs text-[#C6D4CC] truncate">{label}</span>
      <span className="block font-mono text-[11px] text-[#83B499] uppercase">{value}</span>
    </div>
    <input
      id={id}
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
      className="h-7 w-9 rounded border border-white/15 bg-transparent cursor-pointer shrink-0"
    />
  </label>
);

export interface CrachaGeneratorProps {
  externalDownloadSignal?: number;
}

export const CrachaGenerator: React.FC<CrachaGeneratorProps> = ({ externalDownloadSignal }) => {
  const initial = useMemo(() => loadInitialState(), []);
  const [activeMode, setActiveMode] = useState<CrachaMode>(initial.activeMode);
  const [configs, setConfigs] = useState<Record<CrachaMode, CrachaConfig>>(initial.configs);
  const [exporting, setExporting] = useState<'pdf' | 'png' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fontsTick, setFontsTick] = useState(0);

  const config = configs[activeMode];

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeMode, configs }));
    } catch {
      // Ignore storage quota errors cleanly
    }
  }, [activeMode, configs]);

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

  const updateCurrentConfig = (updater: (prev: CrachaConfig) => CrachaConfig) => {
    setConfigs((prev) => ({
      ...prev,
      [activeMode]: updater(prev[activeMode]),
    }));
  };

  const handlePerPageChange = (nextCountRaw: number) => {
    const nextCount = Math.max(1, Math.min(24, Math.floor(nextCountRaw || 1)));
    updateCurrentConfig((prev) => {
      const nextEntries = [...prev.entries];
      while (nextEntries.length < nextCount) {
        nextEntries.push(createDefaultEntry(prev.mode, nextEntries.length));
      }
      return {
        ...prev,
        perPage: nextCount,
        entries: nextEntries,
      };
    });
  };

  const handleEntryChange = <K extends keyof CrachaEntry>(
    index: number,
    field: K,
    value: CrachaEntry[K]
  ) => {
    updateCurrentConfig((prev) => {
      const nextEntries = [...prev.entries];
      while (nextEntries.length <= index) {
        nextEntries.push(createDefaultEntry(prev.mode, nextEntries.length));
      }
      nextEntries[index] = {
        ...nextEntries[index],
        [field]: value,
      };
      return {
        ...prev,
        entries: nextEntries,
      };
    });
  };

  const handleCopyFirstToAll = () => {
    updateCurrentConfig((prev) => {
      const first = prev.entries[0] || createDefaultEntry(prev.mode, 0);
      const nextEntries = prev.entries.map((entry, idx) =>
        idx === 0 ? entry : { ...first }
      );
      return { ...prev, entries: nextEntries };
    });
    setNotice('Crachá 1 copiado.');
  };

  const handleSequenceRpNumbers = () => {
    updateCurrentConfig((prev) => {
      const firstVal = prev.entries[0]?.rpTexto.trim() || '1';
      const parsedStart = Number.parseInt(firstVal, 10);
      const startNum = Number.isFinite(parsedStart) ? parsedStart : 1;
      const nextEntries = prev.entries.map((entry, idx) => ({
        ...entry,
        rpTexto: String(startNum + idx),
      }));
      return { ...prev, entries: nextEntries };
    });
    setNotice('Sequência aplicada.');
  };

  const handleRestoreColors = () => {
    updateCurrentConfig((prev) => ({
      ...prev,
      colors:
        prev.mode === 'identificacao'
          ? { ...DEFAULT_IDENTIFICACAO_COLORS }
          : { ...DEFAULT_RP_COLORS },
    }));
    setNotice('Cores restauradas.');
  };

  const updateColor = (field: keyof CrachaColors, value: string) => {
    updateCurrentConfig((prev) => ({
      ...prev,
      colors: {
        ...prev.colors,
        [field]: value,
      },
    }));
  };

  const layout = useMemo(() => {
    void fontsTick;
    return computeCrachaLayout(config);
  }, [config, fontsTick]);

  const handleDownloadPdf = async () => {
    setExporting('pdf');
    setNotice(null);
    try {
      const blob = await generateCrachasPdfBlob(config);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crachas-${config.mode}-${config.perPage}x-${config.sidedness}.pdf`;
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
      for (let pageIdx = 0; pageIdx < layout.pages.length; pageIdx++) {
        const blob = await generateCrachaPngBlob(config, pageIdx);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const pageSuffix = layout.pages.length > 1 ? `-p${pageIdx + 1}` : '';
        a.download = `crachas-${config.mode}-${config.perPage}x${pageSuffix}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
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

  const activeEntries = useMemo(
    () =>
      Array.from(
        { length: config.perPage },
        (_, i) => config.entries[i] || createDefaultEntry(config.mode, i)
      ),
    [config.entries, config.mode, config.perPage]
  );

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start print-wrapper">
      {/* Left Configuration Column */}
      <section className="no-print lg:col-span-5 metal-surface rounded-xl p-5 sm:p-6 space-y-5">
        {/* Mode Switcher: Identificação | RP */}
        <div className="space-y-2">
          <span className="block text-xs font-medium text-[#C6D4CC]">Modelo</span>
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#0E1211] border border-white/10">
            <button
              type="button"
              onClick={() => {
                setActiveMode('identificacao');
                setNotice(null);
              }}
              className={`min-h-[40px] rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeMode === 'identificacao'
                  ? 'bg-[#2D5A43] text-white'
                  : 'text-[#98A89F] hover:text-[#E4EAE6]'
              }`}
            >
              Identificação
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveMode('rp');
                setNotice(null);
              }}
              className={`min-h-[40px] rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                activeMode === 'rp'
                  ? 'bg-[#2D5A43] text-white'
                  : 'text-[#98A89F] hover:text-[#E4EAE6]'
              }`}
            >
              RP
            </button>
          </div>
        </div>

        {/* Quantidade */}
        <div className="space-y-2 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="cracha-per-page" className="text-xs font-medium text-[#C6D4CC]">
              Quantidade
            </label>
            <span className="font-mono text-[11px] text-[#83B499]">
              {layout.pages.length} A4
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="cracha-per-page"
              type="number"
              min={1}
              max={24}
              value={config.perPage}
              onChange={(e) => handlePerPageChange(Number(e.target.value))}
              className="w-24 min-h-[40px] rounded-lg bg-[#0E1211] border border-white/12 px-3 font-mono text-sm text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
            />
            <div className="flex-1 grid grid-cols-5 gap-1">
              {[1, 2, 4, 6, 8].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handlePerPageChange(preset)}
                  className={`min-h-[40px] rounded-lg border font-mono text-xs transition-colors ${
                    config.perPage === preset
                      ? 'bg-[#2D5A43] border-[#376C51] text-white'
                      : 'bg-[#0E1211] border-white/10 text-[#98A89F] hover:text-[#E4EAE6]'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tamanho */}
        <div className="space-y-2 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#C6D4CC]">
              Tamanho (mm)
            </span>
            <button
              type="button"
              onClick={() =>
                updateCurrentConfig((prev) => ({ ...prev, widthMm: 95, heightMm: 70 }))
              }
              className="text-[11px] text-[#83B499] hover:text-[#A3D4B9] transition-colors"
            >
              Padrão
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="cracha-width" className="block text-[11px] text-[#98A89F]">
                Largura
              </label>
              <input
                id="cracha-width"
                type="number"
                min={30}
                max={200}
                step={1}
                value={config.widthMm}
                onChange={(e) =>
                  updateCurrentConfig((prev) => ({
                    ...prev,
                    widthMm: Math.max(30, Math.min(200, Number(e.target.value) || 95)),
                  }))
                }
                className="w-full min-h-[40px] rounded-lg bg-[#0E1211] border border-white/12 px-3 font-mono text-sm text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="cracha-height" className="block text-[11px] text-[#98A89F]">
                Altura
              </label>
              <input
                id="cracha-height"
                type="number"
                min={25}
                max={280}
                step={1}
                value={config.heightMm}
                onChange={(e) =>
                  updateCurrentConfig((prev) => ({
                    ...prev,
                    heightMm: Math.max(25, Math.min(280, Number(e.target.value) || 70)),
                  }))
                }
                className="w-full min-h-[40px] rounded-lg bg-[#0E1211] border border-white/12 px-3 font-mono text-sm text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
              />
            </div>
          </div>

          {layout.oversizedWarning && (
            <p className="text-[11px] text-[#E5C17B] bg-[#3B2E17]/40 border border-[#E5C17B]/25 rounded-lg px-3 py-2">
              {layout.oversizedWarning}
            </p>
          )}
        </div>

        {/* Lados */}
        <div className="space-y-2 pt-3 border-t border-white/10">
          <span className="block text-xs font-medium text-[#C6D4CC]">Lados</span>
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#0E1211] border border-white/10">
            <button
              type="button"
              onClick={() => updateCurrentConfig((prev) => ({ ...prev, sidedness: 'frente' }))}
              className={`min-h-[40px] rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                config.sidedness === 'frente'
                  ? 'bg-[#2D5A43] text-white'
                  : 'text-[#98A89F] hover:text-[#E4EAE6]'
              }`}
            >
              Só frente
            </button>
            <button
              type="button"
              onClick={() =>
                updateCurrentConfig((prev) => ({ ...prev, sidedness: 'frente_verso' }))
              }
              className={`min-h-[40px] rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                config.sidedness === 'frente_verso'
                  ? 'bg-[#2D5A43] text-white'
                  : 'text-[#98A89F] hover:text-[#E4EAE6]'
              }`}
            >
              Frente e verso
            </button>
          </div>
        </div>

        {/* Faixas */}
        <div className="space-y-3 pt-3 border-t border-white/10">
          <span className="block text-xs font-medium text-[#C6D4CC]">
            Faixas
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeMode === 'identificacao' ? (
              <div className="space-y-1">
                <label htmlFor="cracha-top-text" className="block text-[11px] text-[#98A89F]">
                  Superior
                </label>
                <input
                  id="cracha-top-text"
                  type="text"
                  value={config.topText}
                  onChange={(e) =>
                    updateCurrentConfig((prev) => ({ ...prev, topText: e.target.value }))
                  }
                  placeholder="OBRA"
                  className="w-full min-h-[40px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095]"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <label htmlFor="cracha-rp-header" className="block text-[11px] text-[#98A89F]">
                  Superior (opcional)
                </label>
                <input
                  id="cracha-rp-header"
                  type="text"
                  value={config.rpHeaderText}
                  onChange={(e) =>
                    updateCurrentConfig((prev) => ({ ...prev, rpHeaderText: e.target.value }))
                  }
                  placeholder="1º BI MEC (ES)"
                  className="w-full min-h-[40px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095]"
                />
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="cracha-bottom-text" className="block text-[11px] text-[#98A89F]">
                Inferior
              </label>
              <input
                id="cracha-bottom-text"
                type="text"
                value={config.bottomText}
                onChange={(e) =>
                  updateCurrentConfig((prev) => ({ ...prev, bottomText: e.target.value }))
                }
                placeholder={
                  activeMode === 'identificacao' ? 'PERMISSIONÁRIO' : 'MILITAR ATIVA'
                }
                className="w-full min-h-[40px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <label htmlFor="cracha-uppercase" className="text-xs text-[#C6D4CC] cursor-pointer">
              Sempre maiúsculas
            </label>
            <input
              id="cracha-uppercase"
              type="checkbox"
              checked={config.uppercase}
              onChange={(e) =>
                updateCurrentConfig((prev) => ({ ...prev, uppercase: e.target.checked }))
              }
              className="h-4 w-4 accent-[#2D5A43] rounded cursor-pointer"
            />
          </div>
        </div>

        {/* Crachás */}
        <div className="space-y-3 pt-3 border-t border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#C6D4CC]">
              Crachás ({config.perPage})
            </span>
            <div className="flex items-center gap-2">
              {activeMode === 'rp' && config.perPage > 1 && (
                <button
                  type="button"
                  onClick={handleSequenceRpNumbers}
                  className="inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A3D4B9] transition-colors"
                >
                  <ListOrdered className="w-3.5 h-3.5" />
                  <span>Sequenciar</span>
                </button>
              )}
              {config.perPage > 1 && (
                <button
                  type="button"
                  onClick={handleCopyFirstToAll}
                  className="inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A3D4B9] transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar 1º</span>
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
            {activeEntries.map((entry, idx) => {
              void fontsTick;
              const diag = getCrachaTextDiagnostics(config, entry);
              return (
              <div
                key={`entry-${idx}`}
                className="rounded-lg bg-[#0E1211] border border-white/10 p-3 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium text-[#83B499]">
                      #{idx + 1}
                    </span>
                    <span
                      className={`font-mono text-[11px] ${
                        diag.adjusted ? 'text-[#E5C17B]' : 'text-[#697870]'
                      }`}
                    >
                      {diag.label}
                    </span>
                  </div>
                  {config.sidedness === 'frente_verso' && (
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-[#98A89F] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={entry.versoIgual}
                        onChange={(e) => handleEntryChange(idx, 'versoIgual', e.target.checked)}
                        className="h-3.5 w-3.5 accent-[#2D5A43] rounded cursor-pointer"
                      />
                      <span>Verso igual</span>
                    </label>
                  )}
                </div>

                {activeMode === 'identificacao' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      aria-label={`Nome completo do crachá ${idx + 1}`}
                      value={entry.nomeCompleto}
                      onChange={(e) => handleEntryChange(idx, 'nomeCompleto', e.target.value)}
                      placeholder="Nome"
                      className="w-full min-h-[38px] rounded-md bg-[#121715] border border-white/12 px-3 text-xs text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095]"
                    />
                    <input
                      type="text"
                      aria-label={`CPF do crachá ${idx + 1}`}
                      value={entry.cpf}
                      onChange={(e) => handleEntryChange(idx, 'cpf', e.target.value)}
                      placeholder="CPF"
                      className="w-full min-h-[38px] rounded-md bg-[#121715] border border-white/12 px-3 font-mono text-xs text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095]"
                    />
                  </div>
                ) : (
                  <textarea
                    rows={2}
                    aria-label={`Texto do crachá RP ${idx + 1}`}
                    value={entry.rpTexto}
                    onChange={(e) => handleEntryChange(idx, 'rpTexto', e.target.value)}
                    placeholder="Número ou texto"
                    className="w-full rounded-md bg-[#121715] border border-white/12 px-3 py-2 text-xs text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095] resize-y"
                  />
                )}

                {config.sidedness === 'frente_verso' && !entry.versoIgual && (
                  <textarea
                    rows={2}
                    aria-label={`Texto do verso do crachá ${idx + 1}`}
                    value={entry.versoTexto}
                    onChange={(e) => handleEntryChange(idx, 'versoTexto', e.target.value)}
                    placeholder="Texto do verso"
                    className="w-full rounded-md bg-[#121715] border border-[#83B499]/30 px-3 py-2 text-xs text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095] resize-y"
                  />
                )}
              </div>
              );
            })}
          </div>
        </div>

        {/* Cores */}
        <div className="space-y-2.5 pt-3 border-t border-white/10">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#C6D4CC]">Cores</span>
            <button
              type="button"
              onClick={handleRestoreColors}
              className="inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A3D4B9] transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Restaurar</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <ColorField
              id="color-top-bg"
              label={activeMode === 'identificacao' ? 'Fundo cima' : 'Fundo superior'}
              value={config.colors.topBg}
              onChange={(v) => updateColor('topBg', v)}
            />
            <ColorField
              id="color-top-text"
              label={activeMode === 'identificacao' ? 'Texto cima' : 'Texto superior'}
              value={config.colors.topText}
              onChange={(v) => updateColor('topText', v)}
            />
            <ColorField
              id="color-divider"
              label="Divisória"
              value={config.colors.divider}
              onChange={(v) => updateColor('divider', v)}
            />
            {activeMode === 'identificacao' && (
              <ColorField
                id="color-center-bg"
                label="Fundo central"
                value={config.colors.centerBg}
                onChange={(v) => updateColor('centerBg', v)}
              />
            )}
            <ColorField
              id="color-center-text"
              label={activeMode === 'identificacao' ? 'Texto central' : 'Texto principal'}
              value={config.colors.centerText}
              onChange={(v) => updateColor('centerText', v)}
            />
            <ColorField
              id="color-bottom-bg"
              label="Fundo baixo"
              value={config.colors.bottomBg}
              onChange={(v) => updateColor('bottomBg', v)}
            />
            <ColorField
              id="color-bottom-text"
              label="Texto baixo"
              value={config.colors.bottomText}
              onChange={(v) => updateColor('bottomText', v)}
            />
          </div>
        </div>

        {/* Export / Print Actions */}
        <div className="pt-3 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <button
            type="button"
            disabled={exporting !== null}
            onClick={handleDownloadPdf}
            className="min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] disabled:opacity-50 px-3 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{exporting === 'pdf' ? 'Gerando...' : 'PDF'}</span>
          </button>

          <button
            type="button"
            disabled={exporting !== null}
            onClick={handleDownloadPng}
            className="min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] disabled:opacity-50 px-3 py-2 text-xs font-medium text-[#E4EAE6] transition-colors whitespace-nowrap"
          >
            <ImageIcon className="w-3.5 h-3.5 text-[#83B499]" />
            <span>{exporting === 'png' ? 'Gerando...' : 'PNG'}</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 py-2 text-xs font-medium text-[#E4EAE6] transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Imprimir</span>
          </button>
        </div>

        {notice && (
          <p className="text-xs text-[#83B499] bg-[#2D5A43]/15 border border-[#83B499]/25 rounded-lg px-3 py-2">
            {notice}
          </p>
        )}
      </section>

      {/* Right Live A4 Sheet Preview (Supports multi-page) */}
      <section className="lg:col-span-7 min-w-0 w-full flex flex-col items-center space-y-4 print-wrapper">
        <div className="no-print w-full flex flex-wrap items-center justify-between gap-2 text-xs text-[#98A89F]">
          <span>
            A4 · {activeMode === 'identificacao' ? 'Identificação' : 'RP'} ·{' '}
            {config.sidedness === 'frente_verso' ? 'Frente e verso' : 'Frente'}
          </span>
          <span className="font-mono">
            {config.widthMm} × {config.heightMm} mm · {layout.pages.length} pág.
          </span>
        </div>

        <div className="w-full min-w-0 flex flex-col items-center gap-5 print-wrapper">
          {layout.pages.map((pageUnits, pageIndex) => (
            <div key={`sheet-${pageIndex}`} className="print-page-item w-full max-w-[620px] space-y-1.5">
              {layout.pages.length > 1 && (
                <div className="no-print flex items-center justify-between text-[11px] text-[#98A89F] px-0.5">
                  <span className="font-mono">Pág. {pageIndex + 1}/{layout.pages.length}</span>
                  <span>{pageUnits.length} {pageUnits.length === 1 ? 'crachá' : 'crachás'}</span>
                </div>
              )}
              <PinchZoomSheetFrame
                maxWidthClass="max-w-[620px]"
                className="rounded-lg border border-white/15 shadow-2xl bg-white"
              >
                <div className="w-full bg-white print-wrapper">
                  <CrachaSheetSvg config={config} pageUnits={pageUnits} pageIndex={pageIndex} />
                </div>
              </PinchZoomSheetFrame>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  Image as ImageIcon,
  ListOrdered,
  Printer,
  RotateCcw,
  Upload,
  X,
} from 'lucide-react';
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
} from './crachaPdf';
import {
  buildInitialMultiMapping,
  composePrefixedText,
  EMPTY_SLOT_REF,
  extractCrachaDocumentData,
  reconcileMultiMapping,
  resolveMultiDocumentRows,
  type CrachaCrossLinkMode,
  type CrachaMultiMapping,
  type CrachaSlotRef,
  type ImportedCrachaSource,
} from './crachaDocumentParser';
import { AnimatePresence, motion } from 'motion/react';
import { getSecureVaultItem, setSecureVaultItem } from '../../core/privacy/privacyVault';
import { PinchZoomSheetFrame } from '../../shared/PinchZoomSheetFrame';
import { WorkspaceSplitLayout } from '../../shared/WorkspaceSplitLayout';
import { fadeSlideVariants, UI_TRANSITION } from '../../shared/motion';
import { SiscomAlert, SiscomSegmentedTabs, SiscomSpinner } from '../../shared/ui';

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
      ? Math.max(1, Math.min(200, Math.floor(obj.perPage)))
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
      topTextOverride: typeof e?.topTextOverride === 'string' ? e.topTextOverride : '',
      bottomTextOverride: typeof e?.bottomTextOverride === 'string' ? e.bottomTextOverride : '',
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
    const raw = getSecureVaultItem(STORAGE_KEY);
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
  const topText = fmt(entry.topTextOverride?.trim() ? entry.topTextOverride : config.topText);
  const bottomText = fmt(
    entry.bottomTextOverride?.trim() ? entry.bottomTextOverride : config.bottomText
  );
  const rpHeaderText = fmt(
    entry.topTextOverride?.trim() ? entry.topTextOverride : config.rpHeaderText
  );

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
    className="siscom-liquid-subcard flex items-center justify-between gap-2.5 min-h-[46px] rounded-lg px-3 py-2 cursor-pointer hover:border-white/[0.22] transition-colors duration-150"
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

interface SlotSourcePickerProps {
  label: string;
  emptyLabel: string;
  slot: CrachaSlotRef;
  sources: ImportedCrachaSource[];
  onChange: (next: CrachaSlotRef) => void;
}

const SlotSourcePicker: React.FC<SlotSourcePickerProps> = ({
  label,
  emptyLabel,
  slot,
  sources,
  onChange,
}) => {
  const activeSource = sources.find((s) => s.id === slot.docId) || sources[0] || null;
  const multiFile = sources.length > 1;
  const isEmpty = !slot.docId || !slot.colId;
  const selectedCol =
    !isEmpty && activeSource
      ? activeSource.columns.find((c) => c.id === slot.colId) || null
      : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="block text-[11px] font-medium text-[#C6D4CC]">{label}</span>
        {selectedCol && selectedCol.detectedRole !== 'outro' && (
          <span className="text-[10px] font-medium text-[#E5C17B]/90">
            {selectedCol.detectedRoleLabel}
          </span>
        )}
      </div>
      <div className={multiFile ? 'grid grid-cols-1 sm:grid-cols-12 gap-1.5' : ''}>
        {multiFile && (
          <select
            aria-label={`Arquivo para ${label}`}
            value={isEmpty ? '' : slot.docId}
            onChange={(e) => {
              const nextDocId = e.target.value;
              if (!nextDocId) {
                onChange(EMPTY_SLOT_REF);
                return;
              }
              const targetSrc = sources.find((s) => s.id === nextDocId);
              const firstCol = targetSrc?.columns[0]?.id || '';
              onChange({ docId: nextDocId, colId: firstCol });
            }}
            className="siscom-input sm:col-span-5 min-h-[38px] px-2.5 text-[11px] text-[#E5C17B]"
          >
            <option value="">{emptyLabel}</option>
            {sources.map((src, idx) => (
              <option key={src.id} value={src.id}>
                Arq. {idx + 1}: {src.fileName}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label={`Campo para ${label}`}
          value={isEmpty ? '' : slot.colId}
          disabled={multiFile && isEmpty}
          onChange={(e) => {
            const nextColId = e.target.value;
            if (!nextColId || !activeSource) {
              onChange(EMPTY_SLOT_REF);
              return;
            }
            onChange({ docId: activeSource.id, colId: nextColId });
          }}
          className={`siscom-input ${
            multiFile ? 'sm:col-span-7' : 'w-full'
          } min-h-[38px] px-2.5 text-xs disabled:opacity-45`}
        >
          <option value="">{emptyLabel}</option>
          {activeSource?.columns.map((col) => {
            const roleTag =
              col.detectedRole !== 'outro' ? ` [${col.detectedRoleLabel}]` : '';
            const sampleTag = col.sample
              ? ` — ex: ${col.sample.slice(0, 30)}${col.sample.length > 30 ? '…' : ''}`
              : '';
            return (
              <option key={col.id} value={col.id}>
                {col.label}
                {roleTag}
                {sampleTag}
              </option>
            );
          })}
        </select>
      </div>

      {selectedCol && (
        <div className="flex items-baseline gap-1.5 px-1 text-[11px] leading-snug">
          <span className="text-[#83B499] shrink-0">Exemplo:</span>
          <span className="font-mono text-[#E8EEEA] truncate" title={selectedCol.sample}>
            {selectedCol.sample || '(vazio na 1ª linha)'}
          </span>
        </div>
      )}
    </div>
  );
};

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

  const [importedDocs, setImportedDocs] = useState<ImportedCrachaSource[]>([]);
  const [fieldMapping, setFieldMapping] = useState<CrachaMultiMapping | null>(null);
  const [crossLinkMode, setCrossLinkMode] = useState<CrachaCrossLinkMode>('auto');
  const [crossLinkSummary, setCrossLinkSummary] = useState<string | null>(null);
  const [isImportingDoc, setIsImportingDoc] = useState(false);
  const [isDraggingDoc, setIsDraggingDoc] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const crachasStripRef = useRef<HTMLDivElement>(null);

  const config = configs[activeMode];
  const [perPageDraft, setPerPageDraft] = useState<string>(() => String(config.perPage));

  useEffect(() => {
    setPerPageDraft(String(config.perPage));
  }, [config.perPage]);

  useEffect(() => {
    try {
      setSecureVaultItem(STORAGE_KEY, JSON.stringify({ activeMode, configs }));
    } catch {
      // Ignore storage quota errors cleanly
    }
  }, [activeMode, configs]);

  useEffect(() => {
    const handlePurged = () => {
      setActiveMode('identificacao');
      setConfigs({
        identificacao: createDefaultConfig('identificacao'),
        rp: createDefaultConfig('rp'),
      });
      setImportedDocs([]);
      setFieldMapping(null);
      setCrossLinkSummary(null);
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

  const updateCurrentConfig = (updater: (prev: CrachaConfig) => CrachaConfig) => {
    setConfigs((prev) => ({
      ...prev,
      [activeMode]: updater(prev[activeMode]),
    }));
  };

  const applyMultiMappingToMode = (
    sources: ImportedCrachaSource[],
    map: CrachaMultiMapping,
    targetMode: CrachaMode,
    linkMode: CrachaCrossLinkMode
  ) => {
    if (sources.length === 0) return;
    const resolved = resolveMultiDocumentRows(sources, map, targetMode, linkMode);
    if (resolved.rows.length === 0) return;

    setConfigs((prev) => {
      const curr = prev[targetMode];
      const nextEntries: CrachaEntry[] = resolved.rows.map((row) => ({
        nomeCompleto: row.nomeCompleto,
        cpf: row.cpf,
        rpTexto: row.rpTexto,
        topTextOverride: row.topTextOverride,
        bottomTextOverride: row.bottomTextOverride,
        versoIgual: row.versoIgual,
        versoTexto: row.versoTexto,
      }));

      return {
        ...prev,
        [targetMode]: {
          ...curr,
          perPage: nextEntries.length,
          entries: nextEntries,
        },
      };
    });

    if (resolved.hasCrossFileMapping) {
      if (resolved.linkedByNameCount > 0 && linkMode !== 'index') {
        setCrossLinkSummary(
          `${resolved.linkedByNameCount}/${resolved.rows.length} vinculados por nome entre os arquivos`
        );
      } else {
        setCrossLinkSummary('Arquivos combinados por ordem de linha');
      }
    } else {
      setCrossLinkSummary(null);
    }
  };

  const handleUploadDocuments = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setImportError(null);
    setNotice(null);
    setIsImportingDoc(true);
    try {
      const newlyExtracted: ImportedCrachaSource[] = [];
      for (const file of files) {
        const extracted = await extractCrachaDocumentData(file);
        newlyExtracted.push({
          ...extracted,
          id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        });
      }
      const nextSources = [...importedDocs, ...newlyExtracted];
      const nextMap = reconcileMultiMapping(fieldMapping, nextSources);
      setImportedDocs(nextSources);
      setFieldMapping(nextMap);
      applyMultiMappingToMode(nextSources, nextMap, 'identificacao', crossLinkMode);
      applyMultiMappingToMode(nextSources, nextMap, 'rp', crossLinkMode);

      const addedRows = newlyExtracted.reduce((sum, d) => sum + d.rows.length, 0);
      setNotice(
        newlyExtracted.length === 1
          ? `${newlyExtracted[0].rows.length} ${
              newlyExtracted[0].rows.length === 1 ? 'registro extraído' : 'registros extraídos'
            } de "${newlyExtracted[0].fileName}".`
          : `${newlyExtracted.length} arquivos importados (${addedRows} registros).`
      );
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Não foi possível extrair os dados do documento.'
      );
    } finally {
      setIsImportingDoc(false);
    }
  };

  const handleRemoveImportedDoc = (docId: string) => {
    const nextSources = importedDocs.filter((d) => d.id !== docId);
    setImportedDocs(nextSources);
    if (nextSources.length === 0) {
      setFieldMapping(null);
      setCrossLinkSummary(null);
      return;
    }
    const nextMap = buildInitialMultiMapping(nextSources);
    setFieldMapping(nextMap);
    applyMultiMappingToMode(nextSources, nextMap, activeMode, crossLinkMode);
  };

  const handleMappingSlotChange = (
    key: keyof CrachaMultiMapping,
    nextSlot: CrachaSlotRef
  ) => {
    if (importedDocs.length === 0 || !fieldMapping) return;
    const nextMap: CrachaMultiMapping = {
      ...fieldMapping,
      [key]: nextSlot,
    };
    setFieldMapping(nextMap);
    applyMultiMappingToMode(importedDocs, nextMap, activeMode, crossLinkMode);
  };

  const handleCrossLinkModeChange = (nextMode: CrachaCrossLinkMode) => {
    setCrossLinkMode(nextMode);
    if (importedDocs.length > 0 && fieldMapping) {
      applyMultiMappingToMode(importedDocs, fieldMapping, activeMode, nextMode);
    }
  };

  const handlePerPageChange = (nextCountRaw: number) => {
    const nextCount = Math.max(1, Math.min(200, Math.floor(nextCountRaw || 1)));
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
    <WorkspaceSplitLayout
      sidebarWidthClass="lg:w-[400px] xl:w-[430px]"
      sidebar={
        <div className="metal-surface lg:bg-transparent lg:border-0 lg:shadow-none rounded-xl lg:rounded-none p-4 sm:p-5 lg:p-1 space-y-5">
        {/* Top Primary Document Upload & Field Mapping */}
        <div className="space-y-3 pb-4 border-b border-white/[0.07]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#E5C17B]">
              Importar arquivos
            </span>
            <span className="text-[11px] text-[#98A89F]">
              Sem limite de tamanho
            </span>
          </div>

          <input
            ref={docInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = '';
              if (files.length > 0) void handleUploadDocuments(files);
            }}
          />

          <button
            type="button"
            disabled={isImportingDoc}
            onClick={() => docInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              if (!isDraggingDoc) setIsDraggingDoc(true);
            }}
            onDragLeave={() => setIsDraggingDoc(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingDoc(false);
              const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
              if (files.length > 0) void handleUploadDocuments(files);
            }}
            className={`w-full rounded-xl border border-dashed px-4 py-4 flex flex-col items-center justify-center gap-1.5 text-center transition-all duration-180 active:scale-[0.99] disabled:opacity-60 cursor-pointer ${
              isDraggingDoc
                ? 'border-[#E5C17B] bg-[#222B1F]/70 backdrop-blur-md'
                : 'border-[#C8A461]/50 bg-[#121B15]/52 hover:bg-[#1A261E]/64 backdrop-blur-md hover:border-[#C8A461]/75'
            }`}
          >
            {isImportingDoc ? (
              <SiscomSpinner tone="gold" className="w-5 h-5" />
            ) : (
              <Upload className="w-5 h-5 text-[#E5C17B] shrink-0" />
            )}
            <span className="text-xs font-semibold text-[#F4E6C4]">
              {isImportingDoc
                ? 'Extraindo dados do(s) arquivo(s)...'
                : importedDocs.length > 0
                  ? 'Adicionar outro arquivo (PDF, Word, Excel, foto...)'
                  : 'Subir arquivo(s) para preencher crachás'}
            </span>
            <span className="text-[11px] text-[#98A89F]">
              PDF, Word (.docx/.doc/.odt), Excel, CSV, TXT ou foto — leitura fiel das colunas com montagem flexível
            </span>
          </button>

          <AnimatePresence>
            {importError && (
              <SiscomAlert tone="error" onDismiss={() => setImportError(null)}>
                {importError}
              </SiscomAlert>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {importedDocs.length > 0 && fieldMapping && (
              <motion.div
                key="cracha-mapping"
                variants={fadeSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={UI_TRANSITION}
                className="siscom-liquid-subcard rounded-xl !border-[#C8A461]/30 p-3.5 space-y-3"
              >
                {/* Uploaded files list */}
                <div className="space-y-2 border-b border-white/[0.07] pb-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-[#E5C17B]">
                      {importedDocs.length === 1
                        ? 'Arquivo carregado'
                        : `${importedDocs.length} arquivos carregados`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setImportedDocs([]);
                        setFieldMapping(null);
                        setCrossLinkSummary(null);
                        setImportError(null);
                      }}
                      className="min-h-[30px] px-2 -mr-2 rounded text-[11px] text-[#98A89F] hover:text-white hover:bg-white/[0.04] transition-colors"
                    >
                      Limpar tudo
                    </button>
                  </div>

                  <div className="space-y-2">
                    {importedDocs.map((src, idx) => (
                      <div
                        key={src.id}
                        className="rounded-lg bg-white/[0.04] border border-white/[0.10] px-2.5 py-2 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileSpreadsheet className="w-3.5 h-3.5 text-[#E5C17B] shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-[#E8EEEA] truncate">
                                {importedDocs.length > 1 ? `Arq. ${idx + 1}: ` : ''}
                                {src.fileName}
                              </p>
                              <p className="text-[10px] text-[#83B499]">
                                {src.rows.length}{' '}
                                {src.rows.length === 1 ? 'registro' : 'registros'} ·{' '}
                                {src.columns.length}{' '}
                                {src.columns.length === 1 ? 'coluna' : 'colunas'} ·{' '}
                                {src.hasExplicitHeader
                                  ? 'Cabeçalho real da 1ª linha'
                                  : 'Sem cabeçalho (colunas genéricas)'}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveImportedDoc(src.id)}
                            title={`Remover ${src.fileName}`}
                            aria-label={`Remover ${src.fileName}`}
                            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-red-300 hover:bg-white/[0.06] transition-colors shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Mandatory preview of every extracted column + row-below example */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1.5 border-t border-white/[0.06]">
                          {src.columns.map((col) => (
                            <div
                              key={col.id}
                              className="rounded-md bg-[#080E0B]/55 border border-white/[0.08] px-2 py-1.5 min-w-0"
                            >
                              <div className="flex items-center justify-between gap-1.5 min-w-0">
                                <span
                                  className="text-[11px] font-semibold text-[#E8EEEA] truncate"
                                  title={col.label}
                                >
                                  {col.label}
                                </span>
                                {col.detectedRole !== 'outro' && (
                                  <span className="text-[9px] font-medium text-[#E5C17B] shrink-0">
                                    {col.detectedRoleLabel}
                                  </span>
                                )}
                              </div>
                              <p
                                className="text-[10px] font-mono text-[#98A89F] truncate mt-0.5"
                                title={col.sample || '(vazio)'}
                              >
                                ex: {col.sample || '(vazio)'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {importedDocs.length > 1 && (
                    <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                      <label
                        htmlFor="cracha-cross-link-mode"
                        className="text-[11px] text-[#98A89F]"
                      >
                        Cruzar arquivos por:
                      </label>
                      <select
                        id="cracha-cross-link-mode"
                        value={crossLinkMode}
                        onChange={(e) =>
                          handleCrossLinkModeChange(e.target.value as CrachaCrossLinkMode)
                        }
                        className="siscom-input min-h-[34px] px-2.5 text-[11px]"
                      >
                        <option value="auto">Automático (Nome ou ordem)</option>
                        <option value="name">Nome do militar</option>
                        <option value="index">Ordem das linhas</option>
                      </select>
                    </div>
                  )}

                  {crossLinkSummary && (
                    <p className="text-[10px] text-[#83B499]">{crossLinkSummary}</p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-[#E5C17B]">
                    Mapeamento dos campos do crachá:
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      applyMultiMappingToMode(
                        importedDocs,
                        fieldMapping,
                        activeMode,
                        crossLinkMode
                      )
                    }
                    className="min-h-[30px] px-2 -mr-2 rounded text-[11px] text-[#83B499] hover:text-[#A8D8BE] hover:bg-white/[0.04] whitespace-nowrap transition-colors"
                  >
                    Reaplicar
                  </button>
                </div>

                {activeMode === 'identificacao' ? (
                  <div className="space-y-3">
                    {/* Flexible Prefix + Main Name Assembly */}
                    <div className="rounded-lg bg-[#0E1813]/52 backdrop-blur-md border border-[#C8A461]/24 p-2.5 space-y-2.5">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#E5C17B]">
                        Montagem do Nome (Prefixo + Principal)
                      </span>

                      <SlotSourcePicker
                        label="Prefixo (opcional — ex: Posto/Grad)"
                        emptyLabel="(Sem prefixo)"
                        slot={fieldMapping.identPrefixo}
                        sources={importedDocs}
                        onChange={(next) => handleMappingSlotChange('identPrefixo', next)}
                      />

                      <SlotSourcePicker
                        label="Nome Principal (ex: Nome de Guerra ou Nome)"
                        emptyLabel="(Deixar em branco)"
                        slot={fieldMapping.identPrincipal}
                        sources={importedDocs}
                        onChange={(next) => handleMappingSlotChange('identPrincipal', next)}
                      />

                      {(() => {
                        const prefSrc = importedDocs.find(
                          (d) => d.id === fieldMapping.identPrefixo.docId
                        );
                        const mainSrc = importedDocs.find(
                          (d) => d.id === fieldMapping.identPrincipal.docId
                        );
                        const prefSample =
                          prefSrc?.columns.find(
                            (c) => c.id === fieldMapping.identPrefixo.colId
                          )?.sample || '';
                        const mainSample =
                          mainSrc?.columns.find(
                            (c) => c.id === fieldMapping.identPrincipal.colId
                          )?.sample || '';
                        const composed = composePrefixedText(prefSample, mainSample);
                        const displayPreview = config.uppercase
                          ? composed.toUpperCase()
                          : composed;
                        return (
                          <div className="rounded-md bg-[#080E0B]/55 border border-white/[0.08] px-2.5 py-1.5 flex items-baseline justify-between gap-2">
                            <span className="text-[10px] text-[#83B499] shrink-0">
                              Prévia (1º crachá):
                            </span>
                            <span className="font-mono text-xs font-semibold text-[#F4E6C4] truncate">
                              {displayPreview || '—'}
                            </span>
                          </div>
                        );
                      })()}
                    </div>

                    <SlotSourcePicker
                      label="Documento (CPF / Identidade)"
                      emptyLabel="(Deixar em branco — sem documento)"
                      slot={fieldMapping.identSecundario}
                      sources={importedDocs}
                      onChange={(next) => handleMappingSlotChange('identSecundario', next)}
                    />

                    <div className="grid grid-cols-1 gap-2">
                      <SlotSourcePicker
                        label="Faixa superior"
                        emptyLabel={`Padrão (${config.topText || 'Superior'})`}
                        slot={fieldMapping.identTop}
                        sources={importedDocs}
                        onChange={(next) => handleMappingSlotChange('identTop', next)}
                      />

                      <SlotSourcePicker
                        label="Faixa inferior"
                        emptyLabel={`Padrão (${config.bottomText || 'Inferior'})`}
                        slot={fieldMapping.identBottom}
                        sources={importedDocs}
                        onChange={(next) => handleMappingSlotChange('identBottom', next)}
                      />
                    </div>

                    {config.sidedness === 'frente_verso' && (
                      <SlotSourcePicker
                        label="Verso do crachá"
                        emptyLabel="Igual à frente"
                        slot={fieldMapping.identBack}
                        sources={importedDocs}
                        onChange={(next) => handleMappingSlotChange('identBack', next)}
                      />
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Flexible Prefix + Main Text Assembly (RP) */}
                    <div className="rounded-lg bg-[#0E1813]/52 backdrop-blur-md border border-[#C8A461]/24 p-2.5 space-y-2.5">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#E5C17B]">
                        Montagem do Texto Central (Prefixo + Principal)
                      </span>

                      <SlotSourcePicker
                        label="Prefixo (opcional — ex: Posto/Grad)"
                        emptyLabel="(Sem prefixo)"
                        slot={fieldMapping.rpPrefixo}
                        sources={importedDocs}
                        onChange={(next) => handleMappingSlotChange('rpPrefixo', next)}
                      />

                      <SlotSourcePicker
                        label="Texto Principal do centro (RP)"
                        emptyLabel="(Deixar em branco)"
                        slot={fieldMapping.rpPrincipal}
                        sources={importedDocs}
                        onChange={(next) => handleMappingSlotChange('rpPrincipal', next)}
                      />

                      {(() => {
                        const prefSrc = importedDocs.find(
                          (d) => d.id === fieldMapping.rpPrefixo.docId
                        );
                        const mainSrc = importedDocs.find(
                          (d) => d.id === fieldMapping.rpPrincipal.docId
                        );
                        const prefSample =
                          prefSrc?.columns.find(
                            (c) => c.id === fieldMapping.rpPrefixo.colId
                          )?.sample || '';
                        const mainSample =
                          mainSrc?.columns.find(
                            (c) => c.id === fieldMapping.rpPrincipal.colId
                          )?.sample || '';
                        const composed = composePrefixedText(prefSample, mainSample);
                        const displayPreview = config.uppercase
                          ? composed.toUpperCase()
                          : composed;
                        return (
                          <div className="rounded-md bg-[#080E0B]/55 border border-white/[0.08] px-2.5 py-1.5 flex items-baseline justify-between gap-2">
                            <span className="text-[10px] text-[#83B499] shrink-0">
                              Prévia (1º crachá):
                            </span>
                            <span className="font-mono text-xs font-semibold text-[#F4E6C4] truncate">
                              {displayPreview || '—'}
                            </span>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      <SlotSourcePicker
                        label="Superior (opcional)"
                        emptyLabel="Padrão"
                        slot={fieldMapping.rpTop}
                        sources={importedDocs}
                        onChange={(next) => handleMappingSlotChange('rpTop', next)}
                      />

                      <SlotSourcePicker
                        label="Faixa inferior"
                        emptyLabel={`Padrão (${config.bottomText || 'Inferior'})`}
                        slot={fieldMapping.rpBottom}
                        sources={importedDocs}
                        onChange={(next) => handleMappingSlotChange('rpBottom', next)}
                      />
                    </div>

                    {config.sidedness === 'frente_verso' && (
                      <SlotSourcePicker
                        label="Verso do crachá"
                        emptyLabel="Igual à frente"
                        slot={fieldMapping.rpBack}
                        sources={importedDocs}
                        onChange={(next) => handleMappingSlotChange('rpBack', next)}
                      />
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mode Switcher: Identificação | RP */}
        <div className="space-y-2">
          <span className="siscom-field-label block">Modelo</span>
          <SiscomSegmentedTabs
            layoutId="cracha-mode-tabs"
            ariaLabel="Modelo de crachá"
            options={[
              { value: 'identificacao', label: 'Identificação' },
              { value: 'rp', label: 'RP' },
            ]}
            value={activeMode}
            onChange={(val) => {
              setActiveMode(val as CrachaMode);
              setNotice(null);
            }}
          />
        </div>

        {/* Quantidade */}
        <div className="space-y-2.5 pt-4 border-t border-white/[0.07]">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="cracha-per-page" className="siscom-field-label">
              Quantidade
            </label>
            <span className="font-mono text-[11px] text-[#83B499]">
              {layout.pages.length} A4
            </span>
          </div>

          <input
            id="cracha-per-page"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            value={perPageDraft}
            onChange={(e) => {
              const raw = e.target.value;
              setPerPageDraft(raw);
              if (raw.trim() === '') return;
              const parsed = Math.floor(Number(raw));
              if (Number.isFinite(parsed) && parsed >= 1) {
                handlePerPageChange(parsed);
              }
            }}
            onBlur={() => {
              const parsed = Math.floor(Number(perPageDraft));
              const clamped = Number.isFinite(parsed)
                ? Math.max(1, Math.min(200, parsed))
                : config.perPage;
              handlePerPageChange(clamped);
              setPerPageDraft(String(clamped));
            }}
            placeholder="Digite a quantidade (1 a 200)"
            className="siscom-input w-full min-h-[40px] px-3 font-mono text-sm"
          />
        </div>

        {/* Tamanho */}
        <div className="space-y-2.5 pt-4 border-t border-white/[0.07]">
          <div className="flex items-center justify-between gap-2">
            <span className="siscom-field-label">
              Tamanho (mm)
            </span>
            <button
              type="button"
              onClick={() =>
                updateCurrentConfig((prev) => ({ ...prev, widthMm: 95, heightMm: 70 }))
              }
              className="min-h-[30px] px-2 -mr-2 rounded text-[11px] text-[#83B499] hover:text-[#A8D8BE] hover:bg-white/[0.04] transition-colors"
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
                className="siscom-input w-full min-h-[40px] px-3 font-mono text-sm"
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
                className="siscom-input w-full min-h-[40px] px-3 font-mono text-sm"
              />
            </div>
          </div>

          <AnimatePresence>
            {layout.oversizedWarning && (
              <SiscomAlert tone="warning" className="text-[11px]">
                {layout.oversizedWarning}
              </SiscomAlert>
            )}
          </AnimatePresence>
        </div>

        {/* Lados */}
        <div className="space-y-2 pt-4 border-t border-white/[0.07]">
          <span className="siscom-field-label block">Lados</span>
          <SiscomSegmentedTabs
            layoutId="cracha-sidedness-tabs"
            ariaLabel="Impressão frente ou frente e verso"
            size="sm"
            options={[
              { value: 'frente', label: 'Só frente' },
              { value: 'frente_verso', label: 'Frente e verso' },
            ]}
            value={config.sidedness}
            onChange={(val) =>
              updateCurrentConfig((prev) => ({ ...prev, sidedness: val as CrachaSidedness }))
            }
          />
        </div>

        {/* Faixas */}
        <div className="space-y-3 pt-4 border-t border-white/[0.07]">
          <span className="siscom-field-label block">
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
                  className="siscom-input w-full min-h-[40px] px-3 text-sm"
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
                  className="siscom-input w-full min-h-[40px] px-3 text-sm"
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
                className="siscom-input w-full min-h-[40px] px-3 text-sm"
              />
            </div>
          </div>

          <label
            htmlFor="cracha-uppercase"
            className="siscom-liquid-subcard flex items-center justify-between gap-3 min-h-[42px] px-3 rounded-lg cursor-pointer select-none hover:border-white/[0.2] transition-colors"
          >
            <span className="text-xs text-[#C6D4CC]">Sempre maiúsculas</span>
            <input
              id="cracha-uppercase"
              type="checkbox"
              checked={config.uppercase}
              onChange={(e) =>
                updateCurrentConfig((prev) => ({ ...prev, uppercase: e.target.checked }))
              }
              className="h-4 w-4 accent-[#2D5A43] rounded cursor-pointer"
            />
          </label>
        </div>

        {/* Crachás */}
        <div className="space-y-3 pt-4 border-t border-white/[0.07]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="siscom-field-label">
              Crachás ({config.perPage})
            </span>
            <div className="flex items-center gap-1.5">
              {activeMode === 'rp' && config.perPage > 1 && (
                <button
                  type="button"
                  onClick={handleSequenceRpNumbers}
                  className="min-h-[30px] px-2 rounded inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A8D8BE] hover:bg-white/[0.04] transition-colors"
                >
                  <ListOrdered className="w-3.5 h-3.5" />
                  <span>Sequenciar</span>
                </button>
              )}
              {config.perPage > 1 && (
                <button
                  type="button"
                  onClick={handleCopyFirstToAll}
                  className="min-h-[30px] px-2 rounded inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A8D8BE] hover:bg-white/[0.04] transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar 1º</span>
                </button>
              )}
              {config.perPage > 1 && (
                <div className="inline-flex items-center gap-0.5 pl-1 border-l border-white/[0.08]">
                  <button
                    type="button"
                    aria-label="Rolar crachás para a esquerda"
                    onClick={() =>
                      crachasStripRef.current?.scrollBy({ left: -292, behavior: 'smooth' })
                    }
                    className="h-7 w-7 inline-flex items-center justify-center rounded text-[#98A89F] hover:text-[#E8EEEA] hover:bg-white/[0.06] transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Rolar crachás para a direita"
                    onClick={() =>
                      crachasStripRef.current?.scrollBy({ left: 292, behavior: 'smooth' })
                    }
                    className="h-7 w-7 inline-flex items-center justify-center rounded text-[#98A89F] hover:text-[#E8EEEA] hover:bg-white/[0.06] transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div
            ref={crachasStripRef}
            className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scroll-smooth"
          >
            {activeEntries.map((entry, idx) => {
              void fontsTick;
              const diag = getCrachaTextDiagnostics(config, entry);
              return (
              <div
                key={`entry-${idx}`}
                className="siscom-liquid-subcard w-[268px] sm:w-[290px] shrink-0 snap-start rounded-lg p-3 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium text-[#83B499]">
                      #{idx + 1}
                    </span>
                    <span
                      className={`font-mono text-[11px] ${
                        diag.adjusted ? 'text-[#E5C17B]' : 'text-[#6E7E75]'
                      }`}
                    >
                      {diag.label}
                    </span>
                  </div>
                  {config.sidedness === 'frente_verso' && (
                    <label className="inline-flex items-center gap-1.5 min-h-[28px] text-[11px] text-[#98A89F] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={entry.versoIgual}
                        onChange={(e) => handleEntryChange(idx, 'versoIgual', e.target.checked)}
                        className="h-4 w-4 accent-[#2D5A43] rounded cursor-pointer"
                      />
                      <span>Verso igual</span>
                    </label>
                  )}
                </div>

                {activeMode === 'identificacao' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      aria-label={`Texto principal do crachá ${idx + 1}`}
                      value={entry.nomeCompleto}
                      onChange={(e) => handleEntryChange(idx, 'nomeCompleto', e.target.value)}
                      placeholder="Nome / Principal"
                      className="siscom-input w-full min-h-[38px] px-3 text-xs"
                    />
                    <input
                      type="text"
                      aria-label={`Identidade ou CPF do crachá ${idx + 1}`}
                      value={entry.cpf}
                      onChange={(e) => handleEntryChange(idx, 'cpf', e.target.value)}
                      placeholder="Identidade / CPF"
                      className="siscom-input w-full min-h-[38px] px-3 font-mono text-xs"
                    />
                  </div>
                ) : (
                  <textarea
                    rows={2}
                    aria-label={`Texto do crachá RP ${idx + 1}`}
                    value={entry.rpTexto}
                    onChange={(e) => handleEntryChange(idx, 'rpTexto', e.target.value)}
                    placeholder="Número ou texto"
                    className="siscom-input w-full px-3 py-2 text-xs resize-y"
                  />
                )}

                {config.sidedness === 'frente_verso' && !entry.versoIgual && (
                  <textarea
                    rows={2}
                    aria-label={`Texto do verso do crachá ${idx + 1}`}
                    value={entry.versoTexto}
                    onChange={(e) => handleEntryChange(idx, 'versoTexto', e.target.value)}
                    placeholder="Texto do verso"
                    className="siscom-input w-full border-[#83B499]/30 px-3 py-2 text-xs resize-y"
                  />
                )}
              </div>
              );
            })}
          </div>
        </div>

        {/* Cores */}
        <div className="space-y-2.5 pt-4 border-t border-white/[0.07]">
          <div className="flex items-center justify-between gap-2">
            <span className="siscom-field-label">Cores</span>
            <button
              type="button"
              onClick={handleRestoreColors}
              className="min-h-[30px] px-2 -mr-2 rounded inline-flex items-center gap-1 text-[11px] text-[#83B499] hover:text-[#A8D8BE] hover:bg-white/[0.04] transition-colors"
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
        <div className="pt-4 border-t border-white/[0.07] grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <button
            type="button"
            disabled={exporting !== null}
            onClick={handleDownloadPdf}
            className="siscom-btn siscom-btn-primary min-h-[42px] px-3 text-xs whitespace-nowrap"
          >
            {exporting === 'pdf' ? (
              <SiscomSpinner tone="light" className="w-3.5 h-3.5" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{exporting === 'pdf' ? 'Gerando...' : 'PDF'}</span>
          </button>

          <button
            type="button"
            disabled={exporting !== null}
            onClick={handleDownloadPng}
            className="siscom-btn siscom-btn-secondary min-h-[42px] px-3 text-xs whitespace-nowrap"
          >
            {exporting === 'png' ? (
              <SiscomSpinner tone="olive" className="w-3.5 h-3.5" />
            ) : (
              <ImageIcon className="w-3.5 h-3.5 text-[#83B499]" />
            )}
            <span>{exporting === 'png' ? 'Gerando...' : 'PNG'}</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="siscom-btn siscom-btn-secondary min-h-[42px] px-3 text-xs whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Imprimir</span>
          </button>
        </div>

        <AnimatePresence>
          {notice && (
            <SiscomAlert
              tone={notice.toLowerCase().includes('erro') ? 'error' : 'success'}
              onDismiss={() => setNotice(null)}
            >
              {notice}
            </SiscomAlert>
          )}
        </AnimatePresence>
        </div>
      }
      bottomBar={
        <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-[#98A89F]">
          <span>
            A4 · {activeMode === 'identificacao' ? 'Identificação' : 'RP'} ·{' '}
            {config.sidedness === 'frente_verso' ? 'Frente e verso' : 'Frente'}
          </span>
          <span className="font-mono text-[#E5C17B]">
            {config.widthMm} × {config.heightMm} mm · {layout.pages.length} pág.
          </span>
        </div>
      }
    >
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
    </WorkspaceSplitLayout>
  );
};

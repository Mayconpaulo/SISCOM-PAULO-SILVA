import React, { useEffect, useMemo, useState } from 'react';
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
  TEXT_SAFE_WIDTH_MM,
  type PrismaData,
} from '../lib/prismaPdf';

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
    const raw = localStorage.getItem(STORAGE_KEY);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ count, prismas, uppercase }));
    } catch {
      // Ignore storage quota issues cleanly
    }
  }, [count, prismas, uppercase]);

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
      setNotice('PDF A4 gerado com os prismas centralizados.');
    } catch {
      setNotice('Não foi possível gerar o arquivo PDF. Use Imprimir A4 como alternativa imediata.');
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
      setNotice('Imagem A4 em 300 DPI baixada.');
    } catch {
      setNotice('Não foi possível gerar o PNG. Utilize Baixar PDF ou Imprimir A4.');
    } finally {
      setExporting(null);
    }
  };

  const handlePrint = () => {
    setNotice(null);
    window.print();
  };

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start print-wrapper">
      {/* Left Control Column */}
      <section className="no-print lg:col-span-5 metal-surface rounded-xl p-5 sm:p-6 space-y-5">
        <div className="space-y-1 border-b border-white/10 pb-4">
          <h2 className="font-display text-lg font-semibold text-[#E4EAE6]">
            Gerador de Prisma — Folha A4
          </h2>
          <p className="text-xs text-[#98A89F]">
            Formato A4 (210 × 297 mm) com retângulos centralizados e brasões oficiais.
          </p>
        </div>

        {/* 1 or 2 Prismas per Page */}
        <div className="space-y-2">
          <span className="block text-xs font-medium text-[#C6D4CC]">
            Quantidade por página
          </span>
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#0E1211] border border-white/10">
            <button
              type="button"
              onClick={() => setCount(1)}
              className={`min-h-[40px] rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                count === 1
                  ? 'bg-[#2D5A43] text-white'
                  : 'text-[#98A89F] hover:text-[#E4EAE6]'
              }`}
            >
              1 Prisma por página
            </button>
            <button
              type="button"
              onClick={() => setCount(2)}
              className={`min-h-[40px] rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                count === 2
                  ? 'bg-[#2D5A43] text-white'
                  : 'text-[#98A89F] hover:text-[#E4EAE6]'
              }`}
            >
              2 Prismas por página
            </button>
          </div>
        </div>

        {/* Prisma 1 Inputs */}
        <div className="space-y-3 pt-2 border-t border-white/10">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-[#E4EAE6]">
              {count === 1 ? 'Dados do Prisma' : 'Prisma Superior (1)'}
            </span>
            <span className="font-mono text-[#83B499]">
              {sizeDiagnostics[0].adjusted
                ? `Nome ${sizeDiagnostics[0].nomePt}pt · Função ${sizeDiagnostics[0].funcaoPt}pt`
                : `Padrão ${STANDARD_FONT_PT}pt`}
            </span>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="p1-nome" className="block text-xs text-[#98A89F]">
              Nome (sempre em negrito)
            </label>
            <input
              id="p1-nome"
              type="text"
              value={prismas[0].nome}
              onChange={(e) => updatePrisma(0, 'nome', e.target.value)}
              placeholder="Ex.: TEN NETO"
              className="w-full min-h-[42px] rounded-lg bg-[#0E1211] border border-white/12 px-3.5 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="p1-funcao" className="block text-xs text-[#98A89F]">
              Função
            </label>
            <input
              id="p1-funcao"
              type="text"
              value={prismas[0].funcao}
              onChange={(e) => updatePrisma(0, 'funcao', e.target.value)}
              placeholder="Ex.: CHEFE COMSOC"
              className="w-full min-h-[42px] rounded-lg bg-[#0E1211] border border-white/12 px-3.5 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095]"
            />
          </div>
        </div>

        {/* Prisma 2 Inputs */}
        {count === 2 && (
          <div className="space-y-3 pt-4 border-t border-white/10">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-[#E4EAE6]">Prisma Inferior (2)</span>
              <span className="font-mono text-[#83B499]">
                {sizeDiagnostics[1]?.adjusted
                  ? `Nome ${sizeDiagnostics[1].nomePt}pt · Função ${sizeDiagnostics[1].funcaoPt}pt`
                  : `Padrão ${STANDARD_FONT_PT}pt`}
              </span>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="p2-nome" className="block text-xs text-[#98A89F]">
                Nome (sempre em negrito)
              </label>
              <input
                id="p2-nome"
                type="text"
                value={prismas[1].nome}
                onChange={(e) => updatePrisma(1, 'nome', e.target.value)}
                placeholder="Ex.: CEL SANSEVERINO"
                className="w-full min-h-[42px] rounded-lg bg-[#0E1211] border border-white/12 px-3.5 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="p2-funcao" className="block text-xs text-[#98A89F]">
                Função
              </label>
              <input
                id="p2-funcao"
                type="text"
                value={prismas[1].funcao}
                onChange={(e) => updatePrisma(1, 'funcao', e.target.value)}
                placeholder="Ex.: ANTIGO COMANDANTE"
                className="w-full min-h-[42px] rounded-lg bg-[#0E1211] border border-white/12 px-3.5 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#7FB095]"
              />
            </div>
          </div>
        )}

        {/* Uppercase option */}
        <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-3">
          <label htmlFor="uppercase-toggle" className="text-xs text-[#C6D4CC] cursor-pointer">
            Converter texto automaticamente para maiúsculas
          </label>
          <input
            id="uppercase-toggle"
            type="checkbox"
            checked={uppercase}
            onChange={(e) => setUppercase(e.target.checked)}
            className="h-4 w-4 accent-[#2D5A43] rounded cursor-pointer"
          />
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
            <span>{exporting === 'pdf' ? 'Gerando...' : 'Baixar PDF'}</span>
          </button>

          <button
            type="button"
            disabled={exporting !== null}
            onClick={handleDownloadPng}
            className="min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] disabled:opacity-50 px-3 py-2 text-xs font-medium text-[#E4EAE6] transition-colors whitespace-nowrap"
          >
            <ImageIcon className="w-3.5 h-3.5 text-[#83B499]" />
            <span>{exporting === 'png' ? 'Gerando...' : 'Baixar PNG'}</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#222B27] px-3 py-2 text-xs font-medium text-[#E4EAE6] transition-colors whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5 text-[#83B499]" />
            <span>Imprimir A4</span>
          </button>
        </div>

        {notice && (
          <p className="text-xs text-[#83B499] bg-[#2D5A43]/15 border border-[#83B499]/25 rounded-lg px-3 py-2">
            {notice}
          </p>
        )}
      </section>

      {/* Right Live A4 Sheet Preview */}
      <section className="lg:col-span-7 flex flex-col items-center space-y-3 print-wrapper">
        <div className="no-print w-full flex flex-wrap items-center justify-between gap-2 text-xs text-[#98A89F]">
          <span>
            Pré-visualização A4 · {count === 1 ? '1 prisma centralizado' : '2 prismas centralizados'}
          </span>
          <span className="font-mono">
            210 × 297 mm · área livre {TEXT_SAFE_WIDTH_MM.toFixed(1)} mm
          </span>
        </div>

        <div className="print-page-item w-full max-w-[620px] rounded-lg overflow-hidden border border-white/15 shadow-2xl bg-white">
          <PrismaSheetPreview count={count} prismas={prismas} uppercase={uppercase} />
        </div>
      </section>
    </main>
  );
};

import React, { useState } from 'react';
import { ArrowLeft, Download, FileText, Printer } from 'lucide-react';
import { AlteracaoGenerator } from './components/AlteracaoGenerator';
import { CartoesGenerator } from './components/CartoesGenerator';
import { CrachaGenerator } from './components/CrachaGenerator';
import { DocumentosVault } from './components/DocumentosVault';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OfflineIndicator, PWAInstallButton } from './components/PWAComponents';
import { PrismaGenerator } from './components/PrismaGenerator';
import type { CartaoModel } from './lib/cartoesPdf';

type ModuleKey = 'prismas' | 'crachas' | 'alteracao' | 'documentos' | 'cartoes';
type ActiveScreen = 'home' | ModuleKey;

function PrismaSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 44L22 18H52L42 44H12Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M12 44H42L52 44L47 29"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path d="M25 28H41M23 34H37" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function CrachaSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <path
        d="M27 10H37V17H27V10Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <rect x="14" y="17" width="36" height="37" rx="4" stroke="currentColor" strokeWidth="2.2" />
      <path d="M14 27H50M14 44H50" stroke="currentColor" strokeWidth="2" opacity="0.7" />
      <circle cx="32" cy="35.5" r="4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function AlteracaoSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <rect x="15" y="10" width="34" height="44" rx="3" stroke="currentColor" strokeWidth="2.2" />
      <path d="M15 22H49M32 10V22" stroke="currentColor" strokeWidth="2" opacity="0.75" />
      <path
        d="M21 30H43M21 37H43M21 44H35"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DocumentosSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 20C10 17.7909 11.7909 16 14 16H25L30 21H50C52.2091 21 54 22.7909 54 25V46C54 48.2091 52.2091 50 50 50H14C11.7909 50 10 48.2091 10 46V20Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M18 32H46M18 39H36"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}

function CartoesSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <rect x="10" y="15" width="44" height="34" rx="3" stroke="currentColor" strokeWidth="2.2" />
      <rect x="14.5" y="19.5" width="35" height="25" rx="1.5" stroke="currentColor" strokeWidth="1.6" opacity="0.65" />
      <path d="M22 27H42M20 33H44M26 39H38" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

interface LauncherCardItem {
  id: ModuleKey;
  title: string;
  subtitle: string;
  renderIcon: () => React.ReactNode;
}

const LAUNCHER_CARDS: LauncherCardItem[] = [
  {
    id: 'prismas',
    title: 'Prisma',
    subtitle: 'Folha A4 · 1 ou 2',
    renderIcon: () => <PrismaSymbol className="w-16 h-16 sm:w-[68px] sm:h-[68px]" />,
  },
  {
    id: 'crachas',
    title: 'Crachá',
    subtitle: 'Identificação e RP',
    renderIcon: () => <CrachaSymbol className="w-16 h-16 sm:w-[68px] sm:h-[68px]" />,
  },
  {
    id: 'alteracao',
    title: 'Alteração',
    subtitle: 'Folha + Editor Word',
    renderIcon: () => <AlteracaoSymbol className="w-16 h-16 sm:w-[68px] sm:h-[68px]" />,
  },
  {
    id: 'documentos',
    title: 'Documentos',
    subtitle: 'Pasta e planilhas',
    renderIcon: () => <DocumentosSymbol className="w-16 h-16 sm:w-[68px] sm:h-[68px]" />,
  },
  {
    id: 'cartoes',
    title: 'Cartões',
    subtitle: 'Boas-vindas e aniversário',
    renderIcon: () => <CartoesSymbol className="w-16 h-16 sm:w-[68px] sm:h-[68px]" />,
  },
];

function WorkspaceShell() {
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('home');
  const [cartaoModel, setCartaoModel] = useState<CartaoModel>('boas_vindas');
  const [actionSignal, setActionSignal] = useState<Record<ModuleKey, number>>({
    prismas: 0,
    crachas: 0,
    alteracao: 0,
    documentos: 0,
    cartoes: 0,
  });

  const triggerTopAction = () => {
    if (activeScreen === 'home') return;
    setActionSignal((prev) => ({
      ...prev,
      [activeScreen]: prev[activeScreen] + 1,
    }));
  };

  return (
    <div className="min-h-screen bg-[#0B0E0D] text-[#E4EAE6] flex flex-col">
      {/* Minimal 3-Zone Top Bar */}
      <header className="no-print h-14 px-4 sm:px-6 border-b border-white/10 bg-[#101513] flex items-center justify-between gap-3">
        {/* Zone 1: Brand or Back to Home */}
        <div className="flex items-center gap-2.5 min-w-0 shrink-0">
          {activeScreen !== 'home' ? (
            <button
              type="button"
              onClick={() => setActiveScreen('home')}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#161D1A] hover:bg-[#1E2824] px-3 text-xs sm:text-sm font-medium text-[#E4EAE6] transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4 text-[#83B499]" />
              <span>Início</span>
            </button>
          ) : (
            <>
              <img
                src="/icon.svg"
                alt="Emblema SISCOM"
                className="w-7 h-7 rounded-md border border-white/10 shrink-0"
              />
              <h1 className="font-display text-sm sm:text-base font-semibold tracking-tight text-[#E4EAE6] whitespace-nowrap">
                SISCOM
              </h1>
            </>
          )}
        </div>

        {/* Zone 2: Quick Module Switcher (shown inside modules) */}
        {activeScreen !== 'home' ? (
          <nav
            aria-label="Módulos do sistema"
            className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0E0D] border border-white/10 overflow-x-auto"
          >
            {(
              [
                { id: 'prismas', label: 'Prisma' },
                { id: 'crachas', label: 'Crachá' },
                { id: 'alteracao', label: 'Alteração' },
                { id: 'documentos', label: 'Documentos' },
                { id: 'cartoes', label: 'Cartões' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveScreen(tab.id)}
                className={`min-h-[34px] px-2.5 sm:px-3.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeScreen === tab.id
                    ? 'bg-[#2D5A43] text-white'
                    : 'text-[#98A89F] hover:text-[#E4EAE6]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        ) : (
          <div />
        )}

        {/* Zone 3: PWA Install + Contextual Primary Export */}
        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton compact />
          {activeScreen !== 'home' && activeScreen !== 'documentos' && (
            <button
              type="button"
              onClick={triggerTopAction}
              className="min-h-[40px] inline-flex items-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] px-3 sm:px-3.5 py-2 text-xs sm:text-sm font-medium text-white transition-colors whitespace-nowrap shrink-0"
            >
              {activeScreen === 'alteracao' ? (
                <>
                  <Printer className="w-4 h-4" />
                  <span className="hidden sm:inline">Imprimir / PDF</span>
                  <span className="sm:hidden">PDF</span>
                </>
              ) : activeScreen === 'cartoes' && cartaoModel === 'aniversario' ? (
                <>
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">Baixar PNG</span>
                  <span className="sm:hidden">PNG</span>
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" />
                  <span className="hidden sm:inline">Baixar PDF (A4)</span>
                  <span className="sm:hidden">PDF</span>
                </>
              )}
            </button>
          )}
        </div>
      </header>

      {/* Home Launcher: Opção 2 — Placas Metálicas Verde-Oliva */}
      {activeScreen === 'home' && (
        <main className="flex-1 flex flex-col items-center justify-center px-5 py-10 sm:py-14">
          <div className="w-full max-w-6xl space-y-8">
            <div className="text-center space-y-1.5">
              <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#E4EAE6]">
                Selecione uma função
              </h2>
              <p className="text-sm text-[#98A89F]">
                Ferramentas de geração, edição e armazenamento de documentos A4
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
              {LAUNCHER_CARDS.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setActiveScreen(card.id)}
                  className="tactical-plate group aspect-square w-full rounded-[10px] p-5 flex flex-col items-center justify-center gap-4 text-center transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#83B499] cursor-pointer"
                >
                  <div className="w-22 h-22 rounded-[10px] bg-[#0B110E]/80 border border-white/10 group-hover:border-[#83B499]/45 flex items-center justify-center text-[#83B499] group-hover:text-[#A8D6BC] transition-colors">
                    {card.renderIcon()}
                  </div>

                  <div className="space-y-1">
                    <span className="block font-display text-xl sm:text-2xl font-semibold tracking-tight text-[#E4EAE6] group-hover:text-white transition-colors">
                      {card.title}
                    </span>
                    <span className="block text-xs text-[#98A89F] group-hover:text-[#C6D4CC] transition-colors">
                      {card.subtitle}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* Active Module View */}
      {activeScreen === 'prismas' && (
        <PrismaGenerator externalDownloadSignal={actionSignal.prismas} />
      )}
      {activeScreen === 'crachas' && (
        <CrachaGenerator externalDownloadSignal={actionSignal.crachas} />
      )}
      {activeScreen === 'alteracao' && (
        <AlteracaoGenerator externalPrintSignal={actionSignal.alteracao} />
      )}
      {activeScreen === 'documentos' && (
        <DocumentosVault externalDownloadSignal={actionSignal.documentos} />
      )}
      {activeScreen === 'cartoes' && (
        <CartoesGenerator
          externalDownloadSignal={actionSignal.cartoes}
          onModelChange={setCartaoModel}
        />
      )}

      <div className="no-print">
        <OfflineIndicator />
      </div>
    </div>
  );
}

export default function App() {
  const [resetKey, setResetKey] = useState(0);

  return (
    <ErrorBoundary key={resetKey} onReset={() => setResetKey((k) => k + 1)}>
      <WorkspaceShell />
    </ErrorBoundary>
  );
}

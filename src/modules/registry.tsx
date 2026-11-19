import React from 'react';
import { Shield } from 'lucide-react';
import type { ModuleKey } from '../core/auth/authService';
import { AdminPanel } from './admin/AdminPanel';
import { AgendaComsoc } from './agenda/AgendaComsoc';
import { AlteracaoGenerator } from './alteracao/AlteracaoGenerator';
import { CartoesGenerator } from './cartoes/CartoesGenerator';
import { CrachaGenerator } from './crachas/CrachaGenerator';
import { DocumentosVault } from './documentos/DocumentosVault';
import { PrismaGenerator } from './prismas/PrismaGenerator';
import { RelatorioGenerator } from './relatorio/RelatorioGenerator';

export type ActiveScreen = 'home' | 'admin' | ModuleKey;

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
      <rect
        x="14.5"
        y="19.5"
        width="35"
        height="25"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.65"
      />
      <path
        d="M22 27H42M20 33H44M26 39H38"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RelatorioSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <rect x="14" y="10" width="36" height="44" rx="3" stroke="currentColor" strokeWidth="2.2" />
      <path d="M14 21H50M25 21V54" stroke="currentColor" strokeWidth="1.8" opacity="0.7" />
      <path
        d="M30 29H44M30 37H44M30 45H40"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AgendaSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <rect x="11" y="15" width="42" height="38" rx="4" stroke="currentColor" strokeWidth="2.2" />
      <path d="M22 10V19M42 10V19" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M11 26H53" stroke="currentColor" strokeWidth="2" opacity="0.75" />
      <rect x="19" y="32" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <rect x="29" y="32" width="7" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" opacity="0.75" />
      <rect x="39" y="32" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.8" opacity="0.75" />
      <path d="M19 44H35" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

export interface FeatureModuleDefinition {
  id: ModuleKey;
  title: string;
  renderIcon: (className: string) => React.ReactNode;
  Component: React.ComponentType;
}

export const FEATURE_MODULES: readonly FeatureModuleDefinition[] = [
  {
    id: 'prismas',
    title: 'Prismas',
    renderIcon: (className) => <PrismaSymbol className={className} />,
    Component: PrismaGenerator,
  },
  {
    id: 'crachas',
    title: 'Crachás',
    renderIcon: (className) => <CrachaSymbol className={className} />,
    Component: CrachaGenerator,
  },
  {
    id: 'alteracao',
    title: 'Alterações',
    renderIcon: (className) => <AlteracaoSymbol className={className} />,
    Component: AlteracaoGenerator,
  },
  {
    id: 'documentos',
    title: 'Documentos',
    renderIcon: (className) => <DocumentosSymbol className={className} />,
    Component: DocumentosVault,
  },
  {
    id: 'cartoes',
    title: 'Cartões',
    renderIcon: (className) => <CartoesSymbol className={className} />,
    Component: CartoesGenerator,
  },
  {
    id: 'relatorio',
    title: 'Relatório',
    renderIcon: (className) => <RelatorioSymbol className={className} />,
    Component: RelatorioGenerator,
  },
  {
    id: 'agenda',
    title: 'Agenda',
    renderIcon: (className) => <AgendaSymbol className={className} />,
    Component: AgendaComsoc,
  },
];

export const FEATURE_MODULE_MAP: Record<ModuleKey, FeatureModuleDefinition> =
  FEATURE_MODULES.reduce(
    (acc, mod) => {
      acc[mod.id] = mod;
      return acc;
    },
    {} as Record<ModuleKey, FeatureModuleDefinition>
  );

export const VALID_SCREENS: ReadonlySet<ActiveScreen> = new Set<ActiveScreen>([
  'home',
  'admin',
  ...FEATURE_MODULES.map((m) => m.id),
]);

export function getScreenTitle(screen: Exclude<ActiveScreen, 'home'>): string {
  if (screen === 'admin') return 'Administração';
  return FEATURE_MODULE_MAP[screen].title;
}

export function renderScreenIcon(
  screen: Exclude<ActiveScreen, 'home'>,
  className: string
): React.ReactNode {
  if (screen === 'admin') return <Shield className={className} />;
  return FEATURE_MODULE_MAP[screen].renderIcon(className);
}

export function renderScreenContent(screen: Exclude<ActiveScreen, 'home'>): React.ReactNode {
  if (screen === 'admin') return <AdminPanel />;
  const Component = FEATURE_MODULE_MAP[screen].Component;
  return <Component />;
}

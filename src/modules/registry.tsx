import React from 'react';
import { Shield } from 'lucide-react';
import type { ModuleKey } from '../core/auth/authService';
import { AdminPanel } from './admin/AdminPanel';
import { AgendaComsoc } from './agenda/AgendaComsoc';
import { AlteracaoGenerator } from './alteracao/AlteracaoGenerator';
import {
  ARQUIVO_DRIVE_FOLDER_URL,
  ArquivoInstitucional,
} from './arquivo/ArquivoInstitucional';
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
        d="M12 45L22 18H52L42 45H12Z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      <path
        d="M42 45L52 45L47.5 30"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.58"
      />
      <path
        d="M25 28.5H41M22.5 35.5H36.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CrachaSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <rect
        x="14"
        y="17"
        width="36"
        height="37"
        rx="5"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="2.1"
      />
      <path
        d="M26.5 10.5H37.5V17H26.5V10.5Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      <path d="M14 26.5H50" stroke="currentColor" strokeWidth="1.9" opacity="0.65" />
      <circle
        cx="32"
        cy="36"
        r="4.5"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M23.5 47.5C25.2 44.6 28.3 43.2 32 43.2C35.7 43.2 38.8 44.6 40.5 47.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AlteracaoSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <rect
        x="15"
        y="10"
        width="34"
        height="44"
        rx="4"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="2.1"
      />
      <path
        d="M15 21.5H49V14C49 11.7909 47.2091 10 45 10H19C16.7909 10 15 11.7909 15 14V21.5Z"
        fill="currentColor"
        fillOpacity="0.14"
      />
      <path d="M15 21.5H49M32 10V21.5" stroke="currentColor" strokeWidth="1.9" opacity="0.7" />
      <path
        d="M22 30H42M22 37.5H42M22 45H34"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DocumentosSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 20C10 17.7909 11.7909 16 14 16H24.8L29.8 21H50C52.2091 21 54 22.7909 54 25V46C54 48.2091 52.2091 50 50 50H14C11.7909 50 10 48.2091 10 46V20Z"
        fill="currentColor"
        fillOpacity="0.11"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 32.5H45.5M18.5 39.5H35.5"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        opacity="0.82"
      />
    </svg>
  );
}

function CartoesSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <rect
        x="10"
        y="15"
        width="44"
        height="34"
        rx="4.5"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="2.1"
      />
      <rect
        x="15"
        y="20"
        width="34"
        height="24"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.58"
      />
      <path
        d="M22.5 27.5H41.5M20.5 33.5H43.5M26.5 39.5H37.5"
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
      <rect
        x="14"
        y="10"
        width="36"
        height="44"
        rx="4"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="2.1"
      />
      <rect x="14" y="21" width="11" height="33" fill="currentColor" fillOpacity="0.1" />
      <path d="M14 21H50M25 21V54" stroke="currentColor" strokeWidth="1.8" opacity="0.68" />
      <path
        d="M30.5 29.5H44M30.5 37H44M30.5 44.5H39.5"
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
      <rect
        x="11"
        y="15"
        width="42"
        height="38"
        rx="5"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="2.1"
      />
      <path
        d="M11 26H53V20C53 17.2386 50.7614 15 48 15H16C13.2386 15 11 17.2386 11 20V26Z"
        fill="currentColor"
        fillOpacity="0.14"
      />
      <path d="M22 10.5V19M42 10.5V19" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M11 26H53" stroke="currentColor" strokeWidth="1.9" opacity="0.72" />
      <rect
        x="19"
        y="32"
        width="7"
        height="6"
        rx="1.5"
        fill="currentColor"
        fillOpacity="0.28"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <rect x="29" y="32" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" opacity="0.75" />
      <rect x="39" y="32" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.7" opacity="0.75" />
      <path d="M19 44.5H35" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

function ArquivoSymbol({ className = 'w-14 h-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 19C10 16.7909 11.7909 15 14 15H24.8L29.8 20H50C52.2091 20 54 21.7909 54 24V46C54 48.2091 52.2091 50 50 50H14C11.7909 50 10 48.2091 10 46V19Z"
        fill="currentColor"
        fillOpacity="0.11"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      <path
        d="M32 41.5V28.5M32 28.5L26.5 34M32 28.5L37.5 34"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22.5 44.5H41.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.72"
      />
    </svg>
  );
}

export interface FeatureModuleDefinition {
  id: ModuleKey;
  title: string;
  description: string;
  keywords: readonly string[];
  externalUrl?: string;
  renderIcon: (className: string) => React.ReactNode;
  Component: React.ComponentType;
}

export const FEATURE_MODULES: readonly FeatureModuleDefinition[] = [
  {
    id: 'prismas',
    title: 'Prismas',
    description: 'Gere e gerencie prismas',
    keywords: ['prisma', 'mesa', 'autoridade', 'nome', 'placa', 'identificacao'],
    renderIcon: (className) => <PrismaSymbol className={className} />,
    Component: PrismaGenerator,
  },
  {
    id: 'crachas',
    title: 'Crachás',
    description: 'Cadastre e imprima crachás',
    keywords: ['cracha', 'credencial', 'visitante', 'acesso', 'evento', 'impressao'],
    renderIcon: (className) => <CrachaSymbol className={className} />,
    Component: CrachaGenerator,
  },
  {
    id: 'cartoes',
    title: 'Cartões',
    description: 'Produza cartões diversos',
    keywords: ['cartao', 'convite', 'aniversario', 'homenagem', 'comemorativo'],
    renderIcon: (className) => <CartoesSymbol className={className} />,
    Component: CartoesGenerator,
  },
  {
    id: 'alteracao',
    title: 'Alterações',
    description: 'Edite e formate alterações',
    keywords: ['alteracao', 'alteracoes', 'bi', 'boletim', 'ficha', 'word', 'pdf'],
    renderIcon: (className) => <AlteracaoSymbol className={className} />,
    Component: AlteracaoGenerator,
  },
  {
    id: 'documentos',
    title: 'Documentos',
    description: 'Acesse documentos da seção',
    keywords: ['documento', 'oficio', 'modelo', 'arquivo', 'secao'],
    renderIcon: (className) => <DocumentosSymbol className={className} />,
    Component: DocumentosVault,
  },
  {
    id: 'relatorio',
    title: 'Relatório',
    description: 'Gere relatórios e registros',
    keywords: ['relatorio', 'relatorios', 'resumo', 'atividade', 'estatistica'],
    renderIcon: (className) => <RelatorioSymbol className={className} />,
    Component: RelatorioGenerator,
  },
  {
    id: 'agenda',
    title: 'Agenda',
    description: 'Consulte e gerencie compromissos',
    keywords: ['agenda', 'calendario', 'evento', 'horario', 'google', 'reuniao', 'triagem'],
    renderIcon: (className) => <AgendaSymbol className={className} />,
    Component: AgendaComsoc,
  },
  {
    id: 'arquivo',
    title: 'Arquivo',
    description: 'Abrir pasta FOTOS - 2026 no Google Drive',
    keywords: ['arquivo', 'institucional', 'drive', 'google', 'fotos', '2026', 'pasta'],
    externalUrl: ARQUIVO_DRIVE_FOLDER_URL,
    renderIcon: (className) => <ArquivoSymbol className={className} />,
    Component: ArquivoInstitucional,
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

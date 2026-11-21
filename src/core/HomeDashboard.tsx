import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CornerDownLeft,
  ListTodo,
  LogOut,
  Search,
  Settings,
  User,
  X,
} from 'lucide-react';
import heroBackdropImg from '../assets/images/siscom_operational_montage_1795291140833.jpg';
import type { UserAccount } from './auth/authService';
import { signOutCurrentUser } from './auth/authService';
import { PWAInstallButton } from './pwa/PWAComponents';
import { HomeAgendaPreview } from '../modules/agenda/HomeAgendaPreview';
import { useDemandas } from '../modules/demandas/DemandasContext';
import { HomeDemandasWidgets } from '../modules/demandas/HomeDemandasWidgets';
import {
  ActiveScreen,
  FeatureModuleDefinition,
} from '../modules/registry';
import {
  CREST_LAYOUT_TRANSITION,
  MODULE_EXPAND_TRANSITION,
  MODULE_LOCKUP_TRANSITION,
  SISCOM_EASE,
} from '../shared/motion';
import { SiscomAlert } from '../shared/ui';

const BATTALION_CREST_SRC = '/assets/aistudio/373305_b7abfd86.png';

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

interface HomeDashboardProps {
  account: UserAccount;
  greeting: string;
  shouldSpinCrest: boolean;
  visibleCards: readonly FeatureModuleDefinition[];
  hasAgendaAccess: boolean;
  accessNotice: string | null;
  onDismissAccessNotice: () => void;
  onNavigate: (screen: ActiveScreen) => void;
}

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  account,
  greeting,
  shouldSpinCrest,
  visibleCards,
  hasAgendaAccess,
  accessNotice,
  onDismissAccessNotice,
  onNavigate,
}) => {
  const { setPanelOpen: setDemandasPanelOpen } = useDemandas();
  const [searchQuery, setSearchQuery] = useState('');

  const normalizedQuery = useMemo(() => normalizeSearch(searchQuery), [searchQuery]);

  const filteredCards = useMemo(() => {
    if (!normalizedQuery) return visibleCards;
    return visibleCards.filter((mod) => {
      const hay = normalizeSearch(
        `${mod.title} ${mod.description} ${mod.keywords.join(' ')}`
      );
      return hay.includes(normalizedQuery);
    });
  }, [visibleCards, normalizedQuery]);

  const matchesDemandasQuery = useMemo(() => {
    if (!normalizedQuery) return false;
    return ['demanda', 'demandas', 'tarefa', 'tarefas', 'lembrete', 'prazo', 'notificacao'].some(
      (kw) => kw.includes(normalizedQuery) || normalizedQuery.includes(kw)
    );
  }, [normalizedQuery]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizedQuery) return;
    if (filteredCards.length > 0) {
      onNavigate(filteredCards[0].id);
      return;
    }
    if (matchesDemandasQuery) {
      setDemandasPanelOpen(true);
    }
  };

  // Calculate remaining slots in the 2-column (sm/lg) vs 3-column (xl) main module grid
  // With 7 modules in xl:grid-cols-3 -> 2 trailing slots; in sm/lg:grid-cols-2 -> 1 trailing slot
  const trailingSlotsXl =
    !normalizedQuery && filteredCards.length > 0
      ? (3 - (filteredCards.length % 3)) % 3
      : 0;
  const trailingSlotsMd =
    !normalizedQuery && filteredCards.length > 0
      ? (2 - (filteredCards.length % 2)) % 2
      : 0;

  return (
    <div className="relative z-10 flex-1 flex flex-col min-h-screen">
      {/* Operational military montage backdrop with balanced dark minimalist veil */}
      <div
        aria-hidden="true"
        className="no-print pointer-events-none fixed inset-0 overflow-hidden z-0"
      >
        <img
          src={heroBackdropImg}
          alt=""
          className="w-full h-full object-cover object-center opacity-[0.42] sm:opacity-[0.46] select-none"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(6, 9, 8, 0.44) 0%, rgba(7, 10, 9, 0.56) 42%, rgba(8, 11, 9, 0.78) 78%, rgba(8, 11, 9, 0.9) 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(85% 75% at 50% 30%, rgba(8, 11, 9, 0.08) 0%, rgba(6, 9, 8, 0.56) 100%)',
          }}
        />
      </div>

      {/* Institutional Top Header */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: SISCOM_EASE }}
        className="no-print relative z-20 w-full max-w-[1260px] mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-5 pb-3 flex items-center justify-between gap-3"
      >
        {/* Left: Arma de Comunicações + SISCOM | Brasão 1º BI Mec (Es) */}
        <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <motion.div
              layoutId="siscom-crest"
              transition={CREST_LAYOUT_TRANSITION}
              className="w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center shrink-0"
            >
              <motion.img
                src="/assets/logo_arma_comunicacoes.png"
                alt="Arma de Comunicações do Exército Brasileiro"
                referrerPolicy="no-referrer"
                initial={shouldSpinCrest ? { rotate: -360 } : false}
                animate={{ rotate: 0 }}
                transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
                className="w-full h-full object-contain select-none"
              />
            </motion.div>

            <div className="flex flex-col leading-none">
              <motion.h1
                layoutId="siscom-wordmark"
                transition={CREST_LAYOUT_TRANSITION}
                className="metallic-wordmark font-display text-xl sm:text-[26px] font-bold tracking-[0.14em] uppercase"
              >
                SISCOM
              </motion.h1>
              <span className="text-[10px] sm:text-xs text-[#C5D1CA]/85 tracking-[0.02em] mt-1 whitespace-nowrap">
                Seção de Comunicação Social
              </span>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="hidden sm:block h-9 w-px bg-gradient-to-b from-transparent via-[#C29B56]/45 to-transparent mx-0.5 shrink-0"
          />

          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={BATTALION_CREST_SRC}
              alt="Brasão do 1º Batalhão de Infantaria Mecanizado (Escola)"
              className="h-9 sm:h-11 w-auto object-contain shrink-0 drop-shadow-[0_4px_12px_rgba(0,0,0,0.72)] select-none"
            />
            <div className="hidden md:flex flex-col leading-snug min-w-0">
              <span className="text-[13px] font-medium text-[#E8EEEB] truncate">
                1º Batalhão de Infantaria Mecanizado (Escola)
              </span>
              <span className="text-xs text-[#9EAEA5] truncate">
                Regimento Sampaio
              </span>
            </div>
          </div>
        </div>

        {/* Right: Install PWA + User Profile + Admin + Sign Out */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          <PWAInstallButton compact />

          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-[9px] bg-[#0B100E]/70 border border-white/[0.08]">
            <User className="w-3.5 h-3.5 text-[#DFBC75] shrink-0" aria-hidden="true" />
            <span className="text-xs font-medium text-[#E4EAE6] max-w-[150px] truncate">
              {account.displayName}
            </span>
          </div>

          {account.role === 'admin' && (
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              title="Administração"
              aria-label="Administração"
              className="relative siscom-btn siscom-btn-gold !min-h-[38px] !px-2.5 sm:!px-3 text-xs"
            >
              <motion.div
                layoutId="module-surface-admin"
                transition={MODULE_EXPAND_TRANSITION}
                className="absolute inset-0 rounded-lg pointer-events-none"
              />
              <motion.div
                layoutId="module-icon-admin"
                transition={MODULE_LOCKUP_TRANSITION}
                className="relative z-10 flex items-center justify-center"
              >
                <Settings className="w-4 h-4" />
              </motion.div>
              <motion.span
                layoutId="module-title-admin"
                transition={MODULE_LOCKUP_TRANSITION}
                className="relative z-10 hidden lg:inline whitespace-nowrap"
              >
                Administração
              </motion.span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void signOutCurrentUser()}
            title="Sair"
            aria-label="Sair"
            className="siscom-btn siscom-btn-secondary !min-h-[38px] !px-2.5 sm:!px-3 text-xs text-[#C6D4CC]"
          >
            <LogOut className="w-3.5 h-3.5 text-[#98A89F]" />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </motion.header>

      {/* Main Content Container */}
      <main className="relative z-10 flex-1 w-full max-w-[1260px] mx-auto px-4 sm:px-6 lg:px-8 pt-3 sm:pt-5 pb-20 sm:pb-12 flex flex-col gap-5 sm:gap-6">
        {/* Greeting + Command Search Row */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.04, ease: SISCOM_EASE }}
            className="min-w-0"
          >
            <h2 className="font-display text-2xl sm:text-[32px] font-bold tracking-tight leading-tight text-[#F4F7F5] drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]">
              {greeting},{' '}
              <span className="text-[#E2BE74]">{account.displayName}!</span>
            </h2>
          </motion.div>

          <motion.form
            onSubmit={handleSearchSubmit}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.06, ease: SISCOM_EASE }}
            className="w-full md:max-w-[440px]"
          >
            <div className="flex items-center gap-2.5 h-11 sm:h-12 px-4 rounded-full bg-[#0A0F0D]/86 backdrop-blur-md border border-[#C29B56]/28 focus-within:border-[#DFBC75]/65 shadow-[0_10px_28px_rgba(0,0,0,0.48)] transition-colors">
              <Search className="w-4 h-4 text-[#B8C6BE] shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="O que você deseja fazer?"
                aria-label="Pesquisar funções do SISCOM"
                className="flex-1 min-w-0 bg-transparent text-sm text-[#F1F5F3] placeholder:text-[#86968D] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpar pesquisa"
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[#8FA197] hover:text-[#F1F5F3] hover:bg-white/[0.08] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="submit"
                title="Abrir função"
                aria-label="Abrir função correspondente"
                className="inline-flex items-center justify-center px-2.5 py-1 rounded-full border border-white/[0.12] bg-white/[0.04] hover:bg-[#C29B56]/18 hover:border-[#C29B56]/45 text-[#C6D4CC] hover:text-[#F4E6C4] transition-colors cursor-pointer shrink-0"
              >
                <CornerDownLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.form>
        </div>

        {/* Access Notice (if admin revoked a module while open) */}
        <AnimatePresence>
          {accessNotice && (
            <SiscomAlert
              tone="warning"
              onDismiss={onDismissAccessNotice}
              className="w-full"
            >
              {accessNotice}
            </SiscomAlert>
          )}
        </AnimatePresence>

        {/* Action-First Asymmetric Dashboard Grid:
            Primary Stage (~72%): Unified Module Cards in full evidence
            Secondary Corner Rail (~28%): Quiet Agenda Preview + Demandas companion panel */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_312px] xl:grid-cols-[minmax(0,1fr)_336px] gap-4 sm:gap-5 items-start">
          {/* PRIMARY FOCUS: Unified Module Cards Container */}
          <motion.section
            aria-label="Funções do SISCOM"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.05, ease: SISCOM_EASE }}
            className="siscom-home-frame rounded-[16px] p-3.5 sm:p-4.5 backdrop-blur-sm"
          >
            {visibleCards.length === 0 ? (
              <div className="py-10 text-center text-sm text-[#98A89F]">
                Nenhuma função liberada para este login no momento.
              </div>
            ) : filteredCards.length === 0 && !matchesDemandasQuery ? (
              <div className="py-10 text-center space-y-2">
                <p className="text-sm text-[#C6D4CC]">
                  Nenhuma função encontrada para “{searchQuery}”.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs font-medium text-[#DFBC75] hover:underline cursor-pointer"
                >
                  Mostrar todas as funções
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-3.5">
                {filteredCards.map((card, idx) => (
                  <motion.button
                    key={card.id}
                    type="button"
                    onClick={() => onNavigate(card.id)}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.2,
                      delay: 0.02 + idx * 0.022,
                      ease: SISCOM_EASE,
                    }}
                    className="relative siscom-home-card group rounded-[12px] px-4 py-4 sm:px-5 sm:py-5 flex items-center gap-4 text-left cursor-pointer min-h-[84px] sm:min-h-[92px]"
                  >
                    <motion.div
                      layoutId={`module-surface-${card.id}`}
                      transition={MODULE_EXPAND_TRANSITION}
                      className="absolute inset-0 rounded-[12px] pointer-events-none"
                    />

                    <motion.div
                      layoutId={`module-icon-${card.id}`}
                      transition={MODULE_LOCKUP_TRANSITION}
                      className="relative z-10 w-11 h-11 sm:w-12 sm:h-12 shrink-0 flex items-center justify-center text-[#DCBA6E] group-hover:text-[#F1D592] transition-colors duration-200"
                    >
                      {card.renderIcon('w-10 h-10 sm:w-11 sm:h-11')}
                    </motion.div>

                    <div className="relative z-10 min-w-0 flex-1">
                      <motion.span
                        layoutId={`module-title-${card.id}`}
                        transition={MODULE_LOCKUP_TRANSITION}
                        className="block font-display text-base sm:text-[18px] font-semibold tracking-tight text-[#F2F6F3] group-hover:text-[#F4E6C4] transition-colors duration-200 truncate"
                      >
                        {card.title}
                      </motion.span>
                    </div>
                  </motion.button>
                ))}

                {/* Direct Demandas shortcut when searched */}
                {matchesDemandasQuery && (
                  <button
                    type="button"
                    onClick={() => setDemandasPanelOpen(true)}
                    className="siscom-home-card group rounded-[12px] px-4 py-4 sm:px-5 sm:py-5 flex items-center gap-4 text-left cursor-pointer min-h-[84px] sm:min-h-[92px]"
                  >
                    <div className="w-11 h-11 sm:w-12 sm:h-12 shrink-0 flex items-center justify-center text-[#DCBA6E] group-hover:text-[#F1D592]">
                      <ListTodo className="w-8 h-8" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block font-display text-base sm:text-[18px] font-semibold text-[#F2F6F3] group-hover:text-[#F4E6C4]">
                        Demandas
                      </span>
                    </div>
                  </button>
                )}

                {/* Institutional Motto Card filling remaining symmetry slots cleanly */}
                {(trailingSlotsXl > 0 || trailingSlotsMd > 0) && (
                  <div
                    className={`siscom-motto-card relative overflow-hidden rounded-[12px] px-5 py-4 flex items-center gap-4 min-h-[84px] sm:min-h-[92px] ${
                      trailingSlotsMd === 0 ? 'sm:col-span-2' : 'sm:col-span-1'
                    } ${
                      trailingSlotsXl === 2
                        ? 'xl:col-span-2'
                        : trailingSlotsXl === 1
                        ? 'xl:col-span-1'
                        : 'xl:hidden'
                    }`}
                  >
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-6 -bottom-10 w-36 h-44 flex gap-3 rotate-[24deg] opacity-25"
                    >
                      <div className="w-4 h-full bg-gradient-to-b from-[#C29B56]/40 to-transparent" />
                      <div className="w-7 h-full bg-gradient-to-b from-[#2D5A43]/65 to-transparent" />
                    </div>

                    <img
                      src="/assets/logo_arma_comunicacoes.png"
                      alt=""
                      aria-hidden="true"
                      className="relative z-10 w-10 h-10 sm:w-11 sm:h-11 object-contain shrink-0 opacity-95 select-none"
                    />

                    <div className="relative z-10 min-w-0">
                      <p className="font-display italic text-sm sm:text-base font-semibold text-[#F1F5F3] leading-snug">
                        “A verdadeira força nasce da união.”
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.section>

          {/* SECONDARY CORNER RAIL: Quiet Agenda Preview + Demandas Companion Column */}
          <aside
            aria-label="Resumo rápido de agenda e demandas"
            className="flex flex-col gap-3 lg:pt-0.5"
          >
            {hasAgendaAccess && (
              <HomeAgendaPreview
                onOpenAgenda={() => onNavigate('agenda')}
                className="max-w-none"
                compact
              />
            )}
            <HomeDemandasWidgets className="max-w-none" compact />
          </aside>
        </div>
      </main>

      {/* Minimalist Institutional Footer */}
      <footer className="no-print relative z-10 mt-auto border-t border-[#C29B56]/16 bg-[#060908]/92">
        <div className="w-full max-w-[1260px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#98A89F]">
          <div className="flex items-center gap-2.5">
            <img
              src={BATTALION_CREST_SRC}
              alt=""
              aria-hidden="true"
              className="h-5 w-auto object-contain shrink-0 select-none"
            />
            <span className="font-display font-semibold tracking-wider text-[#E4EAE6]">
              SISCOM
            </span>
            <span aria-hidden="true" className="text-[#C29B56]/45">
              |
            </span>
            <span>1º BI Mec (Es)</span>
          </div>

          <div className="flex items-center gap-2 text-[#8F9F96]">
            <span>Seção de Comunicação Social</span>
            <span aria-hidden="true" className="text-[#C29B56]/55">
              ·
            </span>
            <span>Exército Brasileiro</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

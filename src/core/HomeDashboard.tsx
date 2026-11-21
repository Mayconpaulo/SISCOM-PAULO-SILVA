import React, { useMemo, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
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
  const prefersReducedMotion = useReducedMotion();

  // Scroll-driven zoom in / zoom out on the operational backdrop (scroll only, no mouse tracking)
  const { scrollY } = useScroll();
  const smoothScrollY = useSpring(scrollY, {
    stiffness: 110,
    damping: 26,
    mass: 0.45,
  });
  const bgScale = useTransform(smoothScrollY, [0, 460], [1.02, 1.18]);

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
      {/* Operational military montage backdrop with scroll-only zoom */}
      <div
        aria-hidden="true"
        className="no-print pointer-events-none fixed inset-0 overflow-hidden z-0"
      >
        <motion.img
          src={heroBackdropImg}
          alt=""
          style={prefersReducedMotion ? undefined : { scale: bgScale }}
          className="w-full h-full object-cover object-center opacity-[0.52] sm:opacity-[0.58] select-none will-change-transform"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(6, 9, 8, 0.34) 0%, rgba(7, 10, 9, 0.44) 44%, rgba(7, 10, 9, 0.66) 80%, rgba(7, 10, 9, 0.82) 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(90% 80% at 50% 35%, rgba(8, 11, 9, 0.04) 0%, rgba(6, 9, 8, 0.48) 100%)',
          }}
        />
      </div>

      {/* Institutional Top Header (full width) */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: SISCOM_EASE }}
        className="no-print relative z-20 w-full px-3.5 sm:px-5 md:px-6 lg:px-8 xl:px-10 pt-3 md:pt-5 pb-2 md:pb-3 flex items-center justify-between gap-2 md:gap-3"
      >
        {/* Left: Arma de Comunicações + SISCOM | Brasão 1º BI Mec (Es) */}
        <div className="flex items-center gap-2 md:gap-3.5 min-w-0">
          <div className="flex items-center gap-2 md:gap-2.5 shrink-0">
            <motion.div
              layoutId="siscom-crest"
              transition={CREST_LAYOUT_TRANSITION}
              className="w-9 h-9 md:w-12 md:h-12 flex items-center justify-center shrink-0"
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
                className="metallic-wordmark font-display text-[19px] md:text-[26px] font-bold tracking-[0.14em] uppercase"
              >
                SISCOM
              </motion.h1>
              <span className="text-[9.5px] md:text-xs text-[#C5D1CA]/90 tracking-[0.015em] mt-0.5 md:mt-1 whitespace-nowrap">
                Seção de Comunicação Social
              </span>
            </div>
          </div>

          <div
            aria-hidden="true"
            className="h-7 md:h-9 w-px bg-gradient-to-b from-transparent via-[#C9A961]/45 to-transparent mx-0.5 shrink-0"
          />

          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={BATTALION_CREST_SRC}
              alt="Brasão do 1º Batalhão de Infantaria Mecanizado (Escola)"
              className="h-8 md:h-11 w-auto object-contain shrink-0 drop-shadow-[0_4px_12px_rgba(0,0,0,0.72)] select-none"
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
        <div className="flex items-center gap-1.5 md:gap-2.5 shrink-0">
          <PWAInstallButton compact />

          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full siscom-liquid-pill">
            <User className="w-3.5 h-3.5 text-[#DFBC75] shrink-0" aria-hidden="true" />
            <span className="text-xs font-medium text-[#E4EAE6] max-w-[160px] truncate">
              {account.displayName}
            </span>
          </div>

          {account.role === 'admin' && (
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              title="Configurações e Administração"
              aria-label="Configurações e Administração"
              className="relative siscom-btn siscom-btn-gold !min-h-[36px] md:!min-h-[38px] !px-2.5 md:!px-3 text-xs backdrop-blur-md"
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
            className="siscom-btn siscom-btn-secondary !min-h-[36px] md:!min-h-[38px] !px-2.5 md:!px-3 text-xs text-[#C6D4CC] !bg-[#0E1612]/60 backdrop-blur-md"
          >
            <LogOut className="w-3.5 h-3.5 text-[#B8B3A6] md:text-[#98A89F]" />
            <span className="hidden md:inline">Sair</span>
          </button>
        </div>
      </motion.header>

      {/* Main Content Container (Cockpit Operacional on <768px, full desktop width on >=768px) */}
      <main className="relative z-10 flex-1 w-full px-3.5 sm:px-5 md:px-6 lg:px-8 xl:px-10 pt-2 md:pt-5 pb-5 md:pb-10 flex flex-col gap-3.5 md:gap-6">
        {/* Greeting + Command Search Row */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2.5 md:gap-4">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.04, ease: SISCOM_EASE }}
            className="min-w-0"
          >
            <h2 className="font-display text-[21px] sm:text-2xl md:text-[34px] font-bold tracking-tight leading-tight text-[#E8E4D8] md:text-[#F4F7F5] drop-shadow-[0_2px_12px_rgba(0,0,0,0.72)]">
              {greeting},{' '}
              <span className="text-[#C9A961] md:text-[#E2BE74]">{account.displayName}!</span>
            </h2>
          </motion.div>

          <motion.form
            onSubmit={handleSearchSubmit}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.06, ease: SISCOM_EASE }}
            className="w-full md:max-w-[460px] lg:max-w-[500px]"
          >
            <div className="siscom-liquid-pill flex items-center gap-2.5 h-[42px] md:h-12 px-3.5 md:px-4 rounded-full focus-within:border-[#C9A961]/70 md:focus-within:border-[#DFBC75]/65 transition-colors">
              <Search className="w-4 h-4 text-[#B8B3A6] md:text-[#B8C6BE] shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="O que você deseja fazer?"
                aria-label="Pesquisar funções do SISCOM"
                className="flex-1 min-w-0 bg-transparent text-sm text-[#E8E4D8] md:text-[#F1F5F3] placeholder:text-[#9D988C] md:placeholder:text-[#86968D] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpar pesquisa"
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[#B8B3A6] hover:text-[#F1F5F3] hover:bg-white/[0.08] cursor-pointer"
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

        {/* Responsive Cockpit Grid:
            Mobile (<768px): 1. Próximo Evento -> 2. Módulos (4-col) -> 3. Demandas -> 4. Citação
            Desktop (>=1024px): Col 1 Módulos (+ citação inline) | Col 2 Próximo Evento + Demandas */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_336px] xl:grid-cols-[minmax(0,1fr)_364px] 2xl:grid-cols-[minmax(0,1fr)_396px] lg:grid-rows-[auto_1fr] gap-3.5 md:gap-5 lg:gap-y-3.5 lg:gap-x-5 items-start flex-1">
          {/* OPERATIONAL PRIORITY (Mobile above the fold; Desktop right rail top) */}
          {hasAgendaAccess && (
            <HomeAgendaPreview
              onOpenAgenda={() => onNavigate('agenda')}
              className="order-1 md:order-2 lg:col-start-2 lg:row-start-1 max-w-none"
              compact
            />
          )}

          {/* MODULES GRID (Mobile 4-column square cockpit; Desktop primary horizontal cards) */}
          <motion.section
            aria-label="Funções do SISCOM"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.05, ease: SISCOM_EASE }}
            className="order-2 md:order-1 lg:col-start-1 lg:row-start-1 lg:row-span-2 siscom-home-frame rounded-[16px] md:rounded-[18px] p-2.5 md:p-5"
          >
            {visibleCards.length === 0 ? (
              <div className="py-10 text-center text-sm text-[#B8B3A6] md:text-[#98A89F]">
                Nenhuma função liberada para este login no momento.
              </div>
            ) : filteredCards.length === 0 && !matchesDemandasQuery ? (
              <div className="py-10 text-center space-y-2">
                <p className="text-sm text-[#E8E4D8] md:text-[#C6D4CC]">
                  Nenhuma função encontrada para “{searchQuery}”.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-xs font-medium text-[#C9A961] md:text-[#DFBC75] hover:underline cursor-pointer"
                >
                  Mostrar todas as funções
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-4 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-4">
                {filteredCards.map((card, idx) => (
                  <motion.button
                    key={card.id}
                    type="button"
                    onClick={() => onNavigate(card.id)}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={
                      prefersReducedMotion
                        ? undefined
                        : { scale: 1.024, transition: { duration: 0.18, ease: SISCOM_EASE } }
                    }
                    whileTap={
                      prefersReducedMotion
                        ? undefined
                        : { scale: 0.968, transition: { duration: 0.1 } }
                    }
                    transition={{
                      duration: 0.2,
                      delay: 0.02 + idx * 0.022,
                      ease: SISCOM_EASE,
                    }}
                    className="siscom-home-card group rounded-[12px] md:rounded-[14px] px-1.5 py-3 md:px-6 md:py-6 flex flex-col md:flex-row items-center justify-center md:justify-start gap-1.5 md:gap-4 text-center md:text-left cursor-pointer min-h-[78px] md:min-h-[112px] xl:min-h-[122px] will-change-transform"
                  >
                    <motion.div
                      layoutId={`module-surface-${card.id}`}
                      transition={MODULE_EXPAND_TRANSITION}
                      className="absolute inset-0 rounded-[12px] md:rounded-[14px] pointer-events-none"
                    />

                    <motion.div
                      layoutId={`module-icon-${card.id}`}
                      transition={MODULE_LOCKUP_TRANSITION}
                      className="relative z-10 w-8 h-8 md:w-13 md:h-13 shrink-0 flex items-center justify-center text-[#C9A961] md:text-[#E0BE74] group-hover:text-[#F4DBA0] transition-colors duration-200 drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
                    >
                      {card.renderIcon('w-7 h-7 md:w-12 md:h-12')}
                    </motion.div>

                    <div className="relative z-10 w-full md:w-auto min-w-0 md:flex-1">
                      <motion.span
                        layoutId={`module-title-${card.id}`}
                        transition={MODULE_LOCKUP_TRANSITION}
                        className="block font-display text-[11px] leading-[1.15] md:text-[20px] md:leading-normal font-medium md:font-semibold tracking-tight text-[#E8E4D8] md:text-[#F5F8F6] group-hover:text-[#F7E9C8] transition-colors duration-200 truncate drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
                      >
                        {card.title}
                      </motion.span>
                    </div>
                  </motion.button>
                ))}

                {/* Direct Demandas shortcut when searched */}
                {matchesDemandasQuery && (
                  <motion.button
                    type="button"
                    onClick={() => setDemandasPanelOpen(true)}
                    whileHover={
                      prefersReducedMotion
                        ? undefined
                        : { scale: 1.024, transition: { duration: 0.18, ease: SISCOM_EASE } }
                    }
                    whileTap={
                      prefersReducedMotion
                        ? undefined
                        : { scale: 0.968, transition: { duration: 0.1 } }
                    }
                    className="siscom-home-card group rounded-[12px] md:rounded-[14px] px-1.5 py-3 md:px-6 md:py-6 flex flex-col md:flex-row items-center justify-center md:justify-start gap-1.5 md:gap-4 text-center md:text-left cursor-pointer min-h-[78px] md:min-h-[112px] xl:min-h-[122px] will-change-transform"
                  >
                    <div className="relative z-10 w-8 h-8 md:w-13 md:h-13 shrink-0 flex items-center justify-center text-[#C9A961] md:text-[#E0BE74] group-hover:text-[#F4DBA0]">
                      <ListTodo className="w-6 h-6 md:w-9 md:h-9" />
                    </div>
                    <div className="relative z-10 w-full md:w-auto min-w-0 md:flex-1">
                      <span className="block font-display text-[11px] leading-[1.15] md:text-[20px] md:leading-normal font-medium md:font-semibold text-[#E8E4D8] md:text-[#F5F8F6] group-hover:text-[#F7E9C8] truncate">
                        Demandas
                      </span>
                    </div>
                  </motion.button>
                )}

                {/* Institutional Motto Card filling remaining symmetry slots cleanly on Desktop */}
                {(trailingSlotsXl > 0 || trailingSlotsMd > 0) && (
                  <div
                    className={`siscom-motto-card relative overflow-hidden rounded-[14px] px-6 py-5 hidden md:flex items-center gap-4 min-h-[112px] xl:min-h-[122px] ${
                      trailingSlotsMd === 0 ? 'md:col-span-2' : 'md:col-span-1'
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
                      className="pointer-events-none absolute -right-6 -bottom-10 w-40 h-48 flex gap-3 rotate-[24deg] opacity-25"
                    >
                      <div className="w-4 h-full bg-gradient-to-b from-[#C29B56]/45 to-transparent" />
                      <div className="w-7 h-full bg-gradient-to-b from-[#2D5A43]/70 to-transparent" />
                    </div>

                    <img
                      src="/assets/logo_arma_comunicacoes.png"
                      alt=""
                      aria-hidden="true"
                      className="relative z-10 w-12 h-12 object-contain shrink-0 opacity-95 select-none drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
                    />

                    <div className="relative z-10 min-w-0">
                      <p className="font-display italic text-[18px] font-semibold text-[#F3F6F4] leading-snug drop-shadow-[0_1px_6px_rgba(0,0,0,0.55)]">
                        “Sozinhos vamos mais rápido, mas juntos vamos mais longe.”
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.section>

          {/* DEMANDAS PANEL (Mobile immediately below module grid; Desktop right rail bottom) */}
          <HomeDemandasWidgets
            className={`order-3 md:order-3 max-w-none ${
              hasAgendaAccess
                ? 'lg:col-start-2 lg:row-start-2'
                : 'lg:col-start-2 lg:row-start-1'
            }`}
            compact
          />

          {/* MOBILE-ONLY INSTITUTIONAL QUOTE CARD (Bottom of flow, right above footer) */}
          <div className="order-4 md:hidden siscom-motto-card relative overflow-hidden rounded-[14px] px-4 py-3.5 flex items-center gap-3.5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-6 -bottom-10 w-32 h-36 flex gap-2.5 rotate-[24deg] opacity-25"
            >
              <div className="w-3 h-full bg-gradient-to-b from-[#C9A961]/45 to-transparent" />
              <div className="w-6 h-full bg-gradient-to-b from-[#2D5A43]/70 to-transparent" />
            </div>

            <img
              src="/assets/logo_arma_comunicacoes.png"
              alt=""
              aria-hidden="true"
              className="relative z-10 w-9 h-9 object-contain shrink-0 opacity-95 select-none drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
            />

            <div className="relative z-10 min-w-0">
              <p className="font-display italic text-[14px] font-semibold text-[#E8E4D8] leading-snug drop-shadow-[0_1px_6px_rgba(0,0,0,0.55)]">
                “Sozinhos vamos mais rápido, mas juntos vamos mais longe.”
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Minimalist Full-Width Liquid Glass Institutional Footer (extra mobile pb so FAB never overlaps) */}
      <footer className="no-print relative z-10 mt-auto border-t border-white/[0.1] bg-[#060908]/64 backdrop-blur-xl">
        <div className="w-full px-4 md:px-6 lg:px-8 xl:px-10 pt-3 pb-24 md:py-3 flex flex-col md:flex-row items-center justify-between gap-1.5 md:gap-2 text-xs text-[#B8B3A6] md:text-[#98A89F]">
          <div className="flex items-center gap-2.5">
            <img
              src={BATTALION_CREST_SRC}
              alt=""
              aria-hidden="true"
              className="h-5 w-auto object-contain shrink-0 select-none"
            />
            <span className="font-display font-semibold tracking-wider text-[#E8E4D8] md:text-[#E4EAE6]">
              SISCOM
            </span>
            <span aria-hidden="true" className="text-[#C9A961]/55">
              |
            </span>
            <span>1º BI Mec (Es)</span>
          </div>

          <div className="flex items-center gap-2 text-[#B8B3A6] md:text-[#8F9F96]">
            <span>Seção de Comunicação Social</span>
            <span aria-hidden="true" className="text-[#C9A961]/60">
              ·
            </span>
            <span>Exército Brasileiro</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

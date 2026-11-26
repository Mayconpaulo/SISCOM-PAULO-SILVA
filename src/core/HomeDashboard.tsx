import React, { useEffect, useMemo, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import {
  ArrowUpRight,
  ExternalLink,
  ListTodo,
  LogOut,
  Settings,
  User,
} from 'lucide-react';
import heroBackdropImg from '../assets/images/siscom_operational_montage_1795291140833.jpg';
import { CommandSearch } from '../components/ui/command-search';
import { SpotlightCard } from '../components/ui/spotlight-card';
import type { UserAccount } from './auth/authService';
import { signOutCurrentUser } from './auth/authService';
import { PWAInstallButton } from './pwa/PWAComponents';
import { HomeAgendaPreview } from '../modules/agenda/HomeAgendaPreview';
import { useDemandas } from '../modules/demandas/DemandasContext';
import { DemandasNotificationBell } from '../modules/demandas/DemandasNotificationBell';
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

function formatTodayLabel(): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date());
  } catch {
    return '';
  }
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
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  // Scroll-driven subtle depth zoom on the preserved operational military backdrop
  const { scrollY } = useScroll();
  const smoothScrollY = useSpring(scrollY, {
    stiffness: 110,
    damping: 26,
    mass: 0.45,
  });
  const bgScale = useTransform(smoothScrollY, [0, 460], [1.02, 1.15]);

  const normalizedQuery = useMemo(() => normalizeSearch(searchQuery), [searchQuery]);
  const todayLabel = useMemo(() => formatTodayLabel(), []);

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

  const totalSearchMatches = filteredCards.length + (matchesDemandasQuery ? 1 : 0);

  useEffect(() => {
    setHighlightedIdx(0);
  }, [normalizedQuery]);

  const openModuleCard = (card: FeatureModuleDefinition) => {
    if (card.externalUrl) {
      const link = document.createElement('a');
      link.href = card.externalUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
      return;
    }
    onNavigate(card.id);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizedQuery || totalSearchMatches === 0) return;

    const safeIdx = Math.min(highlightedIdx, totalSearchMatches - 1);
    if (safeIdx < filteredCards.length) {
      openModuleCard(filteredCards[safeIdx]);
      return;
    }
    if (matchesDemandasQuery) {
      setDemandasPanelOpen(true);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!normalizedQuery || totalSearchMatches <= 1) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx((prev) => (prev + 1) % totalSearchMatches);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((prev) => (prev - 1 + totalSearchMatches) % totalSearchMatches);
    }
  };

  return (
    <div className="relative z-10 flex-1 flex flex-col min-h-screen overflow-x-hidden">
      {/* Preserved original operational military backdrop with refined contrast scrim */}
      <div
        aria-hidden="true"
        className="no-print pointer-events-none fixed inset-0 overflow-hidden z-0"
      >
        <motion.img
          src={heroBackdropImg}
          alt=""
          style={prefersReducedMotion ? undefined : { scale: bgScale }}
          className="w-full h-full object-cover object-center opacity-[0.48] sm:opacity-[0.54] select-none will-change-transform"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(6, 9, 8, 0.56) 0%, rgba(7, 11, 9, 0.54) 44%, rgba(6, 9, 8, 0.80) 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(88% 76% at 50% 28%, rgba(28, 56, 42, 0.12) 0%, rgba(6, 9, 8, 0.46) 100%)',
          }}
        />
      </div>

      {/* Compact Institutional Glass Top Bar (No Traditional Menu) */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: SISCOM_EASE }}
        className="no-print siscom-liquid-bar sticky top-0 z-20 w-full border-b border-white/[0.09]"
      >
        <div className="w-full max-w-[1340px] mx-auto px-4 sm:px-6 lg:px-8 h-[58px] sm:h-[64px] flex items-center justify-between gap-2 sm:gap-4">
          {/* Left: Institutional identity & crests */}
          <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <motion.div
                layoutId="siscom-crest"
                transition={CREST_LAYOUT_TRANSITION}
                className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center shrink-0"
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

              <div className="flex flex-col leading-none min-w-0">
                <motion.h1
                  layoutId="siscom-wordmark"
                  transition={CREST_LAYOUT_TRANSITION}
                  className="metallic-wordmark font-display text-[17px] sm:text-[21px] font-extrabold tracking-[0.16em] uppercase"
                >
                  SISCOM
                </motion.h1>
                <span className="text-[10px] sm:text-[11px] text-[#AEBEB5] tracking-[0.01em] mt-0.5 truncate max-w-[132px] sm:max-w-none">
                  Seção de Comunicação Social
                </span>
              </div>
            </div>

            <div
              aria-hidden="true"
              className="h-6 sm:h-8 w-px bg-white/[0.12] mx-0.5 shrink-0"
            />

            <div className="flex items-center gap-2.5 min-w-0 shrink-0">
              <img
                src={BATTALION_CREST_SRC}
                alt="Brasão do 1º Batalhão de Infantaria Mecanizado (Escola)"
                className="h-7 sm:h-9 w-auto object-contain shrink-0 select-none"
              />
              <div className="hidden lg:flex flex-col leading-tight min-w-0">
                <span className="text-xs font-medium text-[#E8EEEA] truncate">
                  1º Batalhão de Infantaria Mecanizado (Escola)
                </span>
                <span className="text-[11px] text-[#90A097] truncate">
                  Regimento Sampaio
                </span>
              </div>
            </div>
          </div>

          {/* Right: Notifications bell + Install + User name + Admin + Sign out */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <DemandasNotificationBell />
            <PWAInstallButton compact />

            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.07] text-xs text-[#CFDAD3] whitespace-nowrap">
              <User className="w-3.5 h-3.5 text-[#D8B268] shrink-0" aria-hidden="true" />
              <span className="max-w-[148px] truncate font-medium">{account.displayName}</span>
            </div>

            {account.role === 'admin' && (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                title="Configurações e Administração"
                aria-label="Configurações e Administração"
                className="relative siscom-btn siscom-btn-gold !min-h-[40px] sm:!min-h-[38px] !px-2.5 sm:!px-3.5 text-xs shrink-0"
              >
                <motion.div
                  layoutId="module-surface-admin"
                  transition={MODULE_EXPAND_TRANSITION}
                  className="absolute inset-0 rounded-xl pointer-events-none"
                />
                <motion.div
                  layoutId="module-icon-admin"
                  transition={MODULE_LOCKUP_TRANSITION}
                  className="relative z-10 flex items-center justify-center"
                >
                  <Settings className="w-4 h-4" />
                </motion.div>
                <span className="relative z-10 hidden sm:inline">Administração</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void signOutCurrentUser()}
              title="Sair"
              aria-label="Sair"
              className="siscom-btn siscom-btn-secondary !min-h-[40px] sm:!min-h-[38px] !px-2.5 sm:!px-3 text-xs text-[#D4DFD8] shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 text-[#9AA8A0]" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 w-full max-w-[1340px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 lg:pt-10 pb-8 sm:pb-12 flex flex-col gap-6 sm:gap-8">
        {/* Greeting + Modern Command Search */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 md:gap-8">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.02, ease: SISCOM_EASE }}
            className="min-w-0 space-y-1"
          >
            {todayLabel && (
              <p className="text-xs font-medium text-[#A2B2A9] capitalize tracking-wide tabular-nums">
                {todayLabel}
              </p>
            )}
            <h2 className="font-display text-[25px] sm:text-[29px] lg:text-[34px] font-bold tracking-[-0.025em] leading-[1.15] text-[#F3F7F4]">
              {greeting},{' '}
              <span className="text-[#E7C580]">{account.displayName}</span>
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.04, ease: SISCOM_EASE }}
            className="w-full md:w-[368px] lg:w-[420px] shrink-0"
          >
            <CommandSearch
              value={searchQuery}
              onChange={setSearchQuery}
              onSubmit={handleSearchSubmit}
              onKeyDown={handleSearchKeyDown}
            />
          </motion.div>
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

        {/* Primary Focal Anchor: Interactive 21st.dev Spotlight Functions Grid */}
        <section aria-label="Ferramentas do SISCOM" className="relative">
          {visibleCards.length === 0 ? (
            <div className="siscom-home-panel rounded-2xl py-12 px-4 text-center text-sm text-[#98A9A0]">
              Nenhuma função liberada para este login no momento.
            </div>
          ) : filteredCards.length === 0 && !matchesDemandasQuery ? (
            <div className="siscom-home-panel rounded-2xl py-12 px-4 text-center space-y-3">
              <p className="text-sm text-[#DCE4DF]">
                Nenhuma função encontrada para “{searchQuery}”.
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="siscom-btn siscom-btn-gold !min-h-[36px] !px-4 text-xs"
              >
                Mostrar todas as funções
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-4.5">
              <AnimatePresence mode="popLayout" initial={false}>
                {filteredCards.map((card, idx) => {
                  const isHighlighted = Boolean(normalizedQuery) && idx === highlightedIdx;

                  const cardInner = (
                    <>
                      <motion.div
                        layoutId={`module-surface-${card.id}`}
                        transition={MODULE_EXPAND_TRANSITION}
                        className="absolute inset-0 rounded-2xl pointer-events-none"
                      />

                      {/* Subtle top-right directional affordance */}
                      <span
                        aria-hidden="true"
                        className={`absolute top-3 right-3 z-10 transition-all duration-200 ${
                          card.externalUrl
                            ? 'text-[#84958C] group-hover:text-[#E7C580]'
                            : 'text-[#84958C]/0 -translate-x-0.5 translate-y-0.5 group-hover:text-[#E7C580]/85 group-hover:translate-x-0 group-hover:translate-y-0'
                        }`}
                      >
                        {card.externalUrl ? (
                          <ExternalLink className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4" />
                        )}
                      </span>

                      <motion.div
                        layoutId={`module-icon-${card.id}`}
                        transition={MODULE_LOCKUP_TRANSITION}
                        className="relative z-10 siscom-icon-vessel w-12 h-12 sm:w-[54px] sm:h-[54px] lg:w-14 lg:h-14 rounded-2xl shrink-0 flex items-center justify-center text-[#DFBC75] group-hover:text-[#F5D896]"
                      >
                        {card.renderIcon('w-7 h-7 sm:w-[30px] sm:h-[30px]')}
                      </motion.div>

                      <div className="relative z-10 w-full min-w-0 px-1">
                        <motion.span
                          layoutId={`module-title-${card.id}`}
                          transition={MODULE_LOCKUP_TRANSITION}
                          className="block font-display text-[15px] sm:text-[16.5px] lg:text-[17.5px] font-semibold tracking-[-0.01em] text-[#F2F6F3] group-hover:text-[#FAF0D7] transition-colors duration-150 leading-snug text-center"
                        >
                          {card.title}
                        </motion.span>
                      </div>
                    </>
                  );

                  const cardClasses =
                    'p-4 sm:p-5 lg:p-6 flex flex-col items-center justify-center text-center gap-3 sm:gap-3.5 min-h-[124px] sm:min-h-[138px] lg:min-h-[148px]';

                  if (card.externalUrl) {
                    return (
                      <SpotlightCard
                        key={card.id}
                        href={card.externalUrl}
                        index={idx}
                        highlighted={isHighlighted}
                        className={cardClasses}
                      >
                        {cardInner}
                      </SpotlightCard>
                    );
                  }

                  return (
                    <SpotlightCard
                      key={card.id}
                      onClick={() => onNavigate(card.id)}
                      index={idx}
                      highlighted={isHighlighted}
                      className={cardClasses}
                    >
                      {cardInner}
                    </SpotlightCard>
                  );
                })}

                {/* Direct Demandas shortcut when searched */}
                {matchesDemandasQuery && (
                  <SpotlightCard
                    key="demandas-shortcut"
                    onClick={() => setDemandasPanelOpen(true)}
                    index={filteredCards.length}
                    highlighted={
                      Boolean(normalizedQuery) && highlightedIdx === filteredCards.length
                    }
                    className="p-4 sm:p-5 lg:p-6 flex flex-col items-center justify-center text-center gap-3 sm:gap-3.5 min-h-[124px] sm:min-h-[138px] lg:min-h-[148px]"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute top-3 right-3 z-10 text-[#84958C]/0 -translate-x-0.5 translate-y-0.5 group-hover:text-[#E7C580]/85 group-hover:translate-x-0 group-hover:translate-y-0 transition-all duration-200"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                    </span>

                    <div className="relative z-10 siscom-icon-vessel w-12 h-12 sm:w-[54px] sm:h-[54px] lg:w-14 lg:h-14 rounded-2xl shrink-0 flex items-center justify-center text-[#DFBC75] group-hover:text-[#F5D896]">
                      <ListTodo className="w-7 h-7 sm:w-[30px] sm:h-[30px]" />
                    </div>

                    <div className="relative z-10 w-full min-w-0 px-1">
                      <span className="block font-display text-[15px] sm:text-[16.5px] lg:text-[17.5px] font-semibold tracking-[-0.01em] text-[#F2F6F3] group-hover:text-[#FAF0D7] transition-colors duration-150 leading-snug text-center">
                        Demandas
                      </span>
                    </div>
                  </SpotlightCard>
                )}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* Quiet Secondary Operational Strip: Agenda & Demandas */}
        <section
          aria-label="Agenda e Demandas"
          className="pt-5 sm:pt-6 border-t border-white/[0.08]"
        >
          <div
            className={`grid grid-cols-1 gap-4 lg:gap-4.5 items-stretch ${
              hasAgendaAccess ? 'md:grid-cols-2' : ''
            }`}
          >
            {hasAgendaAccess && (
              <HomeAgendaPreview
                onOpenAgenda={() => onNavigate('agenda')}
                className="max-w-none"
                compact
              />
            )}

            <HomeDemandasWidgets className="max-w-none" compact />
          </div>
        </section>
      </main>

      {/* Minimalist Institutional Glass Footer */}
      <footer className="no-print siscom-liquid-bar relative z-10 mt-auto border-t border-white/[0.09]">
        <div className="w-full max-w-[1340px] mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-24 md:py-3.5 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-[#95A49B]">
          <div className="flex items-center gap-2.5">
            <img
              src={BATTALION_CREST_SRC}
              alt=""
              aria-hidden="true"
              className="h-5 w-auto object-contain shrink-0 select-none"
            />
            <span className="font-display font-semibold tracking-wider text-[#E8EEEA]">
              SISCOM
            </span>
            <span aria-hidden="true" className="text-[#C9A961]/45">
              ·
            </span>
            <span>1º BI Mec (Es)</span>
          </div>

          <p className="italic text-[11.5px] text-[#BFB6A2] text-center">
            “Sozinhos vamos mais rápido, mas juntos vamos mais longe.”
          </p>

          <div className="flex items-center gap-2 text-[#8E9D95]">
            <span>Seção de Comunicação Social</span>
            <span aria-hidden="true" className="text-[#C9A961]/45">
              ·
            </span>
            <span>Exército Brasileiro</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

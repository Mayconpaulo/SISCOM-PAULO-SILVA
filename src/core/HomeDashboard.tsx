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
  ExternalLink,
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
  const prefersReducedMotion = useReducedMotion();

  // Scroll-driven zoom on the preserved operational military backdrop
  const { scrollY } = useScroll();
  const smoothScrollY = useSpring(scrollY, {
    stiffness: 110,
    damping: 26,
    mass: 0.45,
  });
  const bgScale = useTransform(smoothScrollY, [0, 460], [1.02, 1.16]);

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

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizedQuery) return;
    if (filteredCards.length > 0) {
      const firstCard = filteredCards[0];
      if (firstCard.externalUrl) {
        const link = document.createElement('a');
        link.href = firstCard.externalUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();
        return;
      }
      onNavigate(firstCard.id);
      return;
    }
    if (matchesDemandasQuery) {
      setDemandasPanelOpen(true);
    }
  };

  return (
    <div className="relative z-10 flex-1 flex flex-col min-h-screen overflow-x-hidden">
      {/* Preserved original operational military backdrop with balanced contrast scrim */}
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
              'linear-gradient(180deg, rgba(6, 9, 8, 0.56) 0%, rgba(7, 10, 9, 0.56) 46%, rgba(6, 9, 8, 0.78) 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(90% 80% at 50% 32%, rgba(8, 12, 10, 0.06) 0%, rgba(6, 9, 8, 0.44) 100%)',
          }}
        />
      </div>

      {/* Compact Institutional Liquid Glass Header */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: SISCOM_EASE }}
        className="no-print siscom-liquid-bar relative z-20 w-full border-b border-white/[0.1]"
      >
        <div className="w-full max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-4">
          {/* Left: Institutional identity & crests */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
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
                  className="metallic-wordmark font-display text-[17px] sm:text-[21px] font-bold tracking-[0.14em] uppercase"
                >
                  SISCOM
                </motion.h1>
                <span className="text-[10px] sm:text-[11px] text-[#B5C2BA] tracking-[0.01em] mt-0.5 truncate max-w-[128px] sm:max-w-none">
                  Seção de Comunicação Social
                </span>
              </div>
            </div>

            <div
              aria-hidden="true"
              className="h-6 sm:h-8 w-px bg-white/[0.14] mx-0.5 shrink-0"
            />

            <div className="flex items-center gap-2.5 min-w-0 shrink-0">
              <img
                src={BATTALION_CREST_SRC}
                alt="Brasão do 1º Batalhão de Infantaria Mecanizado (Escola)"
                className="h-7 sm:h-9 w-auto object-contain shrink-0 select-none"
              />
              <div className="hidden lg:flex flex-col leading-tight min-w-0">
                <span className="text-xs font-medium text-[#E4EAE6] truncate">
                  1º Batalhão de Infantaria Mecanizado (Escola)
                </span>
                <span className="text-[11px] text-[#95A49B] truncate">
                  Regimento Sampaio
                </span>
              </div>
            </div>
          </div>

          {/* Right: Notifications bell + Install + User name + Admin + Sign out */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <DemandasNotificationBell />
            <PWAInstallButton compact />

            <div className="hidden md:flex items-center gap-1.5 px-2 text-xs text-[#C6D4CC] whitespace-nowrap">
              <User className="w-3.5 h-3.5 text-[#C9A961] shrink-0" aria-hidden="true" />
              <span className="max-w-[150px] truncate font-medium">{account.displayName}</span>
            </div>

            {account.role === 'admin' && (
              <button
                type="button"
                onClick={() => onNavigate('admin')}
                title="Configurações e Administração"
                aria-label="Configurações e Administração"
                className="relative siscom-btn siscom-btn-gold !min-h-[40px] sm:!min-h-[36px] !px-2.5 sm:!px-3 text-xs shrink-0"
              >
                <motion.div
                  layoutId="module-surface-admin"
                  transition={MODULE_EXPAND_TRANSITION}
                  className="absolute inset-0 rounded-[0.625rem] pointer-events-none"
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
              className="siscom-btn siscom-btn-secondary !min-h-[40px] sm:!min-h-[36px] !px-2.5 sm:!px-3 text-xs text-[#CFDAD3] shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 text-[#A5B3AB]" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </motion.header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 w-full max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-6 sm:pb-10 flex flex-col gap-5 sm:gap-7">
        {/* Greeting + Command Search */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3.5 md:gap-6">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.03, ease: SISCOM_EASE }}
            className="min-w-0 space-y-1"
          >
            {todayLabel && (
              <p className="text-xs text-[#A5B3AB] capitalize tracking-wide">{todayLabel}</p>
            )}
            <h2 className="font-display text-2xl sm:text-[26px] lg:text-[30px] font-semibold tracking-tight leading-tight text-[#F1F5F2]">
              {greeting},{' '}
              <span className="text-[#DFBC75]">{account.displayName}</span>
            </h2>
          </motion.div>

          <motion.form
            onSubmit={handleSearchSubmit}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.05, ease: SISCOM_EASE }}
            className="w-full md:w-[360px] lg:w-[400px] shrink-0"
          >
            <div className="siscom-liquid-pill flex items-center gap-2.5 h-11 px-3.5 rounded-xl focus-within:border-[#C9A961]/65 transition-colors">
              <Search className="w-4 h-4 text-[#95A49B] shrink-0" aria-hidden="true" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="O que você deseja fazer?"
                aria-label="Pesquisar funções do SISCOM"
                className="flex-1 min-w-0 bg-transparent text-sm text-[#EEF2EF] placeholder:text-[#7E8D84] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Limpar pesquisa"
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[#95A49B] hover:text-[#EEF2EF] hover:bg-white/[0.07] cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="submit"
                title="Abrir função"
                aria-label="Abrir função correspondente"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#B5C2BA] hover:text-[#E5C17B] hover:bg-white/[0.07] transition-colors cursor-pointer shrink-0"
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

        {/* Primary Focal Anchor: Tools Grid (2 cols mobile, 3 cols tablet, 4 cols desktop/landscape tablet) */}
        <motion.section
          aria-label="Ferramentas do SISCOM"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.05, ease: SISCOM_EASE }}
        >
          {visibleCards.length === 0 ? (
            <div className="siscom-home-panel rounded-xl py-12 px-4 text-center text-sm text-[#95A49B]">
              Nenhuma função liberada para este login no momento.
            </div>
          ) : filteredCards.length === 0 && !matchesDemandasQuery ? (
            <div className="siscom-home-panel rounded-xl py-12 px-4 text-center space-y-2.5">
              <p className="text-sm text-[#D8E0DB]">
                Nenhuma função encontrada para “{searchQuery}”.
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs font-medium text-[#DFBC75] hover:underline cursor-pointer"
              >
                Mostrar todas as ferramentas
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-3.5 lg:gap-4">
              {filteredCards.map((card, idx) => {
                const cardMotionProps = {
                  initial: { opacity: 0, y: 6 },
                  animate: { opacity: 1, y: 0 },
                  transition: {
                    duration: 0.18,
                    delay: 0.015 + idx * 0.018,
                    ease: SISCOM_EASE,
                  },
                  className:
                    'relative siscom-home-card group rounded-xl p-4 sm:p-5 flex flex-col items-center justify-center text-center gap-2.5 sm:gap-3 cursor-pointer min-h-[108px] sm:min-h-[118px] lg:min-h-[126px] will-change-transform no-underline',
                };

                const cardInner = (
                  <>
                    <motion.div
                      layoutId={`module-surface-${card.id}`}
                      transition={MODULE_EXPAND_TRANSITION}
                      className="absolute inset-0 rounded-xl pointer-events-none"
                    />

                    {card.externalUrl && (
                      <span
                        aria-hidden="true"
                        className="absolute top-2.5 right-2.5 z-10 text-[#78887E] group-hover:text-[#DFBC75] transition-colors duration-150"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </span>
                    )}

                    <motion.div
                      layoutId={`module-icon-${card.id}`}
                      transition={MODULE_LOCKUP_TRANSITION}
                      className="relative z-10 w-9 h-9 sm:w-10 sm:h-10 shrink-0 flex items-center justify-center text-[#D8B467] group-hover:text-[#F0D18A] transition-colors duration-150"
                    >
                      {card.renderIcon('w-7 h-7 sm:w-8 sm:h-8')}
                    </motion.div>

                    <div className="relative z-10 w-full min-w-0 px-1">
                      <motion.span
                        layoutId={`module-title-${card.id}`}
                        transition={MODULE_LOCKUP_TRANSITION}
                        className="block font-display text-[14.5px] sm:text-[16px] lg:text-[17px] font-semibold tracking-tight text-[#F1F5F2] group-hover:text-[#F7E9C8] transition-colors duration-150 leading-snug text-center"
                      >
                        {card.title}
                      </motion.span>
                    </div>
                  </>
                );

                if (card.externalUrl) {
                  return (
                    <motion.a
                      key={card.id}
                      href={card.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      {...cardMotionProps}
                    >
                      {cardInner}
                    </motion.a>
                  );
                }

                return (
                  <motion.button
                    key={card.id}
                    type="button"
                    onClick={() => onNavigate(card.id)}
                    {...cardMotionProps}
                  >
                    {cardInner}
                  </motion.button>
                );
              })}

              {/* Direct Demandas shortcut when searched */}
              {matchesDemandasQuery && (
                <motion.button
                  type="button"
                  onClick={() => setDemandasPanelOpen(true)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: SISCOM_EASE }}
                  className="relative siscom-home-card group rounded-xl p-4 sm:p-5 flex flex-col items-center justify-center text-center gap-2.5 sm:gap-3 cursor-pointer min-h-[108px] sm:min-h-[118px] lg:min-h-[126px] will-change-transform"
                >
                  <div className="relative z-10 w-9 h-9 sm:w-10 sm:h-10 shrink-0 flex items-center justify-center text-[#D8B467] group-hover:text-[#F0D18A]">
                    <ListTodo className="w-7 h-7 sm:w-8 sm:h-8" />
                  </div>
                  <div className="relative z-10 w-full min-w-0 px-1">
                    <span className="block font-display text-[14.5px] sm:text-[16px] lg:text-[17px] font-semibold tracking-tight text-[#F1F5F2] group-hover:text-[#F7E9C8] leading-snug text-center">
                      Demandas
                    </span>
                  </div>
                </motion.button>
              )}
            </div>
          )}
        </motion.section>

        {/* Quiet Secondary Strip: Agenda & Demandas */}
        <section
          aria-label="Agenda e Demandas"
          className="pt-4 sm:pt-5 border-t border-white/[0.08]"
        >
          <div
            className={`grid grid-cols-1 gap-3.5 lg:gap-4 items-stretch ${
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

      {/* Minimalist Liquid Glass Institutional Footer */}
      <footer className="no-print siscom-liquid-bar relative z-10 mt-auto border-t border-white/[0.1]">
        <div className="w-full max-w-[1320px] mx-auto px-4 sm:px-6 lg:px-8 pt-3.5 pb-24 md:py-3.5 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-[#95A49B]">
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
            <span aria-hidden="true" className="text-[#C9A961]/45">
              ·
            </span>
            <span>1º BI Mec (Es)</span>
          </div>

          <p className="italic text-[11.5px] text-[#B8B09C] text-center">
            “Sozinhos vamos mais rápido, mas juntos vamos mais longe.”
          </p>

          <div className="flex items-center gap-2 text-[#8C9A92]">
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

import React, { useEffect, useRef, useState } from 'react';
import { LayoutGroup, MotionConfig, motion } from 'motion/react';
import { ArrowLeft, LogOut, Shield } from 'lucide-react';
import { AdminPanel } from './components/AdminPanel';
import { AlteracaoGenerator } from './components/AlteracaoGenerator';
import { CartoesGenerator } from './components/CartoesGenerator';
import { CrachaGenerator } from './components/CrachaGenerator';
import { DocumentosVault } from './components/DocumentosVault';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FirstLoginOnboarding } from './components/FirstLoginOnboarding';
import { LoginScreen } from './components/LoginScreen';
import { OfflineIndicator, PWAInstallButton } from './components/PWAComponents';
import { PrismaGenerator } from './components/PrismaGenerator';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ModuleKey, isBootstrappedGoogleUser, signOutCurrentUser } from './lib/authService';

type ActiveScreen = 'home' | 'admin' | ModuleKey;
type ViewStage = 'boot' | 'login' | 'onboarding' | 'home' | 'module';

const CREST_LAYOUT_TRANSITION = {
  type: 'spring' as const,
  stiffness: 220,
  damping: 26,
  mass: 0.9,
};

const MODULE_EXPAND_TRANSITION = {
  duration: 0.34,
  ease: [0.22, 1, 0.36, 1] as const,
};

const MODULE_LOCKUP_TRANSITION = {
  duration: 0.36,
  ease: [0.22, 1, 0.36, 1] as const,
};

const MODULE_TITLES: Record<Exclude<ActiveScreen, 'home'>, string> = {
  prismas: 'Prismas',
  crachas: 'Crachás',
  alteracao: 'Alterações',
  documentos: 'Documentos',
  cartoes: 'Cartões',
  admin: 'Administração',
};

const VALID_SCREENS: ReadonlySet<ActiveScreen> = new Set([
  'home',
  'admin',
  'prismas',
  'crachas',
  'alteracao',
  'documentos',
  'cartoes',
]);

function getBaseUrlWithoutHash(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function getScreenFromHistoryOrHash(state: unknown): ActiveScreen {
  if (state && typeof state === 'object' && 'siscomScreen' in state) {
    const candidate = (state as { siscomScreen?: unknown }).siscomScreen;
    if (typeof candidate === 'string' && VALID_SCREENS.has(candidate as ActiveScreen)) {
      return candidate as ActiveScreen;
    }
  }
  const rawHash = window.location.hash.replace(/^#/, '').split('/')[0];
  if (rawHash && VALID_SCREENS.has(rawHash as ActiveScreen)) {
    return rawHash as ActiveScreen;
  }
  return 'home';
}

function getTimeGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

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

function renderModuleIcon(screen: Exclude<ActiveScreen, 'home'>, className: string) {
  switch (screen) {
    case 'prismas':
      return <PrismaSymbol className={className} />;
    case 'crachas':
      return <CrachaSymbol className={className} />;
    case 'alteracao':
      return <AlteracaoSymbol className={className} />;
    case 'documentos':
      return <DocumentosSymbol className={className} />;
    case 'cartoes':
      return <CartoesSymbol className={className} />;
    case 'admin':
      return <Shield className={className} />;
  }
}

interface LauncherCardItem {
  id: ModuleKey;
  title: string;
}

const LAUNCHER_CARDS: LauncherCardItem[] = [
  { id: 'prismas', title: 'Prismas' },
  { id: 'crachas', title: 'Crachás' },
  { id: 'alteracao', title: 'Alterações' },
  { id: 'documentos', title: 'Documentos' },
  { id: 'cartoes', title: 'Cartões' },
];

function WorkspaceShell() {
  const {
    firebaseUser,
    account,
    booting,
    loadingProfile,
    unauthorizedReason,
    hasModuleAccess,
  } = useAuth();
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('home');
  const [greeting, setGreeting] = useState<string>(() => getTimeGreeting());
  const [accessNotice, setAccessNotice] = useState<string | null>(null);

  // Track if the user came directly from Login (to spin the crest only on subsequent logins -> Home)
  const wasOnLoginRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setGreeting(getTimeGreeting());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Real-time access enforcement: immediately revoke open screen if Admin unchecks permission
  useEffect(() => {
    if (!account) {
      setActiveScreen('home');
      return;
    }
    if (activeScreen === 'admin' && account.role !== 'admin') {
      window.history.replaceState(
        { siscomScreen: 'home', siscomDepth: 0 },
        '',
        getBaseUrlWithoutHash()
      );
      setActiveScreen('home');
      return;
    }
    if (activeScreen !== 'home' && activeScreen !== 'admin' && !hasModuleAccess(activeScreen)) {
      setAccessNotice(`Acesso a ${MODULE_TITLES[activeScreen]} removido pelo administrador.`);
      window.history.replaceState(
        { siscomScreen: 'home', siscomDepth: 0 },
        '',
        getBaseUrlWithoutHash()
      );
      setActiveScreen('home');
    }
  }, [account, activeScreen, hasModuleAccess]);

  const needsFirstLoginSetup = Boolean(
    firebaseUser &&
      account &&
      !isBootstrappedGoogleUser(firebaseUser) &&
      (account.mustChangePassword === true || account.securityQuestionSetup === false)
  );

  let currentView: ViewStage = 'boot';
  if (booting) {
    currentView = 'boot';
  } else if (
    !firebaseUser ||
    loadingProfile ||
    !account ||
    !account.active ||
    unauthorizedReason
  ) {
    currentView = 'login';
  } else if (needsFirstLoginSetup) {
    currentView = 'onboarding';
  } else if (activeScreen === 'home') {
    currentView = 'home';
  } else {
    currentView = 'module';
  }

  const shouldSpinCrest = currentView === 'home' && wasOnLoginRef.current;

  useEffect(() => {
    if (currentView === 'login') {
      wasOnLoginRef.current = true;
    } else if (currentView === 'onboarding' || currentView === 'home' || currentView === 'module') {
      wasOnLoginRef.current = false;
    }
  }, [currentView]);

  // Anchor the Home screen in browser history so mobile back gesture stays inside the site
  useEffect(() => {
    if (currentView === 'home') {
      const state = window.history.state as { siscomScreen?: unknown } | null;
      if (state?.siscomScreen !== 'home' || window.location.hash) {
        window.history.replaceState(
          { siscomScreen: 'home', siscomDepth: 0 },
          '',
          getBaseUrlWithoutHash()
        );
      }
    }
  }, [currentView]);

  // Handle system/mobile back & forward gestures
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (!account || needsFirstLoginSetup) return;
      setAccessNotice(null);
      const target = getScreenFromHistoryOrHash(event.state);

      if (target === 'admin' && account.role !== 'admin') {
        window.history.replaceState(
          { siscomScreen: 'home', siscomDepth: 0 },
          '',
          getBaseUrlWithoutHash()
        );
        setActiveScreen('home');
        return;
      }
      if (target !== 'home' && target !== 'admin' && !hasModuleAccess(target)) {
        window.history.replaceState(
          { siscomScreen: 'home', siscomDepth: 0 },
          '',
          getBaseUrlWithoutHash()
        );
        setActiveScreen('home');
        return;
      }

      setActiveScreen(target);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [account, needsFirstLoginSetup, hasModuleAccess]);

  const navigateBackToHome = () => {
    setAccessNotice(null);
    const state = window.history.state as { siscomDepth?: unknown } | null;
    if (typeof state?.siscomDepth === 'number' && state.siscomDepth > 0) {
      window.history.back();
      return;
    }
    window.history.replaceState(
      { siscomScreen: 'home', siscomDepth: 0 },
      '',
      getBaseUrlWithoutHash()
    );
    setActiveScreen('home');
  };

  const navigateToScreen = (target: ActiveScreen) => {
    setAccessNotice(null);
    if (target === activeScreen) return;
    if (target === 'home') {
      navigateBackToHome();
      return;
    }
    window.history.pushState(
      { siscomScreen: target, siscomDepth: 1 },
      '',
      `${getBaseUrlWithoutHash()}#${target}`
    );
    setActiveScreen(target);
  };

  if (currentView === 'boot') {
    return (
      <div className="min-h-screen bg-[#0B0E0D] text-[#E4EAE6] flex flex-col items-center justify-center gap-3">
        <motion.div layoutId="siscom-crest" className="w-16 h-16 flex items-center justify-center">
          <img
            src="/assets/logo_arma_comunicacoes.png"
            alt="SISCOM"
            className="w-full h-full object-contain opacity-90"
          />
        </motion.div>
        <span className="font-mono text-xs text-[#98A89F]">Carregando...</span>
      </div>
    );
  }

  if (currentView === 'login') {
    return (
      <LoginScreen
        unauthorizedReason={unauthorizedReason}
        hasFirebaseUser={Boolean(firebaseUser)}
        isLoadingProfile={loadingProfile}
      />
    );
  }

  if (currentView === 'onboarding' && firebaseUser && account) {
    return <FirstLoginOnboarding user={firebaseUser} account={account} />;
  }

  if (!account) {
    return null;
  }

  const visibleCards = LAUNCHER_CARDS.filter((card) => hasModuleAccess(card.id));

  return (
    <div className="min-h-screen bg-[#0B0E0D] text-[#E4EAE6] flex flex-col relative">
      {/* Expanding backdrop surface when opening a module */}
      {activeScreen !== 'home' && (
        <motion.div
          layoutId={`module-surface-${activeScreen}`}
          transition={MODULE_EXPAND_TRANSITION}
          className="no-print fixed inset-0 bg-[#0B0E0D] pointer-events-none z-0"
        />
      )}

      {/* Minimalist Top Bar */}
      {activeScreen !== 'home' ? (
        <header className="no-print relative z-10 h-14 px-4 sm:px-6 border-b border-[#C29B56]/20 bg-[#101513]/95 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center justify-start"
          >
            <button
              type="button"
              onClick={navigateBackToHome}
              className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-[#C29B56]/25 bg-[#161D1A] hover:bg-[#1E2824] hover:border-[#C29B56]/45 px-3 text-xs sm:text-sm font-medium text-[#E4EAE6] transition-colors whitespace-nowrap"
            >
              <ArrowLeft className="w-4 h-4 text-[#C8A461]" />
              <span>Voltar</span>
            </button>
          </motion.div>

          <div className="inline-flex items-center justify-center gap-2.5 min-w-0">
            <motion.div
              layoutId={`module-icon-${activeScreen}`}
              transition={MODULE_LOCKUP_TRANSITION}
              className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 rounded-[7px] bg-[#0B110E]/90 border border-[#C29B56]/35 flex items-center justify-center text-[#C8A461]"
            >
              {renderModuleIcon(activeScreen, 'w-4 h-4 sm:w-[18px] sm:h-[18px]')}
            </motion.div>
            <motion.h1
              layoutId={`module-title-${activeScreen}`}
              transition={MODULE_LOCKUP_TRANSITION}
              className="font-display text-sm sm:text-base font-semibold tracking-wide text-[#F4E6C4] truncate whitespace-nowrap"
            >
              {MODULE_TITLES[activeScreen]}
            </motion.h1>
          </div>

          <div />
        </header>
      ) : (
        <motion.header
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="no-print relative z-10 h-14 px-4 sm:px-6 flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            {account.role === 'admin' && (
              <button
                type="button"
                onClick={() => navigateToScreen('admin')}
                className="relative min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-[#C29B56]/30 bg-[#161D1A] hover:bg-[#1E2824] hover:border-[#C29B56]/55 px-3 text-xs font-medium text-[#E5C17B] transition-colors"
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
                  <Shield className="w-3.5 h-3.5" />
                </motion.div>
                <motion.span
                  layoutId="module-title-admin"
                  transition={MODULE_LOCKUP_TRANSITION}
                  className="relative z-10 whitespace-nowrap"
                >
                  Administração
                </motion.span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <PWAInstallButton compact />
            <span className="hidden sm:inline text-xs text-[#98A89F]">
              {account.displayName}
            </span>
            <button
              type="button"
              onClick={() => void signOutCurrentUser()}
              title="Sair"
              className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#161D1A] hover:bg-[#1E2824] px-2.5 text-xs text-[#C6D4CC] transition-colors"
            >
              <LogOut className="w-3.5 h-3.5 text-[#98A89F]" />
              <span>Sair</span>
            </button>
          </div>
        </motion.header>
      )}

      {/* Home Launcher */}
      {activeScreen === 'home' && (
        <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pt-2 pb-12">
          <div className="w-full max-w-[540px] flex flex-col items-center space-y-7 sm:space-y-8">
            <div className="flex flex-col items-center text-center space-y-2.5">
              <motion.div
                layoutId="siscom-crest"
                transition={CREST_LAYOUT_TRANSITION}
                className="w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center"
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

              <motion.h1
                layoutId="siscom-wordmark"
                transition={CREST_LAYOUT_TRANSITION}
                className="metallic-wordmark font-display text-2xl sm:text-3xl font-bold tracking-[0.22em] pl-[0.22em] uppercase"
              >
                SISCOM
              </motion.h1>

              <motion.div
                layoutId="siscom-divider"
                transition={CREST_LAYOUT_TRANSITION}
                className="w-14 h-[1.5px] bg-gradient-to-r from-transparent via-[#C29B56]/75 to-transparent"
              />

              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
                className="text-sm sm:text-base font-medium text-[#C5D1CA] pt-0.5"
              >
                {greeting}, {account.displayName}
              </motion.p>
            </div>

            {accessNotice && (
              <p className="text-xs text-[#E5C17B] bg-[#1B1913] border border-[#C29B56]/35 rounded-lg px-3.5 py-2 text-center">
                {accessNotice}
              </p>
            )}

            {visibleCards.length === 0 ? (
              <div className="metal-surface rounded-xl px-6 py-5 text-center text-sm text-[#98A89F]">
                Nenhuma função liberada para este login no momento.
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5 sm:gap-4 w-full max-w-[360px] md:max-w-[540px]">
                {visibleCards.map((card, idx) => (
                  <motion.button
                    key={card.id}
                    type="button"
                    onClick={() => navigateToScreen(card.id)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.22,
                      delay: 0.06 + idx * 0.035,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    className="relative tactical-plate group aspect-square w-full rounded-[10px] p-3 sm:p-4 flex flex-col items-center justify-center gap-3 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C29B56] cursor-pointer"
                  >
                    <motion.div
                      layoutId={`module-surface-${card.id}`}
                      transition={MODULE_EXPAND_TRANSITION}
                      className="absolute inset-0 rounded-[10px] pointer-events-none"
                    />

                    <motion.div
                      layoutId={`module-icon-${card.id}`}
                      transition={MODULE_LOCKUP_TRANSITION}
                      className="relative z-10 w-14 h-14 sm:w-16 sm:h-16 rounded-[10px] bg-[#0B110E]/85 border border-[#C29B56]/25 group-hover:border-[#D4B06A]/60 flex items-center justify-center text-[#C8A461] group-hover:text-[#E5C98E] transition-colors"
                    >
                      {renderModuleIcon(card.id, 'w-10 h-10 sm:w-11 sm:h-11')}
                    </motion.div>

                    <motion.span
                      layoutId={`module-title-${card.id}`}
                      transition={MODULE_LOCKUP_TRANSITION}
                      className="relative z-10 block font-display text-base sm:text-lg font-semibold tracking-tight text-[#E4EAE6] group-hover:text-[#F4E6C4] transition-colors whitespace-nowrap"
                    >
                      {card.title}
                    </motion.span>
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        </main>
      )}

      {/* Active Module View */}
      {activeScreen !== 'home' && (
        <motion.div
          key={activeScreen}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex-1 flex flex-col"
        >
          {activeScreen === 'prismas' && hasModuleAccess('prismas') && <PrismaGenerator />}
          {activeScreen === 'crachas' && hasModuleAccess('crachas') && <CrachaGenerator />}
          {activeScreen === 'alteracao' && hasModuleAccess('alteracao') && <AlteracaoGenerator />}
          {activeScreen === 'documentos' && hasModuleAccess('documentos') && <DocumentosVault />}
          {activeScreen === 'cartoes' && hasModuleAccess('cartoes') && <CartoesGenerator />}
          {activeScreen === 'admin' && account.role === 'admin' && <AdminPanel />}
        </motion.div>
      )}

      <div className="no-print relative z-10">
        <OfflineIndicator />
      </div>
    </div>
  );
}

export default function App() {
  const [resetKey, setResetKey] = useState(0);

  return (
    <ErrorBoundary key={resetKey} onReset={() => setResetKey((k) => k + 1)}>
      <MotionConfig reducedMotion="user">
        <LayoutGroup>
          <AuthProvider>
            <WorkspaceShell />
          </AuthProvider>
        </LayoutGroup>
      </MotionConfig>
    </ErrorBoundary>
  );
}

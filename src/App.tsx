import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { ErrorBoundary } from './core/ErrorBoundary';
import { HomeDashboard } from './core/HomeDashboard';
import { AuthProvider, useAuth } from './core/auth/AuthContext';
import { FirstLoginOnboarding } from './core/auth/FirstLoginOnboarding';
import { LoginScreen } from './core/auth/LoginScreen';
import { isBootstrappedGoogleUser } from './core/auth/authService';
import { PrivacyShieldModal } from './core/privacy/PrivacyShieldModal';
import {
  hydratePrivacyVaultForUser,
  purgeAllSensitiveLocalData,
} from './core/privacy/privacyVault';
import { OfflineIndicator } from './core/pwa/PWAComponents';
import {
  ActiveScreen,
  FEATURE_MODULES,
  VALID_SCREENS,
  getScreenTitle,
  renderScreenContent,
  renderScreenIcon,
} from './modules/registry';
import { DemandasProvider } from './modules/demandas/DemandasContext';
import { DemandasFloatingQuickAdd } from './modules/demandas/DemandasFloatingQuickAdd';
import { DemandasNotificationToasts } from './modules/demandas/DemandasNotificationToasts';
import { DemandasPanelModal } from './modules/demandas/DemandasPanelModal';
import {
  CREST_LAYOUT_TRANSITION,
  MODULE_EXPAND_TRANSITION,
  MODULE_LOCKUP_TRANSITION,
  SISCOM_EASE,
} from './shared/motion';
import { OperationalBackdrop } from './shared/OperationalBackdrop';
import { SiscomSpinner } from './shared/ui';

type ViewStage = 'boot' | 'login' | 'onboarding' | 'home' | 'module';

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
  const [moduleResetTick, setModuleResetTick] = useState<number>(0);
  const [greeting, setGreeting] = useState<string>(() => getTimeGreeting());
  const [accessNotice, setAccessNotice] = useState<string | null>(null);
  const [vaultHydratedUid, setVaultHydratedUid] = useState<string | null>(null);
  const [shieldLocked, setShieldLocked] = useState<boolean>(false);
  const [shieldReason, setShieldReason] = useState<'manual' | 'idle'>('manual');
  const [idleMinutes] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('siscom_pref_autolock_min');
      if (saved !== null) {
        const parsed = Number(saved);
        if (parsed === 0 || parsed === 5 || parsed === 15 || parsed === 30) {
          return parsed;
        }
      }
    } catch {
      // Ignore storage errors
    }
    return 15;
  });

  // Track if the user came directly from Login (to spin the crest only on subsequent logins -> Home)
  const wasOnLoginRef = useRef(false);

  // Hydrate encrypted local vault strictly for authenticated & active user; purge immediately on sign-out or deactivation
  useEffect(() => {
    let cancelled = false;
    if (!firebaseUser || !account || !account.active || unauthorizedReason) {
      purgeAllSensitiveLocalData();
      setVaultHydratedUid(null);
      setShieldLocked(false);
      return;
    }

    const uid = account.uid;
    if (vaultHydratedUid === uid) return;

    void hydratePrivacyVaultForUser(uid).then(() => {
      if (!cancelled) {
        setVaultHydratedUid(uid);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [firebaseUser, account, unauthorizedReason, vaultHydratedUid]);

  // Global keyboard shortcut (Ctrl+Shift+L) to instantly shield classified screens
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        if (firebaseUser && account && account.active && !unauthorizedReason) {
          e.preventDefault();
          setShieldReason('manual');
          setShieldLocked(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [firebaseUser, account, unauthorizedReason]);

  // Idle auto-lock timer
  useEffect(() => {
    if (
      !firebaseUser ||
      !account ||
      !account.active ||
      unauthorizedReason ||
      idleMinutes <= 0 ||
      shieldLocked
    ) {
      return;
    }

    let timerId = 0;
    const timeoutMs = idleMinutes * 60_000;
    const resetTimer = () => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        setShieldReason('idle');
        setShieldLocked(true);
      }, timeoutMs);
    };

    resetTimer();
    const events: (keyof WindowEventMap)[] = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'scroll',
    ];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));

    return () => {
      window.clearTimeout(timerId);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [firebaseUser, account, unauthorizedReason, idleMinutes, shieldLocked]);

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
      setAccessNotice(`Acesso a ${getScreenTitle(activeScreen)} removido pelo administrador.`);
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

  const isVaultReady = Boolean(account && vaultHydratedUid === account.uid);

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
  } else if (!isVaultReady) {
    currentView = 'boot';
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
      <div className="min-h-screen bg-[#080B09] text-[#E4EAE6] flex flex-col items-center justify-center gap-4 relative">
        <OperationalBackdrop mode="auth" />
        <motion.div
          layoutId="siscom-crest"
          transition={CREST_LAYOUT_TRANSITION}
          className="relative z-10 w-16 h-16 flex items-center justify-center"
        >
          <img
            src="/assets/logo_arma_comunicacoes.png"
            alt="SISCOM"
            className="w-full h-full object-contain opacity-95"
          />
        </motion.div>
        <div className="relative z-10 inline-flex items-center gap-2 text-xs text-[#B8B3A6]">
          <SiscomSpinner className="w-3.5 h-3.5" tone="gold" />
          <span className="font-mono tracking-wide">Carregando...</span>
        </div>
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

  const visibleCards = FEATURE_MODULES.filter((mod) => hasModuleAccess(mod.id));

  return (
    <DemandasProvider userId={account.uid}>
    <div
      className={`workspace-shell-root min-h-screen bg-[#080B09] text-[#E4EAE6] flex flex-col relative selection:bg-[#2D5A43]/55 selection:text-[#F4E6C4] ${
        activeScreen !== 'home' ? 'lg:h-screen lg:overflow-hidden' : ''
      }`}
    >
      {/* Persistent Operational Backdrop for all internal module views */}
      {activeScreen !== 'home' && <OperationalBackdrop mode="workspace" />}

      {/* Expanding translucent surface transition when opening a module */}
      {activeScreen !== 'home' && (
        <motion.div
          layoutId={`module-surface-${activeScreen}`}
          transition={MODULE_EXPAND_TRANSITION}
          className="no-print fixed inset-0 bg-[#080B09]/25 pointer-events-none z-0"
        />
      )}

      {/* Liquid Glass Top Bar (Module Views) */}
      {activeScreen !== 'home' && (
        <header className="no-print siscom-liquid-bar sticky top-0 z-30 h-14 shrink-0 px-3.5 sm:px-6 border-b border-white/[0.11] grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: 0.04, ease: SISCOM_EASE }}
            className="flex items-center justify-start"
          >
            <button
              type="button"
              onClick={navigateBackToHome}
              className="siscom-btn siscom-btn-secondary !min-h-[38px] !px-3 text-xs sm:text-sm !border-[#C9A961]/28 hover:!border-[#C9A961]/55"
            >
              <ArrowLeft className="w-4 h-4 text-[#C9A961] shrink-0" />
              <span>Voltar</span>
            </button>
          </motion.div>

          <div className="inline-flex items-center justify-center gap-2.5 min-w-0">
            <motion.div
              layoutId={`module-icon-${activeScreen}`}
              transition={MODULE_LOCKUP_TRANSITION}
              className="w-8 h-8 shrink-0 rounded-[9px] bg-[#0E1813]/65 backdrop-blur-md border border-[#C9A961]/38 flex items-center justify-center text-[#DFBC75] shadow-[inset_0_1px_0.5px_rgba(255,250,236,0.22)]"
            >
              {renderScreenIcon(activeScreen, 'w-4 h-4 sm:w-[18px] sm:h-[18px]')}
            </motion.div>
            <motion.h1
              layoutId={`module-title-${activeScreen}`}
              transition={MODULE_LOCKUP_TRANSITION}
              className="font-display text-sm sm:text-base font-semibold tracking-wide text-[#F4E6C4] truncate whitespace-nowrap drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
            >
              {getScreenTitle(activeScreen)}
            </motion.h1>
          </div>

          <div className="flex items-center justify-end" />
        </header>
      )}

      {/* Home Dashboard */}
      {activeScreen === 'home' && (
        <HomeDashboard
          account={account}
          greeting={greeting}
          shouldSpinCrest={shouldSpinCrest}
          visibleCards={visibleCards}
          hasAgendaAccess={hasModuleAccess('agenda')}
          accessNotice={accessNotice}
          onDismissAccessNotice={() => setAccessNotice(null)}
          onNavigate={navigateToScreen}
        />
      )}

      {/* Active Module View (each feature isolated inside its own ErrorBoundary) */}
      <AnimatePresence mode="wait">
        {activeScreen !== 'home' &&
          (activeScreen === 'admin' ? account.role === 'admin' : hasModuleAccess(activeScreen)) && (
            <motion.div
              key={activeScreen}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.24, ease: SISCOM_EASE }}
              className="workspace-split-container relative z-10 flex-1 flex flex-col min-h-0 lg:overflow-hidden"
            >
              <ErrorBoundary
                key={`${activeScreen}-${moduleResetTick}`}
                inline
                scopeLabel={getScreenTitle(activeScreen)}
                onReset={() => setModuleResetTick((tick) => tick + 1)}
              >
                {renderScreenContent(activeScreen)}
              </ErrorBoundary>
            </motion.div>
          )}
      </AnimatePresence>

      <div className="no-print relative z-10">
        <OfflineIndicator />
      </div>

      {!shieldLocked && (
        <>
          <DemandasNotificationToasts />
          <DemandasFloatingQuickAdd
            activeScreen={activeScreen}
            canAccessAgenda={hasModuleAccess('agenda')}
            canAccessCrachas={hasModuleAccess('crachas')}
            onNavigate={navigateToScreen}
          />
          <DemandasPanelModal />
        </>
      )}

      {firebaseUser && (
        <PrivacyShieldModal
          open={shieldLocked}
          reason={shieldReason}
          user={firebaseUser}
          account={account}
          onUnlock={() => setShieldLocked(false)}
        />
      )}
    </div>
    </DemandasProvider>
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

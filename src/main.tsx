import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import {
  clearAllPwaCaches,
  forceDeviceUpdate,
  setActiveSwRegistration,
  startAutomaticVersionSync,
  stripVersionBustParam,
} from './core/pwa/versionSync';

const BROWSER_SESSION_FLAG = 'siscom_browser_session_v1';

// Register PWA service worker with session-scoped cache cleanup and automatic forced updates across all devices
if (typeof window !== 'undefined') {
  stripVersionBustParam();

  try {
    if (!window.sessionStorage.getItem(BROWSER_SESSION_FLAG)) {
      window.sessionStorage.setItem(BROWSER_SESSION_FLAG, '1');
      void clearAllPwaCaches();
    }
  } catch {
    // ignore sessionStorage restrictions
  }

  window.addEventListener('pagehide', () => {
    void clearAllPwaCaches();
  });
  window.addEventListener('beforeunload', () => {
    void clearAllPwaCaches();
  });

  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      void forceDeviceUpdate(`sw-${Date.now()}`);
    });

    registerSW({
      immediate: true,
      onNeedRefresh() {
        void forceDeviceUpdate(`sw-refresh-${Date.now()}`);
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        setActiveSwRegistration(registration);
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage({ type: 'SKIP_WAITING' });
              void forceDeviceUpdate(`sw-installed-${Date.now()}`);
            }
          });
        });
      },
      onRegisterError() {
        // Self-healing: continue normally in browser mode if SW registration is blocked
      },
    });
  }

  startAutomaticVersionSync();
}

createRoot(document.getElementById('root')!).render(<App />);

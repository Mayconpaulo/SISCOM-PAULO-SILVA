import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import {
  forceDeviceUpdate,
  setActiveSwRegistration,
  startAutomaticVersionSync,
  stripVersionBustParam,
} from './core/pwa/versionSync';

// Register PWA service worker with clean automatic updates across devices (preserving offline cache & Web Push)
if (typeof window !== 'undefined') {
  stripVersionBustParam();

  if ('serviceWorker' in navigator) {
    registerSW({
      immediate: true,
      onNeedRefresh() {
        void forceDeviceUpdate('sw-refresh');
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        setActiveSwRegistration(registration);
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      },
      onRegisterError() {
        // Self-healing: continue normally in browser mode if SW registration is blocked
      },
    });
  }

  startAutomaticVersionSync();
}

createRoot(document.getElementById('root')!).render(<App />);

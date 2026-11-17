import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register PWA service worker with self-healing update & offline readiness
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        registration.update().catch(() => {
          // ignore transient offline update checks
        });
      }
    },
    onRegisterError() {
      // Self-healing: continue normally in browser mode if SW registration is blocked
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);

import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) {
        setShowGuide(true);
      }
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title="Instalar SISCOM como aplicativo"
        className={`min-h-[40px] inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#181F1C] hover:bg-[#212A26] text-[#E4EAE6] transition-colors whitespace-nowrap shrink-0 ${
          compact ? 'px-3 py-2 text-xs font-medium' : 'w-full px-3.5 py-2 text-xs font-medium'
        }`}
      >
        {isIOS ? <Smartphone className="w-4 h-4 text-[#C8A461] shrink-0" /> : <Download className="w-4 h-4 text-[#C8A461] shrink-0" />}
        <span>Instalar</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
        >
          <div className="metal-elevated w-full max-w-sm rounded-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2 id="pwa-guide-title" className="font-display text-base font-semibold text-[#E4EAE6]">
                Instalar SISCOM
              </h2>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#98A89F] hover:text-[#E4EAE6] hover:bg-white/5"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2 text-sm text-[#C6D4CC]">
                <li>1. Toque em Compartilhar no Safari.</li>
                <li>2. Selecione Adicionar à Tela de Início.</li>
                <li>3. Confirme em Adicionar.</li>
              </ol>
            ) : (
              <ol className="space-y-2 text-sm text-[#C6D4CC]">
                <li>1. Abra o menu do navegador.</li>
                <li>2. Selecione Instalar SISCOM ou Adicionar à tela inicial.</li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[42px] rounded-lg bg-[#2D5A43] hover:bg-[#376C51] text-sm font-medium text-white transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-4 left-4 z-40 flex items-center gap-2 rounded-lg bg-[#262015] border border-[#B8862D]/50 px-3 py-2 text-xs font-medium text-[#E8C57B] shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline</span>
    </div>
  );
};

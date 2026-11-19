import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Smartphone, WifiOff } from 'lucide-react';
import { usePWAInstall } from './usePWAInstall';
import { useOnlineStatus } from './useOnlineStatus';
import { SiscomModal } from '../../shared/ui';
import { SISCOM_EASE } from '../../shared/motion';

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
        className={`siscom-btn siscom-btn-secondary !min-h-[38px] text-xs shrink-0 ${
          compact ? '!px-3' : 'w-full !px-3.5'
        }`}
      >
        {isIOS ? (
          <Smartphone className="w-4 h-4 text-[#C8A461] shrink-0" />
        ) : (
          <Download className="w-4 h-4 text-[#C8A461] shrink-0" />
        )}
        <span>Instalar</span>
      </button>

      <SiscomModal
        open={showGuide}
        onClose={() => setShowGuide(false)}
        title="Instalar SISCOM"
        labelledBy="pwa-guide-title"
        maxWidthClass="max-w-sm"
      >
        {isIOS ? (
          <ol className="space-y-2.5 text-sm text-[#C6D4CC] leading-relaxed">
            <li>1. Toque em Compartilhar no Safari.</li>
            <li>2. Selecione Adicionar à Tela de Início.</li>
            <li>3. Confirme em Adicionar.</li>
          </ol>
        ) : (
          <ol className="space-y-2.5 text-sm text-[#C6D4CC] leading-relaxed">
            <li>1. Abra o menu do navegador.</li>
            <li>2. Selecione Instalar SISCOM ou Adicionar à tela inicial.</li>
          </ol>
        )}

        <button
          type="button"
          onClick={() => setShowGuide(false)}
          className="w-full siscom-btn siscom-btn-primary !min-h-[44px] text-sm"
        >
          Fechar
        </button>
      </SiscomModal>
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.22, ease: SISCOM_EASE }}
          className="fixed bottom-20 md:bottom-4 left-4 z-40 flex items-center gap-2 rounded-lg bg-[#221D12]/95 backdrop-blur-md border border-[#C29B56]/45 px-3.5 py-2 text-xs font-medium text-[#F0D69A] shadow-xl"
        >
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>Modo offline</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ErrorBoundary } from '../../core/ErrorBoundary';
import { getSecureVaultItem, setSecureVaultItem } from '../../core/privacy/privacyVault';
import { fadeSlideVariants } from '../../shared/motion';
import { AniversarioCardWorkspace } from './aniversario/AniversarioCardWorkspace';
import { BoasVindasWorkspace } from './boasVindas/BoasVindasWorkspace';
import { PesamesCardWorkspace } from './pesames/PesamesCardWorkspace';
import type { CartaoModel } from './shared/cartoesAssets';

const STORAGE_KEY = 'siscom_cartoes_state_v1';

function loadInitialModel(): CartaoModel {
  try {
    const raw = getSecureVaultItem(STORAGE_KEY);
    if (!raw) return 'boas_vindas';
    const parsed = JSON.parse(raw) as { model?: unknown };
    if (parsed.model === 'aniversario' || parsed.model === 'pesames') {
      return parsed.model;
    }
  } catch {
    // Ignore storage read errors
  }
  return 'boas_vindas';
}

function persistSelectedModel(model: CartaoModel): void {
  try {
    const raw = getSecureVaultItem(STORAGE_KEY);
    const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    setSecureVaultItem(STORAGE_KEY, JSON.stringify({ ...existing, model }));
  } catch {
    // Ignore storage errors
  }
}

export interface CartoesGeneratorProps {
  externalDownloadSignal?: number;
}

export const CartoesGenerator: React.FC<CartoesGeneratorProps> = ({
  externalDownloadSignal = 0,
}) => {
  const [model, setModel] = useState<CartaoModel>(() => loadInitialModel());
  const [boasVindasDownloadSignal, setBoasVindasDownloadSignal] = useState<number>(0);
  const [anivDownloadSignal, setAnivDownloadSignal] = useState<number>(0);
  const [pesamesDownloadSignal, setPesamesDownloadSignal] = useState<number>(0);

  useEffect(() => {
    persistSelectedModel(model);
  }, [model]);

  useEffect(() => {
    const handlePurged = () => {
      setModel('boas_vindas');
    };
    window.addEventListener('siscom:vault-purged', handlePurged);
    return () => window.removeEventListener('siscom:vault-purged', handlePurged);
  }, []);

  useEffect(() => {
    if (externalDownloadSignal <= 0) return;
    if (model === 'boas_vindas') {
      setBoasVindasDownloadSignal((prev) => prev + 1);
    } else if (model === 'aniversario') {
      setAnivDownloadSignal((prev) => prev + 1);
    } else {
      setPesamesDownloadSignal((prev) => prev + 1);
    }
  }, [externalDownloadSignal, model]);

  return (
    <AnimatePresence mode="wait">
      {model === 'aniversario' ? (
        <motion.div
          key="cartao-aniversario"
          variants={fadeSlideVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="workspace-split-container flex-1 min-h-0 lg:h-full lg:overflow-hidden flex flex-col"
        >
          <ErrorBoundary inline scopeLabel="Cartão de Aniversário">
            <AniversarioCardWorkspace
              onSwitchToBoasVindas={() => setModel('boas_vindas')}
              onSwitchToPesames={() => setModel('pesames')}
              externalDownloadSignal={anivDownloadSignal}
            />
          </ErrorBoundary>
        </motion.div>
      ) : model === 'pesames' ? (
        <motion.div
          key="cartao-pesames"
          variants={fadeSlideVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="workspace-split-container flex-1 min-h-0 lg:h-full lg:overflow-hidden flex flex-col"
        >
          <ErrorBoundary inline scopeLabel="Cartão de Pêsames">
            <PesamesCardWorkspace
              onSwitchToBoasVindas={() => setModel('boas_vindas')}
              onSwitchToAniversario={() => setModel('aniversario')}
              externalDownloadSignal={pesamesDownloadSignal}
            />
          </ErrorBoundary>
        </motion.div>
      ) : (
        <motion.div
          key="cartao-boas-vindas"
          variants={fadeSlideVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="workspace-split-container flex-1 min-h-0 lg:h-full lg:overflow-hidden flex flex-col"
        >
          <ErrorBoundary inline scopeLabel="Cartão de Boas-Vindas">
            <BoasVindasWorkspace
              onSwitchToAniversario={() => setModel('aniversario')}
              onSwitchToPesames={() => setModel('pesames')}
              externalDownloadSignal={boasVindasDownloadSignal}
            />
          </ErrorBoundary>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

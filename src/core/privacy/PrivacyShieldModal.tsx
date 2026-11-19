import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Clock,
  Eraser,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  ShieldCheck,
  ShieldOff,
  Unlock,
} from 'lucide-react';
import {
  formatAuthErrorPtBr,
  isBootstrappedGoogleUser,
  reauthenticateActiveUser,
  signOutCurrentUser,
  type UserAccount,
} from '../auth/authService';
import { purgeAllSensitiveLocalData } from './privacyVault';
import { type User } from 'firebase/auth';
import { modalBackdropVariants, modalPanelVariants } from '../../shared/motion';
import { SiscomAlert, SiscomSpinner } from '../../shared/ui';

export interface PrivacyShieldModalProps {
  open: boolean;
  reason: 'manual' | 'idle';
  user: User;
  account: UserAccount;
  onUnlock: () => void;
}

export const PrivacyShieldModal: React.FC<PrivacyShieldModalProps> = ({
  open,
  reason,
  user,
  account,
  onUnlock,
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isGoogleSession =
    isBootstrappedGoogleUser(user) ||
    (user.providerData.some((p) => p.providerId === 'google.com') &&
      !user.email?.endsWith('@siscom.app'));

  useEffect(() => {
    if (!open) {
      setPassword('');
      setShowPassword(false);
      setErrorMsg(null);
      setBusy(false);
    }
  }, [open]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBusy(true);
    try {
      await reauthenticateActiveUser(isGoogleSession ? undefined : password);
      setPassword('');
      onUnlock();
    } catch (err) {
      setErrorMsg(formatAuthErrorPtBr(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePanicLogout = async () => {
    setBusy(true);
    try {
      purgeAllSensitiveLocalData();
      await signOutCurrentUser();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="privacy-shield-title"
          variants={modalBackdropVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="no-print fixed inset-0 z-[9999] bg-[#070A09]/96 backdrop-blur-xl flex flex-col items-center justify-center px-4 py-8"
        >
          <motion.div
            variants={modalPanelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="w-full max-w-[400px] metal-elevated rounded-2xl p-6 space-y-5 border border-[#C29B56]/30 shadow-2xl"
          >
            <div className="flex flex-col items-center text-center space-y-2.5">
              <div className="w-12 h-12 rounded-xl bg-[#141C18] border border-[#C29B56]/35 flex items-center justify-center text-[#E5C17B]">
                <Lock className="w-5 h-5" />
              </div>
              <h2
                id="privacy-shield-title"
                className="font-display text-lg font-semibold text-[#F4E6C4]"
              >
                Tela Protegida
              </h2>
              <p className="text-xs text-[#98A89F] leading-relaxed">
                {reason === 'idle'
                  ? `Sessão de ${account.displayName} bloqueada automaticamente por inatividade para proteger documentos sigilosos.`
                  : `Conteúdo sigiloso ocultado (${account.displayName}). Confirme sua identidade para continuar.`}
              </p>
            </div>

            <form onSubmit={handleUnlock} className="space-y-4">
              {!isGoogleSession && (
                <div className="space-y-1.5">
                  <label htmlFor="shield-password" className="siscom-field-label">
                    Senha de acesso (@{account.username})
                  </label>
                  <div className="relative">
                    <input
                      id="shield-password"
                      type={showPassword ? 'text' : 'password'}
                      autoFocus
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Digite sua senha"
                      className="siscom-input !pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-[#E4EAE6] transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              <AnimatePresence>
                {errorMsg && <SiscomAlert tone="error">{errorMsg}</SiscomAlert>}
              </AnimatePresence>

              <button
                type="submit"
                disabled={busy}
                className="w-full siscom-btn siscom-btn-primary !min-h-[44px] text-sm"
              >
                {busy ? <SiscomSpinner className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                <span>
                  {busy
                    ? 'Validando...'
                    : isGoogleSession
                      ? 'Confirmar com Google'
                      : 'Desbloquear tela'}
                </span>
              </button>
            </form>

            <div className="pt-3 border-t border-white/8">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handlePanicLogout()}
                className="w-full siscom-btn siscom-btn-danger !min-h-[40px] text-xs"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sair e apagar rastros locais</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export interface PrivacyControlsButtonProps {
  idleMinutes: number;
  onChangeIdleMinutes: (minutes: number) => void;
  onLockNow: () => void;
  onWipeLocalTraces: () => void;
}

export const PrivacyControlsButton: React.FC<PrivacyControlsButtonProps> = ({
  idleMinutes,
  onChangeIdleMinutes,
  onLockNow,
  onWipeLocalTraces,
}) => {
  const [open, setOpen] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wipedFeedback, setWipedFeedback] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setConfirmWipe(false);
      return;
    }
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Privacidade e proteção sigilosa (Ctrl+Shift+L para bloquear)"
        className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-[#C29B56]/30 bg-[#161D1A] hover:bg-[#1E2824] hover:border-[#C29B56]/55 px-2.5 text-xs font-medium text-[#E5C17B] transition-colors"
      >
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Privacidade</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-[#C29B56]/35 bg-[#101513] shadow-2xl p-3.5 space-y-3 z-50">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="text-xs font-semibold text-[#F4E6C4] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#C8A461]" />
              <span>Escudo de Privacidade</span>
            </span>
            <span className="font-mono text-[10px] text-[#83B499]">AES-256-GCM</span>
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onLockNow();
            }}
            className="w-full min-h-[38px] inline-flex items-center justify-between gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] px-3 text-xs font-medium text-white transition-colors"
          >
            <span className="inline-flex items-center gap-1.5">
              <ShieldOff className="w-3.5 h-3.5" />
              <span>Ocultar tela agora</span>
            </span>
            <span className="font-mono text-[10px] opacity-80">Ctrl+Shift+L</span>
          </button>

          <div className="space-y-1.5">
            <label
              htmlFor="siscom-autolock-select"
              className="flex items-center gap-1.5 text-[11px] text-[#98A89F]"
            >
              <Clock className="w-3 h-3 text-[#C8A461]" />
              <span>Bloqueio automático por inatividade</span>
            </label>
            <select
              id="siscom-autolock-select"
              value={idleMinutes}
              onChange={(e) => onChangeIdleMinutes(Number(e.target.value))}
              className="w-full h-8 rounded-lg bg-[#0B0E0D] border border-white/12 px-2.5 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#C29B56]"
            >
              <option value={5}>5 minutos</option>
              <option value={15}>15 minutos (padrão)</option>
              <option value={30}>30 minutos</option>
              <option value={0}>Desativado</option>
            </select>
          </div>

          <div className="pt-2 border-t border-white/10 space-y-1.5">
            {confirmWipe ? (
              <div className="space-y-1.5 rounded-lg bg-red-950/35 border border-red-500/30 p-2.5">
                <p className="text-[11px] text-red-200 leading-snug">
                  Apagar todos os rascunhos locais de Alterações, Crachás e Documentos deste navegador?
                </p>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onWipeLocalTraces();
                      setConfirmWipe(false);
                      setWipedFeedback(true);
                      window.setTimeout(() => setWipedFeedback(false), 2500);
                    }}
                    className="flex-1 h-7 rounded bg-red-700 hover:bg-red-600 text-[11px] font-medium text-white transition-colors"
                  >
                    Confirmar limpeza
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmWipe(false)}
                    className="h-7 px-2.5 rounded bg-[#181F1C] text-[11px] text-[#C6D4CC]"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmWipe(true)}
                className="w-full min-h-[34px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/25 bg-[#1B1314] hover:bg-red-950/45 px-2.5 text-xs text-red-200 transition-colors"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>Limpar rastros locais agora</span>
              </button>
            )}

            {wipedFeedback && (
              <p className="text-[11px] text-[#83B499] text-center">
                Rascunhos locais apagados com segurança.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

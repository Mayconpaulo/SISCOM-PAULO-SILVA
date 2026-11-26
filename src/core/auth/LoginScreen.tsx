import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  LogIn,
  LogOut,
  ShieldAlert,
} from 'lucide-react';
import {
  RecoveryRecord,
  fetchRecoveryQuestionByUsername,
  formatAuthErrorPtBr,
  isFirebaseAuthOperationNotAllowed,
  resetForgottenPasswordWithSecurityAnswer,
  signInWithGoogleAdmin,
  signInWithUsernameOrEmail,
  signOutCurrentUser,
  verifySecurityAnswerForRecord,
} from './authService';
import { FIREBASE_PROJECT_ID } from './firebase';
import { CREST_LAYOUT_TRANSITION, SISCOM_EASE, stepSlideVariants } from '../../shared/motion';
import { OperationalBackdrop } from '../../shared/OperationalBackdrop';
import { SiscomAlert, SiscomSpinner } from '../../shared/ui';

interface LoginScreenProps {
  unauthorizedReason?: string | null;
  hasFirebaseUser?: boolean;
  isLoadingProfile?: boolean;
}

type RecoveryStep = 'identify' | 'answer' | 'new_password';

export function LoginScreen({
  unauthorizedReason,
  hasFirebaseUser,
  isLoadingProfile,
}: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsEmailProviderSetup, setNeedsEmailProviderSetup] = useState(false);

  // Recovery via security question
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<RecoveryStep>('identify');
  const [recoveryUsername, setRecoveryUsername] = useState('');
  const [recoveryRecord, setRecoveryRecord] = useState<RecoveryRecord | null>(null);
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [failedAnswerCount, setFailedAnswerCount] = useState(0);
  const [answerLockUntil, setAnswerLockUntil] = useState(0);
  const [lockSecondsLeft, setLockSecondsLeft] = useState(0);

  useEffect(() => {
    if (answerLockUntil <= Date.now()) {
      setLockSecondsLeft(0);
      return;
    }
    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((answerLockUntil - Date.now()) / 1000));
      setLockSecondsLeft(remaining);
      if (remaining === 0) {
        setAnswerLockUntil(0);
      }
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 500);
    return () => window.clearInterval(timer);
  }, [answerLockUntil]);

  const busy = submitting || Boolean(isLoadingProfile);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg('Preencha nome de guerra/usuário e senha.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setNeedsEmailProviderSetup(false);
    try {
      await signInWithUsernameOrEmail(username, password);
    } catch (err) {
      if (isFirebaseAuthOperationNotAllowed(err)) {
        setNeedsEmailProviderSetup(true);
      }
      setErrorMsg(formatAuthErrorPtBr(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setSubmitting(true);
    setErrorMsg(null);
    setNeedsEmailProviderSetup(false);
    try {
      await signInWithGoogleAdmin();
    } catch (err) {
      setErrorMsg(formatAuthErrorPtBr(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setSubmitting(true);
    try {
      await signOutCurrentUser();
    } finally {
      setSubmitting(false);
    }
  };

  const loadQuestionForUsername = async (targetUser: string) => {
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const record = await fetchRecoveryQuestionByUsername(targetUser);
      setRecoveryRecord(record);
      setSecurityAnswer('');
      setNewPassword('');
      setConfirmNewPassword('');
      setRecoveryStep('answer');
    } catch (err) {
      setRecoveryStep('identify');
      setErrorMsg(err instanceof Error ? err.message : 'Erro ao buscar pergunta de segurança.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetRecoveryState = () => {
    setRecoveryMode(false);
    setRecoveryStep('identify');
    setRecoveryRecord(null);
    setSecurityAnswer('');
    setNewPassword('');
    setConfirmNewPassword('');
    setErrorMsg(null);
  };

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { siscomLoginRecovery?: unknown } | null;
      if (!state?.siscomLoginRecovery) {
        resetRecoveryState();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const openRecoveryFlow = async () => {
    setErrorMsg(null);
    setNeedsEmailProviderSetup(false);
    if (!(window.history.state as { siscomLoginRecovery?: unknown } | null)?.siscomLoginRecovery) {
      window.history.pushState(
        { siscomLoginRecovery: true },
        '',
        `${window.location.pathname}${window.location.search}#redefinir-senha`
      );
    }
    setRecoveryMode(true);
    setRecoveryRecord(null);
    setSecurityAnswer('');
    setNewPassword('');
    setConfirmNewPassword('');

    const prefilled = username.trim();
    setRecoveryUsername(prefilled);

    if (prefilled.length >= 2) {
      await loadQuestionForUsername(prefilled);
    } else {
      setRecoveryStep('identify');
    }
  };

  const closeRecoveryFlow = () => {
    const state = window.history.state as { siscomLoginRecovery?: unknown } | null;
    if (state?.siscomLoginRecovery) {
      window.history.back();
      return;
    }
    resetRecoveryState();
  };

  const handleLookupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryUsername.trim()) {
      setErrorMsg('Informe seu Nome de guerra ou Usuário.');
      return;
    }
    await loadQuestionForUsername(recoveryUsername);
  };

  const handleVerifyAnswer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryRecord) return;
    if (answerLockUntil > Date.now()) {
      const secs = Math.max(1, Math.ceil((answerLockUntil - Date.now()) / 1000));
      setErrorMsg(`Muitas tentativas incorretas. Aguarde ${secs}s para tentar novamente.`);
      return;
    }
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await verifySecurityAnswerForRecord(recoveryRecord, securityAnswer);
      setFailedAnswerCount(0);
      setAnswerLockUntil(0);
      setRecoveryStep('new_password');
    } catch (err) {
      const nextFails = failedAnswerCount + 1;
      setFailedAnswerCount(nextFails);
      if (nextFails >= 3) {
        const penaltySec = Math.min(60, 15 * 2 ** (nextFails - 3));
        setAnswerLockUntil(Date.now() + penaltySec * 1000);
        setErrorMsg(
          `Resposta incorreta. Por segurança, tente novamente em ${penaltySec} segundos.`
        );
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Resposta incorreta.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryRecord) return;
    setErrorMsg(null);

    if (newPassword.length < 6) {
      setErrorMsg('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMsg('As senhas digitadas não coincidem.');
      return;
    }

    setSubmitting(true);
    try {
      await resetForgottenPasswordWithSecurityAnswer({
        record: recoveryRecord,
        answer: securityAnswer,
        newPassword,
      });
    } catch (err) {
      setErrorMsg(formatAuthErrorPtBr(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080B09] text-[#E4EAE6] flex flex-col items-center justify-center px-4 py-8 relative">
      <OperationalBackdrop mode="auth" />
      <div className="relative z-10 w-full max-w-[408px] flex flex-col items-center space-y-6">
        <div className="flex flex-col items-center text-center space-y-2.5">
          <motion.div
            layoutId="siscom-crest"
            transition={CREST_LAYOUT_TRANSITION}
            className="w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center drop-shadow-[0_12px_28px_rgba(0,0,0,0.55)]"
          >
            <img
              src="/assets/logo_arma_comunicacoes.png"
              alt="Arma de Comunicações do Exército Brasileiro"
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain select-none"
            />
          </motion.div>
          <motion.h1
            layoutId="siscom-wordmark"
            transition={CREST_LAYOUT_TRANSITION}
            className="metallic-wordmark font-display text-[26px] font-extrabold tracking-[0.22em] pl-[0.22em] uppercase"
          >
            SISCOM
          </motion.h1>
          <motion.div
            layoutId="siscom-divider"
            transition={CREST_LAYOUT_TRANSITION}
            className="w-14 h-[1.5px] bg-gradient-to-r from-transparent via-[#D8B268]/80 to-transparent"
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.24, ease: SISCOM_EASE }}
          className="relative w-full metal-elevated rounded-2xl p-6 sm:p-7 space-y-4 overflow-hidden"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#E7C580]/55 to-transparent"
          />
          <AnimatePresence mode="wait">
            {unauthorizedReason && hasFirebaseUser ? (
              <motion.div
                key="unauthorized"
                variants={stepSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4 text-center"
              >
                <div className="mx-auto w-12 h-12 rounded-xl bg-red-950/50 border border-red-400/25 flex items-center justify-center text-red-300">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <p className="text-sm text-[#E4EAE6] leading-relaxed">{unauthorizedReason}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSignOut}
                  className="w-full siscom-btn siscom-btn-gold !min-h-[44px] text-sm"
                >
                  {busy ? <SiscomSpinner className="w-4 h-4" tone="gold" /> : <LogOut className="w-4 h-4" />}
                  <span>Trocar conta</span>
                </button>
              </motion.div>
            ) : recoveryMode ? (
              <motion.div
                key={`recovery-${recoveryStep}`}
                variants={stepSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4"
              >
                <div className="flex items-center gap-2 border-b border-white/8 pb-3">
                  <HelpCircle className="w-4 h-4 text-[#E5C17B]" />
                  <h2 className="font-display text-sm font-semibold text-[#F4E6C4]">
                    {recoveryStep === 'new_password'
                      ? 'Definir nova senha'
                      : 'Pergunta de segurança'}
                  </h2>
                </div>

                {recoveryStep === 'identify' && (
                  <form onSubmit={handleLookupSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="rec-username" className="siscom-field-label">
                        Nome de guerra ou Usuário
                      </label>
                      <input
                        id="rec-username"
                        type="text"
                        value={recoveryUsername}
                        onChange={(e) => setRecoveryUsername(e.target.value)}
                        placeholder="ex: Paulo Silva"
                        className="siscom-input"
                      />
                    </div>

                    <AnimatePresence>
                      {errorMsg && <SiscomAlert tone="error">{errorMsg}</SiscomAlert>}
                    </AnimatePresence>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full siscom-btn siscom-btn-primary !min-h-[44px] text-sm"
                    >
                      {busy && <SiscomSpinner className="w-4 h-4" />}
                      <span>{busy ? 'Buscando...' : 'Avançar'}</span>
                    </button>
                  </form>
                )}

                {recoveryStep === 'answer' && recoveryRecord && (
                  <form onSubmit={handleVerifyAnswer} className="space-y-4">
                    <div className="rounded-xl siscom-liquid-subcard !border-[#C9A961]/32 px-3.5 py-3 space-y-1">
                      <span className="block text-[11px] text-[#E5C17B]">
                        Pergunta de segurança · @{recoveryRecord.username}
                      </span>
                      <p className="text-sm font-medium text-[#F4E6C4] leading-snug">
                        {recoveryRecord.question}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="rec-answer" className="siscom-field-label">
                        Sua resposta
                      </label>
                      <input
                        id="rec-answer"
                        type="text"
                        required
                        value={securityAnswer}
                        onChange={(e) => setSecurityAnswer(e.target.value)}
                        placeholder="Digite a resposta cadastrada"
                        className="siscom-input"
                      />
                    </div>

                    <AnimatePresence>
                      {errorMsg && <SiscomAlert tone="error">{errorMsg}</SiscomAlert>}
                    </AnimatePresence>

                    <button
                      type="submit"
                      disabled={busy || lockSecondsLeft > 0}
                      className="w-full siscom-btn siscom-btn-primary !min-h-[44px] text-sm"
                    >
                      {busy ? <SiscomSpinner className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
                      <span>
                        {lockSecondsLeft > 0
                          ? `Aguarde ${lockSecondsLeft}s`
                          : busy
                            ? 'Verificando...'
                            : 'Verificar resposta'}
                      </span>
                    </button>
                  </form>
                )}

                {recoveryStep === 'new_password' && recoveryRecord && (
                  <form onSubmit={handleResetPassword} className="space-y-4">
                    <SiscomAlert tone="success">
                      Resposta confirmada. Escolha sua nova senha.
                    </SiscomAlert>

                    <div className="space-y-1.5">
                      <label htmlFor="rec-new-pass" className="siscom-field-label">
                        Nova senha
                      </label>
                      <div className="relative">
                        <input
                          id="rec-new-pass"
                          type={showNewPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          required
                          minLength={6}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Mínimo 6 caracteres"
                          className="siscom-input !pr-11"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword((v) => !v)}
                          aria-label={showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-[#E4EAE6] transition-colors"
                        >
                          {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="rec-confirm-pass" className="siscom-field-label">
                        Confirmar nova senha
                      </label>
                      <input
                        id="rec-confirm-pass"
                        type={showNewPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        minLength={6}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Repita a nova senha"
                        className="siscom-input"
                      />
                    </div>

                    <AnimatePresence>
                      {errorMsg && <SiscomAlert tone="error">{errorMsg}</SiscomAlert>}
                    </AnimatePresence>

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full siscom-btn siscom-btn-primary !min-h-[44px] text-sm"
                    >
                      {busy ? <SiscomSpinner className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                      <span>{busy ? 'Redefinindo...' : 'Redefinir senha e entrar'}</span>
                    </button>
                  </form>
                )}

                <div className="pt-2 border-t border-white/8 flex justify-center">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={closeRecoveryFlow}
                    className="min-h-[38px] px-3 inline-flex items-center gap-1.5 rounded-lg text-xs text-[#98A89F] hover:text-[#E4EAE6] hover:bg-white/5 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Voltar ao login</span>
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="login-form"
                variants={stepSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="space-y-4"
              >
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="login-username" className="siscom-field-label">
                      Nome de guerra ou Usuário
                    </label>
                    <input
                      id="login-username"
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="ex: Paulo Silva ou admin"
                      className="siscom-input"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="login-password" className="siscom-field-label">
                        Senha
                      </label>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void openRecoveryFlow()}
                        className="text-xs text-[#E5C17B] hover:text-[#F4E6C4] hover:underline transition-colors py-0.5"
                      >
                        Redefinir senha
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••"
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

                  <AnimatePresence>
                    {errorMsg && (
                      <SiscomAlert tone="error">
                        <div className="space-y-1.5">
                          <p>{errorMsg}</p>
                          {needsEmailProviderSetup && (
                            <a
                              href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[#E5C17B] underline"
                            >
                              <span>Abrir provedores no Firebase Console</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </SiscomAlert>
                    )}
                  </AnimatePresence>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full siscom-btn siscom-btn-primary !min-h-[44px] text-sm"
                  >
                    {busy ? <SiscomSpinner className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                    <span>{busy ? 'Entrando...' : 'Entrar'}</span>
                  </button>
                </form>

                <div className="relative flex items-center py-0.5">
                  <div className="flex-grow border-t border-white/8" />
                  <span className="px-3 text-[11px] text-[#697870]">ou</span>
                  <div className="flex-grow border-t border-white/8" />
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={handleGoogleLogin}
                  className="w-full siscom-btn siscom-btn-gold !min-h-[42px] text-xs"
                >
                  <span>Entrar com Google (Admin)</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

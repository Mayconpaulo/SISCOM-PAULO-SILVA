import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
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
} from '../lib/authService';
import { FIREBASE_PROJECT_ID } from '../lib/firebase';

interface LoginScreenProps {
  unauthorizedReason?: string | null;
  hasFirebaseUser?: boolean;
  isLoadingProfile?: boolean;
}

type RecoveryStep = 'identify' | 'answer' | 'new_password';

const CREST_LAYOUT_TRANSITION = {
  type: 'spring' as const,
  stiffness: 220,
  damping: 26,
  mass: 0.9,
};

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
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await verifySecurityAnswerForRecord(recoveryRecord, securityAnswer);
      setRecoveryStep('new_password');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Resposta incorreta.');
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
    <div className="min-h-screen bg-[#0B0E0D] text-[#E4EAE6] flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-[390px] flex flex-col items-center space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <motion.div
            layoutId="siscom-crest"
            transition={CREST_LAYOUT_TRANSITION}
            className="w-28 h-28 sm:w-32 sm:h-32 flex items-center justify-center"
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
            className="metallic-wordmark font-display text-2xl font-bold tracking-[0.22em] pl-[0.22em] uppercase"
          >
            SISCOM
          </motion.h1>
          <motion.div
            layoutId="siscom-divider"
            transition={CREST_LAYOUT_TRANSITION}
            className="w-12 h-[1.5px] bg-gradient-to-r from-transparent via-[#C29B56]/75 to-transparent"
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="w-full metal-surface rounded-xl p-5 sm:p-6 space-y-4"
        >
          {unauthorizedReason && hasFirebaseUser ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto w-11 h-11 rounded-lg bg-red-950/50 border border-red-400/25 flex items-center justify-center text-red-300">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <p className="text-sm text-[#E4EAE6]">{unauthorizedReason}</p>
              <button
                type="button"
                disabled={busy}
                onClick={handleSignOut}
                className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg border border-[#C29B56]/35 bg-[#181F1C] hover:bg-[#222B27] px-4 text-sm font-medium text-[#E4EAE6] transition-colors"
              >
                <LogOut className="w-4 h-4 text-[#C8A461]" />
                <span>Trocar conta</span>
              </button>
            </div>
          ) : recoveryMode ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-white/10 pb-3">
                <HelpCircle className="w-4 h-4 text-[#E5C17B]" />
                <h2 className="font-display text-sm font-semibold text-[#F4E6C4]">
                  {recoveryStep === 'new_password'
                    ? 'Definir nova senha'
                    : 'Pergunta de segurança'}
                </h2>
              </div>

              {recoveryStep === 'identify' && (
                <form onSubmit={handleLookupSubmit} className="space-y-3.5">
                  <div className="space-y-1">
                    <label htmlFor="rec-username" className="block text-xs text-[#98A89F]">
                      Nome de guerra ou Usuário
                    </label>
                    <input
                      id="rec-username"
                      type="text"
                      value={recoveryUsername}
                      onChange={(e) => setRecoveryUsername(e.target.value)}
                      placeholder="ex: Paulo Silva"
                      className="w-full min-h-[42px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#C29B56]"
                    />
                  </div>

                  {errorMsg && (
                    <div className="rounded-lg bg-red-950/40 border border-red-400/25 px-3 py-2 text-xs text-red-200">
                      {errorMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
                  >
                    <span>{busy ? 'Buscando...' : 'Avançar'}</span>
                  </button>
                </form>
              )}

              {recoveryStep === 'answer' && recoveryRecord && (
                <form onSubmit={handleVerifyAnswer} className="space-y-3.5">
                  <div className="rounded-lg border border-[#C29B56]/35 bg-[#141A17] px-3.5 py-2.5 space-y-1">
                    <span className="block text-[11px] text-[#E5C17B]">
                      Pergunta de segurança (@{recoveryRecord.username})
                    </span>
                    <p className="text-sm font-medium text-[#F4E6C4]">
                      {recoveryRecord.question}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="rec-answer" className="block text-xs text-[#98A89F]">
                      Sua resposta
                    </label>
                    <input
                      id="rec-answer"
                      type="text"
                      required
                      value={securityAnswer}
                      onChange={(e) => setSecurityAnswer(e.target.value)}
                      placeholder="Digite a resposta cadastrada"
                      className="w-full min-h-[42px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#C29B56]"
                    />
                  </div>

                  {errorMsg && (
                    <div className="rounded-lg bg-red-950/40 border border-red-400/25 px-3 py-2 text-xs text-red-200">
                      {errorMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>{busy ? 'Verificando...' : 'Verificar resposta'}</span>
                  </button>
                </form>
              )}

              {recoveryStep === 'new_password' && recoveryRecord && (
                <form onSubmit={handleResetPassword} className="space-y-3.5">
                  <div className="flex items-center gap-2 rounded-lg border border-[#83B499]/35 bg-[#2D5A43]/20 px-3 py-2 text-xs text-[#C6D4CC]">
                    <CheckCircle2 className="w-4 h-4 text-[#83B499] shrink-0" />
                    <span>Resposta confirmada. Escolha sua nova senha.</span>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="rec-new-pass" className="block text-xs text-[#98A89F]">
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
                        className="w-full min-h-[42px] rounded-lg bg-[#0E1211] border border-white/12 pl-3 pr-10 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#C29B56]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((v) => !v)}
                        aria-label={showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#98A89F] hover:text-[#E4EAE6] p-1"
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="rec-confirm-pass" className="block text-xs text-[#98A89F]">
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
                      className="w-full min-h-[42px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#C29B56]"
                    />
                  </div>

                  {errorMsg && (
                    <div className="rounded-lg bg-red-950/40 border border-red-400/25 px-3 py-2 text-xs text-red-200">
                      {errorMsg}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
                  >
                    <span>{busy ? 'Redefinindo...' : 'Redefinir senha e entrar'}</span>
                  </button>
                </form>
              )}

              <div className="pt-2 border-t border-white/10 flex justify-center">
                <button
                  type="button"
                  disabled={busy}
                  onClick={closeRecoveryFlow}
                  className="inline-flex items-center gap-1.5 text-xs text-[#98A89F] hover:text-[#E4EAE6] transition-colors py-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Voltar ao login</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div className="space-y-1">
                  <label htmlFor="login-username" className="block text-xs text-[#98A89F]">
                    Nome de guerra ou Usuário
                  </label>
                  <input
                    id="login-username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ex: Paulo Silva ou admin"
                    className="w-full min-h-[42px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#C29B56]"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="login-password" className="block text-xs text-[#98A89F]">
                      Senha
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openRecoveryFlow()}
                      className="text-[11px] text-[#E5C17B] hover:underline transition-colors"
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
                      className="w-full min-h-[42px] rounded-lg bg-[#0E1211] border border-white/12 pl-3 pr-10 text-sm text-[#E4EAE6] placeholder:text-[#697870] focus:outline-none focus:border-[#C29B56]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#98A89F] hover:text-[#E4EAE6] p-1"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {errorMsg && (
                  <div className="rounded-lg bg-red-950/40 border border-red-400/25 px-3 py-2 text-xs text-red-200 space-y-1.5">
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
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
                >
                  <LogIn className="w-4 h-4" />
                  <span>{busy ? 'Entrando...' : 'Entrar'}</span>
                </button>
              </form>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-white/10" />
                <span className="px-2.5 text-[11px] text-[#697870]">ou</span>
                <div className="flex-grow border-t border-white/10" />
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleLogin}
                className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 rounded-lg border border-[#C29B56]/35 bg-[#151A17] hover:bg-[#1C231F] px-3 text-xs font-medium text-[#E5C17B] transition-colors disabled:opacity-50"
              >
                <span>Entrar com Google (Admin)</span>
              </button>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}

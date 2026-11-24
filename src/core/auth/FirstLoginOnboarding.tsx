import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { User } from 'firebase/auth';
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import {
  UserAccount,
  completeFirstLoginPasswordChange,
  formatAuthErrorPtBr,
  saveSecurityQuestionAndPassword,
  signOutCurrentUser,
} from './authService';
import { SISCOM_EASE, stepSlideVariants } from '../../shared/motion';
import { OperationalBackdrop } from '../../shared/OperationalBackdrop';
import { SiscomAlert, SiscomSpinner } from '../../shared/ui';

interface FirstLoginOnboardingProps {
  user: User;
  account: UserAccount;
}

export function FirstLoginOnboarding({ user, account }: FirstLoginOnboardingProps) {
  const needsPasswordChange = account.mustChangePassword === true;

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Kept in memory only between Step 1 and Step 2 so Step 2 has just the 2 open fields
  const [sessionPassword, setSessionPassword] = useState('');
  const [fallbackPassword, setFallbackPassword] = useState('');

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (newPassword.length < 6) {
      setErrorMsg('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('As senhas digitadas não coincidem.');
      return;
    }

    setSubmitting(true);
    try {
      await completeFirstLoginPasswordChange({ user, newPassword });
      setSessionPassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setErrorMsg(formatAuthErrorPtBr(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSecuritySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanQuestion = question.trim();
    const cleanAnswer = answer.trim();
    const activePassword = sessionPassword || fallbackPassword;

    if (cleanQuestion.length < 3) {
      setErrorMsg('Escreva uma pergunta de segurança com pelo menos 3 caracteres.');
      return;
    }
    if (!cleanAnswer) {
      setErrorMsg('Digite a resposta para a sua pergunta de segurança.');
      return;
    }
    if (activePassword.length < 6) {
      setErrorMsg('Informe sua nova senha para vincular à pergunta de segurança.');
      return;
    }

    setSubmitting(true);
    try {
      await saveSecurityQuestionAndPassword({
        user,
        account,
        question: cleanQuestion,
        answer: cleanAnswer,
        currentPassword: activePassword,
      });
    } catch (err) {
      setErrorMsg(formatAuthErrorPtBr(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: SISCOM_EASE }}
      className="min-h-screen bg-[#080B09] text-[#E4EAE6] flex flex-col items-center justify-center px-4 py-8 relative"
    >
      <OperationalBackdrop mode="auth" />
      <div className="relative z-10 w-full max-w-[420px] flex flex-col items-center space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <img
            src="/assets/logo_arma_comunicacoes.png"
            alt="Arma de Comunicações do Exército Brasileiro"
            referrerPolicy="no-referrer"
            className="w-16 h-16 object-contain select-none"
          />
          <h1 className="metallic-wordmark font-display text-xl font-bold tracking-[0.22em] pl-[0.22em] uppercase">
            SISCOM
          </h1>
          <p className="text-xs text-[#C5D1CA]">{account.displayName}</p>
        </div>

        <div className="w-full metal-surface rounded-2xl p-6 sm:p-7 space-y-5 overflow-hidden">
          {/* Step Header */}
          <div className="flex items-center justify-between border-b border-white/8 pb-3.5">
            <div className="flex items-center gap-2">
              {needsPasswordChange ? (
                <KeyRound className="w-4 h-4 text-[#E5C17B]" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-[#83B499]" />
              )}
              <h2 className="font-display text-sm font-semibold text-[#F4E6C4]">
                {needsPasswordChange ? 'Redefinição de senha' : 'Pergunta de segurança'}
              </h2>
            </div>
            <span className="text-[11px] font-mono text-[#98A89F]">
              {needsPasswordChange ? 'Etapa 1 de 2' : 'Etapa 2 de 2'}
            </span>
          </div>

          <AnimatePresence mode="wait">
            {needsPasswordChange ? (
              <motion.form
                key="onboarding-step-1"
                variants={stepSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onSubmit={handlePasswordSubmit}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label htmlFor="first-new-pass" className="siscom-field-label">
                    Nova senha
                  </label>
                  <div className="relative">
                    <input
                      id="first-new-pass"
                      type={showPassword ? 'text' : 'password'}
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
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-md text-[#98A89F] hover:text-[#E4EAE6] transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="first-confirm-pass" className="siscom-field-label">
                    Confirmar nova senha
                  </label>
                  <input
                    id="first-confirm-pass"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                    className="siscom-input"
                  />
                </div>

                <AnimatePresence>
                  {errorMsg && <SiscomAlert tone="error">{errorMsg}</SiscomAlert>}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full siscom-btn siscom-btn-primary !min-h-[44px] text-sm"
                >
                  {submitting && <SiscomSpinner className="w-4 h-4" />}
                  <span>{submitting ? 'Salvando...' : 'Salvar senha e continuar'}</span>
                  {!submitting && <ArrowRight className="w-4 h-4" />}
                </button>
              </motion.form>
            ) : (
              <motion.form
                key="onboarding-step-2"
                variants={stepSlideVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                onSubmit={handleSecuritySubmit}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label htmlFor="sec-question" className="siscom-field-label">
                    Pergunta de segurança
                  </label>
                  <input
                    id="sec-question"
                    type="text"
                    required
                    maxLength={160}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Pergunta de segurança"
                    className="siscom-input"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="sec-answer" className="siscom-field-label">
                    Resposta
                  </label>
                  <input
                    id="sec-answer"
                    type="text"
                    required
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Resposta"
                    className="siscom-input"
                  />
                </div>

                {!sessionPassword && (
                  <div className="space-y-1.5">
                    <label htmlFor="sec-confirm-pass" className="siscom-field-label">
                      Confirme sua senha atual
                    </label>
                    <input
                      id="sec-confirm-pass"
                      type="password"
                      required
                      minLength={6}
                      value={fallbackPassword}
                      onChange={(e) => setFallbackPassword(e.target.value)}
                      placeholder="Senha escolhida na etapa anterior"
                      className="siscom-input"
                    />
                  </div>
                )}

                <AnimatePresence>
                  {errorMsg && <SiscomAlert tone="error">{errorMsg}</SiscomAlert>}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full siscom-btn siscom-btn-primary !min-h-[44px] text-sm"
                >
                  {submitting ? <SiscomSpinner className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>{submitting ? 'Salvando...' : 'Salvar e acessar o SISCOM'}</span>
                </button>
              </motion.form>
            )}
          </AnimatePresence>

          <div className="pt-2 border-t border-white/8 flex justify-center">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void signOutCurrentUser()}
              className="min-h-[38px] px-3 inline-flex items-center gap-1.5 rounded-lg text-xs text-[#98A89F] hover:text-[#E4EAE6] hover:bg-white/5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sair / Trocar conta</span>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

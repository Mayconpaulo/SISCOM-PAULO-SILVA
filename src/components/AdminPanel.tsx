import React, { useEffect, useState } from 'react';
import { ExternalLink, KeyRound, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  ALL_MODULE_KEYS,
  MODULE_LABELS,
  MODULE_PERM_FIELD,
  ModuleKey,
  ModulePermissions,
  UserAccount,
  createManagedUserAccount,
  formatAuthErrorPtBr,
  isFirebaseAuthOperationNotAllowed,
  removeManagedUser,
  toggleUserActiveStatus,
  toggleUserModulePermission,
  updateOwnAdminProfile,
} from '../lib/authService';
import { FIREBASE_PROJECT_ID } from '../lib/firebase';

const DEFAULT_NEW_USER_PERMS: ModulePermissions = {
  permPrismas: true,
  permCrachas: true,
  permAlteracao: false,
  permDocumentos: false,
  permCartoes: false,
};

export function AdminPanel() {
  const { firebaseUser, account, managedUsers } = useAuth();

  const isGoogleAdminSession = Boolean(
    firebaseUser?.providerData.some((p) => p.providerId === 'google.com') &&
      !firebaseUser?.email?.endsWith('@siscom.app')
  );

  // Admin self-profile form
  const [ownUsername, setOwnUsername] = useState(
    isGoogleAdminSession ? 'admin' : account?.username || 'admin'
  );
  const [ownDisplayName, setOwnDisplayName] = useState(account?.displayName || 'Administrador');
  const [ownCurrentPassword, setOwnCurrentPassword] = useState('');
  const [ownNewPassword, setOwnNewPassword] = useState('');
  const [savingOwn, setSavingOwn] = useState(false);

  // Create new login form (4 questions: Posto/graduação, Nome de guerra, Senha, Perfil)
  const [newRank, setNewRank] = useState('');
  const [newWarName, setNewWarName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [newPerms, setNewPerms] = useState<ModulePermissions>(DEFAULT_NEW_USER_PERMS);
  const [creatingUser, setCreatingUser] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsEmailSetup, setNeedsEmailSetup] = useState(false);

  useEffect(() => {
    if (!account) return;
    if (!isGoogleAdminSession) {
      setOwnUsername(account.username);
    }
    setOwnDisplayName(account.displayName);
  }, [account, isGoogleAdminSession]);

  if (!firebaseUser || !account || account.role !== 'admin') {
    return null;
  }

  const handleSaveOwnProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingOwn(true);
    setNotice(null);
    setErrorMsg(null);
    setNeedsEmailSetup(false);
    try {
      const result = await updateOwnAdminProfile({
        currentUser: firebaseUser,
        currentAccount: account,
        newUsername: ownUsername,
        newDisplayName: ownDisplayName,
        currentPassword: ownCurrentPassword,
        newPassword: ownNewPassword,
      });
      setOwnCurrentPassword('');
      setOwnNewPassword('');
      if (result.mode === 'created_secondary') {
        setNotice(`Login admin "${result.username}" criado. Já pode entrar com usuário e senha.`);
      } else if (result.mode === 'migrated_username') {
        setNotice(`Usuário atualizado para "${result.username}".`);
      } else {
        setNotice('Dados de administrador atualizados.');
      }
    } catch (err) {
      if (isFirebaseAuthOperationNotAllowed(err)) {
        setNeedsEmailSetup(true);
      }
      setErrorMsg(formatAuthErrorPtBr(err));
    } finally {
      setSavingOwn(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingUser(true);
    setNotice(null);
    setErrorMsg(null);
    setNeedsEmailSetup(false);
    try {
      const rankClean = newRank.trim();
      const warClean = newWarName.trim();
      const displayName = rankClean ? `${rankClean} ${warClean}` : warClean;
      const created = await createManagedUserAccount({
        adminUser: firebaseUser,
        adminAccount: account,
        username: warClean,
        displayName,
        password: newPassword,
        role: newRole,
        permissions: newPerms,
      });
      setNewRank('');
      setNewWarName('');
      setNewPassword('');
      setNewRole('user');
      setNewPerms(DEFAULT_NEW_USER_PERMS);
      setNotice(`Login criado: ${created.displayName} (entrar com "${warClean}" ou "${created.username}").`);
    } catch (err) {
      if (isFirebaseAuthOperationNotAllowed(err)) {
        setNeedsEmailSetup(true);
      }
      setErrorMsg(formatAuthErrorPtBr(err));
    } finally {
      setCreatingUser(false);
    }
  };

  const handleTogglePerm = async (target: UserAccount, mod: ModuleKey, checked: boolean) => {
    setErrorMsg(null);
    try {
      await toggleUserModulePermission(target, mod, checked);
    } catch (err) {
      setErrorMsg(formatAuthErrorPtBr(err));
    }
  };

  const handleToggleActive = async (target: UserAccount) => {
    setErrorMsg(null);
    try {
      await toggleUserActiveStatus(target, !target.active);
    } catch (err) {
      setErrorMsg(formatAuthErrorPtBr(err));
    }
  };

  const handleDeleteUser = async (target: UserAccount) => {
    setErrorMsg(null);
    try {
      await removeManagedUser(target);
      setNotice(`Login "${target.username}" removido.`);
    } catch (err) {
      setErrorMsg(formatAuthErrorPtBr(err));
    }
  };

  return (
    <main className="flex-1 max-w-[1180px] w-full mx-auto p-4 sm:p-6 space-y-6">
      {(notice || errorMsg) && (
        <div
          className={`rounded-xl px-4 py-3 text-xs border flex flex-wrap items-center justify-between gap-2 ${
            errorMsg
              ? 'bg-red-950/40 border-red-400/30 text-red-200'
              : 'bg-[#2D5A43]/20 border-[#83B499]/35 text-[#C6D4CC]'
          }`}
        >
          <span>{errorMsg || notice}</span>
          {needsEmailSetup && (
            <a
              href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[#E5C17B] underline font-medium"
            >
              <span>Ativar E-mail/senha no Firebase</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Meu Login de Administrador */}
        <section className="metal-surface rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-white/10 pb-3">
            <KeyRound className="w-4 h-4 text-[#E5C17B]" />
            <h2 className="font-display text-sm font-semibold text-[#F4E6C4]">
              {isGoogleAdminSession ? 'Criar / Configurar Login Admin' : 'Meu Login Admin'}
            </h2>
          </div>

          <form onSubmit={handleSaveOwnProfile} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="admin-own-user" className="block text-[11px] text-[#98A89F]">
                  Usuário / Nome de guerra
                </label>
                <input
                  id="admin-own-user"
                  type="text"
                  value={ownUsername}
                  onChange={(e) => setOwnUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#C29B56]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="admin-own-name" className="block text-[11px] text-[#98A89F]">
                  Posto/graduação + Nome de guerra
                </label>
                <input
                  id="admin-own-name"
                  type="text"
                  value={ownDisplayName}
                  onChange={(e) => setOwnDisplayName(e.target.value)}
                  placeholder="ex: Sgt Paulo Silva"
                  className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#C29B56]"
                />
              </div>

              {!isGoogleAdminSession && (
                <div className="space-y-1">
                  <label htmlFor="admin-curr-pass" className="block text-[11px] text-[#98A89F]">
                    Senha atual (ao alterar login/senha)
                  </label>
                  <input
                    id="admin-curr-pass"
                    type="password"
                    value={ownCurrentPassword}
                    onChange={(e) => setOwnCurrentPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#C29B56]"
                  />
                </div>
              )}

              <div className={`space-y-1 ${isGoogleAdminSession ? 'sm:col-span-2' : ''}`}>
                <label htmlFor="admin-new-pass" className="block text-[11px] text-[#98A89F]">
                  {isGoogleAdminSession ? 'Definir senha (mín. 6 caracteres)' : 'Nova senha (opcional)'}
                </label>
                <input
                  id="admin-new-pass"
                  type="password"
                  value={ownNewPassword}
                  onChange={(e) => setOwnNewPassword(e.target.value)}
                  placeholder="••••••"
                  className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#C29B56]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingOwn}
              className="min-h-[40px] px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-[#2D5A43] hover:bg-[#376C51] text-xs font-medium text-white transition-colors disabled:opacity-50"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>{savingOwn ? 'Salvando...' : 'Salvar login admin'}</span>
            </button>
          </form>
        </section>

        {/* Novo Login */}
        <section className="metal-surface rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-white/10 pb-3">
            <UserPlus className="w-4 h-4 text-[#83B499]" />
            <h2 className="font-display text-sm font-semibold text-[#F4E6C4]">Criar Novo Login</h2>
          </div>

          <form onSubmit={handleCreateUser} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="new-user-rank" className="block text-[11px] text-[#98A89F]">
                  1. Posto/graduação
                </label>
                <input
                  id="new-user-rank"
                  type="text"
                  required
                  value={newRank}
                  onChange={(e) => setNewRank(e.target.value)}
                  placeholder="ex: Sgt"
                  className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="new-user-warname" className="block text-[11px] text-[#98A89F]">
                  2. Nome de guerra
                </label>
                <input
                  id="new-user-warname"
                  type="text"
                  required
                  value={newWarName}
                  onChange={(e) => setNewWarName(e.target.value)}
                  placeholder="ex: Paulo Silva"
                  className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="new-user-pass" className="block text-[11px] text-[#98A89F]">
                  3. Senha
                </label>
                <input
                  id="new-user-pass"
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="mín. 6 caracteres"
                  className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="new-user-role" className="block text-[11px] text-[#98A89F]">
                  4. Perfil
                </label>
                <select
                  id="new-user-role"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
                  className="w-full min-h-[38px] rounded-lg bg-[#0E1211] border border-white/12 px-3 text-xs text-[#E4EAE6] focus:outline-none focus:border-[#7FB095]"
                >
                  <option value="user">Usuário</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <span className="block text-[11px] text-[#98A89F]">Funções liberadas</span>
              <div className="flex flex-wrap gap-3">
                {ALL_MODULE_KEYS.map((mod) => {
                  const field = MODULE_PERM_FIELD[mod];
                  return (
                    <label
                      key={mod}
                      className="inline-flex items-center gap-1.5 text-xs text-[#E4EAE6] cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={newPerms[field]}
                        onChange={(e) =>
                          setNewPerms((prev) => ({ ...prev, [field]: e.target.checked }))
                        }
                        className="h-4 w-4 accent-[#2D5A43] cursor-pointer"
                      />
                      <span>{MODULE_LABELS[mod]}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={creatingUser}
              className="min-h-[40px] px-4 inline-flex items-center justify-center gap-2 rounded-lg border border-[#C29B56]/45 bg-[#181F1C] hover:bg-[#222B27] text-xs font-medium text-[#E5C17B] transition-colors disabled:opacity-50"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{creatingUser ? 'Criando...' : 'Criar login'}</span>
            </button>
          </form>
        </section>
      </div>

      {/* Lista em Tempo Real com Checkboxes */}
      <section className="metal-surface rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#E5C17B]" />
            <h2 className="font-display text-sm font-semibold text-[#F4E6C4]">
              Logins e Permissões
            </h2>
          </div>
          <span className="text-[11px] font-mono text-[#98A89F]">
            {managedUsers.length} conta{managedUsers.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[680px]">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-[#98A89F]">
                <th className="py-2 pr-3 font-medium">Usuário</th>
                <th className="py-2 px-2 font-medium text-center">Ativo</th>
                {ALL_MODULE_KEYS.map((mod) => (
                  <th key={mod} className="py-2 px-2 font-medium text-center">
                    {MODULE_LABELS[mod]}
                  </th>
                ))}
                <th className="py-2 pl-2 font-medium text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8 text-xs">
              {managedUsers.map((u) => {
                const isSelf = u.uid === firebaseUser.uid;
                return (
                  <tr key={u.uid} className="hover:bg-white/[0.02]">
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-[#E4EAE6]">{u.displayName}</span>
                        {u.role === 'admin' && (
                          <span className="text-[10px] font-mono text-[#E5C17B] border border-[#C29B56]/40 rounded px-1.5 py-0.5">
                            ADMIN
                          </span>
                        )}
                        {(u.mustChangePassword === true || u.securityQuestionSetup === false) && (
                          <span className="text-[10px] font-mono text-[#98A89F] border border-white/15 rounded px-1.5 py-0.5">
                            1º ACESSO
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-[#98A89F]">@{u.username}</div>
                    </td>

                    <td className="py-3 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={u.active}
                        disabled={isSelf}
                        aria-label={`Ativo para ${u.username}`}
                        onChange={() => handleToggleActive(u)}
                        className="h-4 w-4 accent-[#C29B56] cursor-pointer disabled:opacity-40"
                      />
                    </td>

                    {ALL_MODULE_KEYS.map((mod) => {
                      const field = MODULE_PERM_FIELD[mod];
                      const checked = Boolean(u[field]);
                      return (
                        <td key={mod} className="py-3 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            aria-label={`${MODULE_LABELS[mod]} para ${u.username}`}
                            onChange={(e) => handleTogglePerm(u, mod, e.target.checked)}
                            className="h-4 w-4 accent-[#2D5A43] cursor-pointer"
                          />
                        </td>
                      );
                    })}

                    <td className="py-3 pl-2 text-right">
                      {!isSelf && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u)}
                          title={`Remover ${u.username}`}
                          className="p-1.5 rounded-lg text-[#98A89F] hover:text-red-300 hover:bg-red-950/40 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

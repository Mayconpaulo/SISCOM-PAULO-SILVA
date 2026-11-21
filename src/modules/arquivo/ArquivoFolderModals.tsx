import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  FolderPlus,
  Pencil,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { SiscomSpinner } from '../../shared/ui';
import type { DriveFolderInspection, DriveFolderItem } from './arquivoTypes';

/* ── Create Subfolder Modal ─────────────────────────────────────────────── */

interface CreateFolderModalProps {
  open: boolean;
  parentPathLabel: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (folderName: string) => void;
}

export function CreateFolderModal({
  open,
  parentPathLabel,
  submitting,
  error,
  onClose,
  onSubmit,
}: CreateFolderModalProps) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = name.trim();
    if (!cleaned || submitting) return;
    onSubmit(cleaned);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-folder-title"
    >
      <div className="metal-surface w-full max-w-md rounded-xl p-5 sm:p-6 space-y-4 border border-white/12 shadow-[0_24px_64px_rgba(0,0,0,0.75)]">
        <div className="flex items-center justify-between gap-2 border-b border-white/8 pb-3">
          <div className="flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-[#E5C17B]" />
            <h3
              id="create-folder-title"
              className="font-display text-sm font-semibold text-[#F4E6C4]"
            >
              Criar Nova Pasta
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Fechar"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#98A89F] hover:text-[#F4F7F5] hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg border border-white/8 bg-[#0A110D]/65 px-3 py-2 text-[11px] text-[#98A89F]">
            Local de criação:{' '}
            <span className="font-mono text-[#E4EAE6]">{parentPathLabel}</span>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="new-drive-folder-name" className="siscom-field-label !text-[11px]">
              Nome da nova pasta
            </label>
            <input
              id="new-drive-folder-name"
              type="text"
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Formatura 21 NOV 2026"
              className="siscom-input !min-h-[42px] text-sm"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/35 bg-red-950/35 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="siscom-btn siscom-btn-secondary !min-h-[38px] text-xs"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="siscom-btn siscom-btn-gold !min-h-[38px] text-xs"
            >
              {submitting ? (
                <SiscomSpinner className="w-3.5 h-3.5" tone="gold" />
              ) : (
                <FolderPlus className="w-3.5 h-3.5" />
              )}
              <span>{submitting ? 'Criando...' : 'Criar pasta'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Rename Subfolder Modal ─────────────────────────────────────────────── */

interface RenameFolderModalProps {
  folder: DriveFolderItem | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (folder: DriveFolderItem, newName: string) => void;
}

export function RenameFolderModal({
  folder,
  submitting,
  error,
  onClose,
  onSubmit,
}: RenameFolderModalProps) {
  const [name, setName] = useState('');

  useEffect(() => {
    if (folder) setName(folder.name);
  }, [folder]);

  if (!folder) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = name.trim();
    if (!cleaned || cleaned === folder.name || submitting) return;
    onSubmit(folder, cleaned);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-folder-title"
    >
      <div className="metal-surface w-full max-w-md rounded-xl p-5 sm:p-6 space-y-4 border border-white/12 shadow-[0_24px_64px_rgba(0,0,0,0.75)]">
        <div className="flex items-center justify-between gap-2 border-b border-white/8 pb-3">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-[#E5C17B]" />
            <h3
              id="rename-folder-title"
              className="font-display text-sm font-semibold text-[#F4E6C4]"
            >
              Renomear Pasta
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Fechar"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#98A89F] hover:text-[#F4F7F5] hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="rename-drive-folder-input" className="siscom-field-label !text-[11px]">
              Novo nome para “{folder.name}”
            </label>
            <input
              id="rename-drive-folder-input"
              type="text"
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="siscom-input !min-h-[42px] text-sm"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/35 bg-red-950/35 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="siscom-btn siscom-btn-secondary !min-h-[38px] text-xs"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim() || name.trim() === folder.name}
              className="siscom-btn siscom-btn-gold !min-h-[38px] text-xs"
            >
              {submitting ? (
                <SiscomSpinner className="w-3.5 h-3.5" tone="gold" />
              ) : (
                <Pencil className="w-3.5 h-3.5" />
              )}
              <span>{submitting ? 'Salvando...' : 'Salvar novo nome'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Safe Delete Subfolder Modal (Explicit Impact Inspection & Confirmation) ─ */

interface DeleteFolderModalProps {
  folder: DriveFolderItem | null;
  inspecting: boolean;
  inspection: DriveFolderInspection | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirmDelete: (folder: DriveFolderItem, confirmNonEmpty: boolean) => void;
}

export function DeleteFolderModal({
  folder,
  inspecting,
  inspection,
  submitting,
  error,
  onClose,
  onConfirmDelete,
}: DeleteFolderModalProps) {
  const [ackChecked, setAckChecked] = useState(false);
  const [typedName, setTypedName] = useState('');

  useEffect(() => {
    setAckChecked(false);
    setTypedName('');
  }, [folder?.id]);

  if (!folder) return null;

  const isNonEmpty = Boolean(inspection && !inspection.isEmpty);
  const nameMatches = typedName.trim() === folder.name.trim();
  const canConfirm =
    !inspecting &&
    !submitting &&
    Boolean(inspection) &&
    (!isNonEmpty || (ackChecked && nameMatches));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-folder-title"
    >
      <div className="metal-surface w-full max-w-lg rounded-xl p-5 sm:p-6 space-y-4 border border-red-500/30 shadow-[0_24px_64px_rgba(0,0,0,0.8)]">
        <div className="flex items-center justify-between gap-2 border-b border-white/8 pb-3">
          <div className="flex items-center gap-2 text-red-300">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <h3 id="delete-folder-title" className="font-display text-sm font-semibold">
              Confirmar Exclusão de Pasta
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Fechar"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#98A89F] hover:text-[#F4F7F5] hover:bg-white/[0.06] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="rounded-lg border border-white/10 bg-[#0A110D]/75 p-3 space-y-1">
            <div className="text-[11px] text-[#98A89F]">Pasta selecionada para exclusão</div>
            <div className="font-display text-sm font-semibold text-[#F4E6C4] break-words">
              {folder.name}
            </div>
          </div>

          {inspecting ? (
            <div className="py-5 flex items-center justify-center gap-2 text-[#98A89F]">
              <SiscomSpinner className="w-4 h-4" tone="gold" />
              <span>Verificando subpastas e arquivos internos antes da exclusão...</span>
            </div>
          ) : inspection ? (
            inspection.isEmpty ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/25 p-3 text-emerald-100 space-y-1">
                <div className="font-medium">Pasta vazia (0 subpastas e 0 arquivos)</div>
                <p className="text-[11px] text-emerald-100/80 leading-relaxed">
                  A pasta será movida para a Lixeira do Google Drive da conta institucional. Nenhum
                  arquivo será afetado.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-500/40 bg-red-950/30 p-3.5 text-red-100 space-y-2">
                  <div className="font-semibold flex items-center gap-1.5 text-red-200">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Atenção: esta pasta NÃO está vazia!</span>
                  </div>
                  <p className="text-[11px] text-red-100/90 leading-relaxed">
                    Ao confirmar, a pasta <strong>{folder.name}</strong> e{' '}
                    <strong>todo o conteúdo dentro dela</strong> serão movidos para a Lixeira do
                    Google Drive:
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-0.5 font-mono text-[11px]">
                    <div className="rounded bg-black/30 px-2.5 py-1.5 border border-red-400/20">
                      Subpastas: <strong>{inspection.totalSubfolderCount}{inspection.scanTruncated ? '+' : ''}</strong>
                    </div>
                    <div className="rounded bg-black/30 px-2.5 py-1.5 border border-red-400/20">
                      Arquivos: <strong>{inspection.totalFileCount}{inspection.scanTruncated ? '+' : ''}</strong>
                    </div>
                  </div>
                </div>

                <label className="flex items-start gap-2.5 text-xs text-[#E8E4D8] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={ackChecked}
                    onChange={(e) => setAckChecked(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-red-500 cursor-pointer shrink-0"
                  />
                  <span className="leading-relaxed">
                    Entendo que esta pasta contém itens e autorizo mover a pasta{' '}
                    <strong>{folder.name}</strong> junto com todo o seu conteúdo para a Lixeira do
                    Google Drive.
                  </span>
                </label>

                <div className="space-y-1.5">
                  <label htmlFor="confirm-delete-folder-name" className="siscom-field-label !text-[11px]">
                    Para confirmar, digite exatamente o nome da pasta:{' '}
                    <span className="font-mono text-[#F4E6C4]">{folder.name}</span>
                  </label>
                  <input
                    id="confirm-delete-folder-name"
                    type="text"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    placeholder={folder.name}
                    className="siscom-input !min-h-[40px] text-xs font-mono"
                  />
                </div>
              </div>
            )
          ) : null}

          {error && (
            <div className="rounded-lg border border-red-500/35 bg-red-950/35 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/8">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="siscom-btn siscom-btn-secondary !min-h-[38px] text-xs"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirmDelete(folder, isNonEmpty)}
            className="siscom-btn !min-h-[38px] text-xs bg-red-900/80 hover:bg-red-800/90 border border-red-500/45 text-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <SiscomSpinner className="w-3.5 h-3.5" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            <span>{submitting ? 'Excluindo...' : 'Excluir pasta'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

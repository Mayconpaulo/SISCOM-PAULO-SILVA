import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BellRing,
  Calendar,
  CalendarPlus,
  Check,
  Clock,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { SiscomModal, SiscomSpinner } from '../../shared/ui';
import { useDemandas } from './DemandasContext';
import { sendTestDemandaNotification } from './demandaNotifications';
import {
  DEMANDA_PRIORITY_LABELS,
  DemandaItem,
  DemandaPriority,
  REMIND_BEFORE_OPTIONS,
  addDaysToDateKey,
  formatDateKeyLocal,
  formatDemandaCountdown,
  formatFullDueDate,
  getCalendarDaysUntil,
  getDemandaUrgency,
  isDemandaOverdue,
} from './demandaTypes';

type FilterTab = 'pendentes' | 'urgentes' | 'proximas' | 'concluidas';

export const DemandasPanelModal: React.FC = () => {
  const {
    demandas,
    pendingDemandas,
    completedDemandas,
    overdueCount,
    todayCount,
    panelOpen,
    setPanelOpen,
    editingDemanda,
    setEditingDemanda,
    notificationPermission,
    enableBrowserNotifications,
    addDemanda,
    editDemanda,
    toggleComplete,
    postponeOneDay,
    removeDemanda,
  } = useDemandas();

  const [filter, setFilter] = useState<FilterTab>('pendentes');
  const [searchText, setSearchText] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  // Form fields
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState(() => formatDateKeyLocal(new Date()));
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState<DemandaPriority>('media');
  const [remindBeforeDays, setRemindBeforeDays] = useState<number>(3);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Hydrate form if opened for editing a specific demanda
  useEffect(() => {
    if (panelOpen && editingDemanda) {
      setFormOpen(true);
      setTitle(editingDemanda.title);
      setNotes(editingDemanda.notes);
      setDueDate(editingDemanda.dueDate);
      setDueTime(editingDemanda.dueTime);
      setPriority(editingDemanda.priority);
      setRemindBeforeDays(editingDemanda.remindBeforeDays);
      setFormError(null);
    }
  }, [panelOpen, editingDemanda]);

  const resetForm = () => {
    setEditingDemanda(null);
    setTitle('');
    setNotes('');
    setDueDate(formatDateKeyLocal(new Date()));
    setDueTime('');
    setPriority('media');
    setRemindBeforeDays(3);
    setFormError(null);
  };

  const handleClose = () => {
    resetForm();
    setFormOpen(false);
    setNotice(null);
    setPanelOpen(false);
  };

  const handleOpenNewForm = () => {
    resetForm();
    setFormOpen(true);
  };

  const handleEditItem = (item: DemandaItem) => {
    setEditingDemanda(item);
    setTitle(item.title);
    setNotes(item.notes);
    setDueDate(item.dueDate);
    setDueTime(item.dueTime);
    setPriority(item.priority);
    setRemindBeforeDays(item.remindBeforeDays);
    setFormError(null);
    setFormOpen(true);
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) {
      setFormError('Informe o que precisa ser feito.');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (editingDemanda) {
        await editDemanda(editingDemanda.id, {
          title: clean,
          notes,
          dueDate,
          dueTime,
          priority,
          remindBeforeDays,
        });
        setNotice('Demanda atualizada.');
      } else {
        await addDemanda({
          title: clean,
          notes,
          dueDate,
          dueTime,
          priority,
          remindBeforeDays,
        });
        setNotice('Demanda criada com avisos automáticos.');
      }
      resetForm();
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Erro ao salvar demanda.');
    } finally {
      setSaving(false);
    }
  };

  const handleEnableOrTestNotifications = async () => {
    if (notificationPermission === 'granted') {
      const ok = await sendTestDemandaNotification();
      setNotice(
        ok
          ? 'Notificação de teste enviada.'
          : 'O navegador bloqueou a notificação de teste; os avisos internos continuam ativos.'
      );
      return;
    }
    const result = await enableBrowserNotifications();
    if (result === 'granted') {
      await sendTestDemandaNotification();
      setNotice('Notificações do navegador ativadas!');
    } else if (result === 'denied') {
      setNotice(
        'Permissão negada no navegador. Você continuará recebendo alertas visuais dentro do SISCOM.'
      );
    }
  };

  const filteredItems = useMemo(() => {
    const now = new Date();
    const q = searchText.trim().toLowerCase();

    let base: DemandaItem[];
    if (filter === 'concluidas') {
      base = completedDemandas;
    } else if (filter === 'urgentes') {
      base = pendingDemandas.filter(
        (d) => isDemandaOverdue(d, now) || getCalendarDaysUntil(d.dueDate, now) === 0
      );
    } else if (filter === 'proximas') {
      base = pendingDemandas.filter(
        (d) => !isDemandaOverdue(d, now) && getCalendarDaysUntil(d.dueDate, now) > 0
      );
    } else {
      base = pendingDemandas;
    }

    if (!q) return base;
    return base.filter(
      (item) =>
        item.title.toLowerCase().includes(q) || item.notes.toLowerCase().includes(q)
    );
  }, [filter, searchText, pendingDemandas, completedDemandas]);

  const urgentTotal = overdueCount + todayCount;
  const todayKey = formatDateKeyLocal(new Date());
  const tomorrowKey = addDaysToDateKey(new Date(), 1);

  return (
    <SiscomModal
      open={panelOpen}
      onClose={handleClose}
      title="Sistema de Demandas"
      maxWidthClass="max-w-2xl"
      zIndexClass="z-[52]"
    >
      <div className="space-y-4">
        {/* Notification Bar + New Action */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
          <div className="text-xs text-[#98A89F] tabular-nums">
            <span className="text-[#E4EAE6] font-medium">{pendingDemandas.length} pendentes</span>
            <span aria-hidden="true"> · </span>
            <span className={urgentTotal > 0 ? 'text-[#DFBC75]' : ''}>
              {urgentTotal} urgentes
            </span>
            <span aria-hidden="true"> · </span>
            <span>{completedDemandas.length} concluídas</span>
          </div>

          <div className="flex items-center gap-2">
            {notificationPermission !== 'unsupported' && (
              <button
                type="button"
                onClick={() => void handleEnableOrTestNotifications()}
                className="siscom-btn siscom-btn-secondary !min-h-[36px] !px-3 text-xs"
              >
                {notificationPermission === 'granted' ? (
                  <>
                    <BellRing className="w-3.5 h-3.5 text-[#83B499]" />
                    <span>Testar aviso</span>
                  </>
                ) : (
                  <>
                    <Bell className="w-3.5 h-3.5 text-[#DFBC75]" />
                    <span>Ativar notificações</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={formOpen && !editingDemanda ? () => setFormOpen(false) : handleOpenNewForm}
              className="siscom-btn siscom-btn-primary !min-h-[36px] !px-3.5 text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nova demanda</span>
            </button>
          </div>
        </div>

        {notice && (
          <div className="rounded-[9px] border border-[#83B499]/30 bg-[#13291E]/60 px-3 py-2 text-xs text-[#C9E2D4] flex items-center justify-between gap-2">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-[11px] text-[#83B499] hover:underline cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {/* Inline Create / Edit Form */}
        {formOpen && (
          <form
            onSubmit={handleSaveForm}
            className="rounded-[14px] siscom-liquid-subcard !border-[#C9A961]/30 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#DFBC75]">
                {editingDemanda ? 'Editar demanda' : 'Nova demanda'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setFormOpen(false);
                }}
                className="text-xs text-[#8FA197] hover:text-[#E4EAE6] cursor-pointer"
              >
                Cancelar
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="siscom-field-label !text-[11px]">O que precisa fazer?</label>
              <input
                type="text"
                maxLength={160}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Enviar nota para o BI, conferir crachás da formatura..."
                className="siscom-input !min-h-[42px] text-sm"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="siscom-field-label !text-[11px]">Para quando (data)</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="siscom-input !min-h-[40px] text-xs tabular-nums flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setDueDate(todayKey)}
                    className="px-2.5 min-h-[40px] rounded-[8px] border border-white/[0.1] bg-[#121916] text-[11px] text-[#C6D4CC] hover:text-[#F4E6C4] cursor-pointer"
                  >
                    Hoje
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDate(tomorrowKey)}
                    className="px-2.5 min-h-[40px] rounded-[8px] border border-white/[0.1] bg-[#121916] text-[11px] text-[#C6D4CC] hover:text-[#F4E6C4] cursor-pointer"
                  >
                    Amanhã
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="siscom-field-label !text-[11px]">Horário (opcional)</label>
                <input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="siscom-input !min-h-[40px] text-xs tabular-nums"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="siscom-field-label !text-[11px]">
                  Notificar antes até chegar no dia
                </label>
                <select
                  value={remindBeforeDays}
                  onChange={(e) => setRemindBeforeDays(Number(e.target.value))}
                  className="siscom-input !min-h-[40px] text-xs cursor-pointer"
                >
                  {REMIND_BEFORE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="siscom-field-label !text-[11px]">Prioridade</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as DemandaPriority)}
                  className="siscom-input !min-h-[40px] text-xs cursor-pointer"
                >
                  <option value="baixa">Baixa</option>
                  <option value="media">Normal</option>
                  <option value="alta">Alta</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="siscom-field-label !text-[11px]">Observações (opcional)</label>
              <textarea
                rows={2}
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Detalhes, contatos ou referência do documento..."
                className="siscom-input py-2 text-xs resize-none"
              />
            </div>

            {formError && <p className="text-xs text-red-300">{formError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="siscom-btn siscom-btn-primary !min-h-[40px] !px-4 text-xs"
              >
                {saving ? <SiscomSpinner className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                <span>{editingDemanda ? 'Salvar alterações' : 'Adicionar demanda'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Filter Tabs + Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="inline-flex items-center siscom-tab-track overflow-x-auto">
            {(
              [
                { id: 'pendentes', label: `Pendentes (${pendingDemandas.length})` },
                { id: 'urgentes', label: `Urgentes (${urgentTotal})` },
                { id: 'proximas', label: 'Futuras' },
                { id: 'concluidas', label: `Concluídas (${completedDemandas.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-2.5 py-1.5 rounded-[7px] text-xs font-medium whitespace-nowrap transition-colors cursor-pointer tabular-nums ${
                  filter === tab.id
                    ? 'bg-[#1D2B24] text-[#F4E6C4]'
                    : 'text-[#8FA197] hover:text-[#D5DFD9]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <label className="relative flex items-center sm:w-52">
            <Search className="w-3.5 h-3.5 text-[#7D8F85] absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Buscar demanda..."
              className="siscom-input !min-h-[38px] !pl-8 text-xs"
            />
          </label>
        </div>

        {/* Demandas List */}
        <div className="max-h-[48vh] overflow-y-auto pr-1 divide-y divide-white/[0.06]">
          {filteredItems.length === 0 ? (
            <div className="py-10 text-center space-y-1.5">
              <p className="text-sm text-[#C6D4CC]">
                {demandas.length === 0
                  ? 'Nenhuma demanda cadastrada ainda.'
                  : 'Nenhuma demanda encontrada neste filtro.'}
              </p>
              <p className="text-xs text-[#8FA197]">
                Cadastre suas tarefas com prazo para receber avisos automáticos antes do vencimento.
              </p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const urgency = getDemandaUrgency(item);
              const isDone = item.status === 'concluida';
              const countdownTone = isDone
                ? 'text-[#7D8F85]'
                : urgency === 'atrasada'
                ? 'text-red-300'
                : urgency === 'hoje' || urgency === 'amanha'
                ? 'text-[#DFBC75]'
                : 'text-[#98A89F]';

              return (
                <div
                  key={item.id}
                  className="py-3 flex items-start gap-3 group"
                >
                  <button
                    type="button"
                    onClick={() => void toggleComplete(item)}
                    aria-label={isDone ? 'Reabrir demanda' : 'Concluir demanda'}
                    className={`mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                      isDone
                        ? 'bg-[#2D5A43] border-[#83B499] text-[#F4E6C4]'
                        : 'border-[#C29B56]/45 hover:border-[#83B499] hover:bg-[#2D5A43]/30'
                    }`}
                  >
                    <Check
                      className={`w-3 h-3 ${isDone ? 'opacity-100' : 'opacity-0 group-hover:opacity-60 text-[#83B499]'}`}
                    />
                  </button>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p
                        className={`text-sm font-medium break-words ${
                          isDone ? 'line-through text-[#7D8F85]' : 'text-[#F4E6C4]'
                        }`}
                      >
                        {item.title}
                      </p>
                      <span className={`text-xs font-mono tabular-nums shrink-0 ${countdownTone}`}>
                        {formatDemandaCountdown(item)}
                      </span>
                    </div>

                    {item.notes && (
                      <p className="text-xs text-[#98A89F] whitespace-pre-wrap break-words leading-relaxed">
                        {item.notes}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#7D8F85] tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatFullDueDate(item.dueDate)}
                      </span>
                      {item.dueTime && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {item.dueTime}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>Prioridade {DEMANDA_PRIORITY_LABELS[item.priority]}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Aviso{' '}
                        {item.remindBeforeDays === 0
                          ? 'no dia'
                          : `${item.remindBeforeDays}d antes até o dia`}
                      </span>
                    </div>
                  </div>

                  {/* Row Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {!isDone && (
                      <button
                        type="button"
                        onClick={() => void postponeOneDay(item)}
                        title="Adiar 1 dia"
                        className="w-8 h-8 rounded-[7px] flex items-center justify-center text-[#98A89F] hover:text-[#DFBC75] hover:bg-white/[0.06] cursor-pointer"
                      >
                        <CalendarPlus className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleEditItem(item)}
                      title="Editar demanda"
                      className="w-8 h-8 rounded-[7px] flex items-center justify-center text-[#98A89F] hover:text-[#F4E6C4] hover:bg-white/[0.06] cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeDemanda(item.id)}
                      title="Excluir demanda"
                      className="w-8 h-8 rounded-[7px] flex items-center justify-center text-[#98A89F] hover:text-red-300 hover:bg-red-500/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </SiscomModal>
  );
};

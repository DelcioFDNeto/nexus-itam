// src/components/terms/TermIssueModal.jsx
import React, { useMemo, useState } from 'react';
import { Eye, FileSignature, Info, Printer, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { useLocations } from '../../hooks/useLocations';
import { useTermPrinter } from '../../hooks/useTermPrinter';
import { issueResponsibilityTerm, issueReturnTerm } from '../../services/termService';
import { findHeadquarters } from '../../services/locationService';
import { personFromAssets, snapshotAsset } from '../../utils/terms';
import LocationSelect from '../LocationSelect';
import PersonFields from './PersonFields';
import TermAssetsEditor from './TermAssetsEditor';
import { SectionTitle, TermModalFrame } from './termUi';
import { fieldClass, labelClass } from './termStyles';

const norm = (value) => String(value ?? '').trim().toLowerCase();

const COPY = {
  responsabilidade: {
    icon: FileSignature,
    title: 'Termo de Responsabilidade',
    subtitle: 'Entrega de equipamento(s) a um colaborador, com número e registro de assinatura.',
    person: 'Colaborador que recebe',
    condition: 'Estado na entrega',
    action: 'Emitir e imprimir',
  },
  devolucao: {
    icon: Undo2,
    title: 'Termo de Devolução',
    subtitle: 'O colaborador devolve equipamento(s); o termo registra o estado de cada item.',
    person: 'Colaborador que devolve',
    condition: 'Estado na devolução',
    action: 'Registrar devolução',
  },
};

/**
 * Emissao de termo de responsabilidade (entrega) ou de devolucao.
 *
 * @param {'responsabilidade'|'devolucao'} kind
 * @param {Array}    initialAssets  ativos ja escolhidos (detalhe, lista, colaborador)
 * @param {object}   [initialHolder] colaborador ja conhecido (ex.: tela Equipe)
 */
const TermIssueModal = ({ kind = 'responsabilidade', initialAssets = [], initialHolder, onClose, onIssued }) => {
  const { currentUser } = useAuth();
  const { locations } = useLocations();
  const { printTerm, openWindow } = useTermPrinter();
  const copy = COPY[kind];
  const isReturn = kind === 'devolucao';

  const [assets, setAssets] = useState(initialAssets);
  const [conditions, setConditions] = useState({});
  const [holder, setHolder] = useState(() => ({ ...personFromAssets(initialAssets), ...(initialHolder || {}) }));
  const [notes, setNotes] = useState('');
  // null = sugestao (matriz); '' = manter o local atual dos ativos.
  const [returnLocation, setReturnLocation] = useState(null);
  const [receivedByName, setReceivedByName] = useState(currentUser?.name || '');
  const [busy, setBusy] = useState(false);

  const headquarters = findHeadquarters(locations);
  const effectiveReturnLocation = returnLocation === null ? headquarters?.name || '' : returnLocation;

  // Devolucao: so ativos que estao com alguem (e, escolhido o colaborador, com ele).
  const pickerFilter = useMemo(() => {
    if (!isReturn) return undefined;
    const name = norm(holder.name);
    return (asset) => Boolean(asset.assignedTo) && (!name || norm(asset.assignedTo) === name);
  }, [isReturn, holder.name]);

  const blockReason = (asset) => (asset.transit?.termId ? `está em trânsito (${asset.transit.number})` : null);
  const blocked = assets.some((a) => blockReason(a));
  const otherHolders = isReturn
    ? assets.filter((a) => a.assignedTo && holder.name && norm(a.assignedTo) !== norm(holder.name))
    : [];

  const canSubmit = assets.length > 0 && holder.name.trim() && !blocked && !busy;

  const preview = () => {
    printTerm(
      {
        kind,
        holder,
        notes,
        returnLocation: isReturn ? effectiveReturnLocation : '',
        receivedByName,
        assets: assets.map((a) => snapshotAsset(a, conditions[a.id])),
        issuedAtDate: new Date(),
      },
      { draft: true },
    );
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const win = openWindow();
    try {
      const input = { tenantId: currentUser.tenantId, user: currentUser, assets, holder, conditions, notes };
      const term = isReturn
        ? await issueReturnTerm({ ...input, returnLocation: effectiveReturnLocation, receivedByName })
        : await issueResponsibilityTerm(input);
      printTerm(term, { win });
      toast.success(`${term.number} emitido.`, {
        description: 'Colete a assinatura e anexe o termo assinado (PDF ou foto) em Termos: ele é concluído sozinho.',
        duration: 8000,
      });
      onIssued?.(term);
      onClose();
    } catch (error) {
      console.error(error);
      win?.close();
      toast.error(error?.code === 'permission-denied' ? 'Seu perfil não pode emitir termos.' : error.message || 'Erro ao emitir o termo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <TermModalFrame
      icon={copy.icon}
      title={copy.title}
      subtitle={copy.subtitle}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <button
            type="button"
            onClick={preview}
            disabled={assets.length === 0}
            className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-40"
          >
            <Eye size={15} /> Pré-visualizar rascunho
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="px-5 py-3 rounded-xl bg-brand text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-brand/30 disabled:opacity-40 disabled:shadow-none"
          >
            <Printer size={15} /> {busy ? 'Registrando…' : copy.action}
          </button>
        </div>
      }
    >
      <section>
        <SectionTitle>{copy.person}</SectionTitle>
        <PersonFields value={holder} onChange={setHolder} title="Colaborador" idPrefix={`term-${kind}`} />
      </section>

      <TermAssetsEditor
        assets={assets}
        onChange={setAssets}
        conditions={conditions}
        onConditionsChange={setConditions}
        conditionLabel={copy.condition}
        filter={pickerFilter}
        blockReason={blockReason}
        emptyText={isReturn ? 'Adicione os equipamentos que estão sendo devolvidos.' : 'Adicione os equipamentos entregues.'}
      />

      {otherHolders.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs font-bold text-amber-700 dark:text-amber-300">
          <Info size={14} className="shrink-0 mt-0.5" />
          {otherHolders.length} item(ns) estão registrados com outra pessoa ({otherHolders.map((a) => a.assignedTo).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')}).
        </p>
      )}

      {isReturn && (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="return-location" className={labelClass}>Local onde foi recebido</label>
            <LocationSelect
              id="return-location"
              value={effectiveReturnLocation}
              onChange={(e) => setReturnLocation(e.target.value)}
              groupBy="kind"
              emptyLabel="Manter o local atual dos ativos"
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="return-receiver" className={labelClass}>Recebido por (TI)</label>
            <input id="return-receiver" value={receivedByName} onChange={(e) => setReceivedByName(e.target.value)} className={fieldClass} />
          </div>
        </section>
      )}

      <section>
        <label htmlFor={`term-notes-${kind}`} className={labelClass}>Observações (saem no termo)</label>
        <textarea
          id={`term-notes-${kind}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={`${fieldClass} resize-y`}
          placeholder={isReturn ? 'Ex.: devolvido sem o carregador; tela com riscos leves.' : 'Ex.: equipamento novo, lacrado; acompanha mochila.'}
        />
      </section>

      <p className="flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400">
        <Info size={13} className="shrink-0 mt-0.5 text-brand" />
        {isReturn
          ? 'Ao registrar, os itens ficam sem responsável e voltam como "Disponível" (ou "Defeito", se marcados como avariados).'
          : `Ao emitir, os itens passam para o nome de ${holder.name || 'quem recebe'}; os que estavam "Disponível" viram "Em Uso". O termo fica aguardando assinatura até o assinado ser anexado em Termos.`}
      </p>
    </TermModalFrame>
  );
};

export default TermIssueModal;

// src/components/terms/TransferModal.jsx
import React, { useMemo, useState } from 'react';
import { ArrowRight, Eye, Info, MapPin, Send, Store, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { useLocations } from '../../hooks/useLocations';
import { useTermPrinter } from '../../hooks/useTermPrinter';
import { dispatchTransfer } from '../../services/termService';
import { findHeadquarters, locationKind } from '../../services/locationService';
import { cleanPlace, EMPTY_PERSON, snapshotAsset, transferBlocker, TRANSPORT_MODES } from '../../utils/terms';
import LocationSelect from '../LocationSelect';
import PersonFields from './PersonFields';
import TermAssetsEditor from './TermAssetsEditor';
import { SectionTitle, TermModalFrame } from './termUi';
import { fieldClass, labelClass } from './termStyles';

const PlaceCard = ({ label, place, tone }) => (
  <div className={`flex-1 min-w-0 rounded-2xl border p-3 ${tone}`}>
    <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
    <p className="mt-1 text-sm font-black truncate flex items-center gap-1.5">
      {place?.kind === 'loja' ? <Store size={13} /> : <MapPin size={13} />} {place?.name || 'Selecione…'}
    </p>
    {place?.address && <p className="text-[11px] opacity-80 truncate">{place.address}</p>}
  </div>
);

/**
 * Transferencia de ativos entre unidades (tipicamente matriz -> loja), com
 * emissao do Termo de Transferencia e Recebimento. Os ativos ficam
 * "Em Trânsito" ate a loja confirmar o recebimento em Termos.
 */
const TransferModal = ({ initialAssets = [], onClose, onDispatched }) => {
  const { currentUser } = useAuth();
  const { locations } = useLocations();
  const { printTerm, openWindow } = useTermPrinter();

  const headquarters = findHeadquarters(locations);
  const [assets, setAssets] = useState(initialAssets);
  const [conditions, setConditions] = useState({});
  const [originName, setOriginName] = useState(null); // null = sugestao (matriz)
  const [destinationName, setDestinationName] = useState('');
  const [receiver, setReceiver] = useState({ ...EMPTY_PERSON });
  const [transport, setTransport] = useState({ mode: TRANSPORT_MODES[0], carrier: '', document: '' });
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const effectiveOrigin = originName === null ? headquarters?.name || initialAssets[0]?.location || '' : originName;
  const byName = useMemo(() => Object.fromEntries(locations.map((l) => [l.name, l])), [locations]);
  const originLoc = byName[effectiveOrigin] || { name: effectiveOrigin };
  const destinationLoc = byName[destinationName] || (destinationName ? { name: destinationName } : null);

  const blocked = assets.filter((a) => transferBlocker(a));
  const outsideOrigin = assets.filter((a) => a.location && effectiveOrigin && a.location !== effectiveOrigin);
  const canSubmit = assets.length > 0 && effectiveOrigin && destinationName && destinationName !== effectiveOrigin && blocked.length === 0 && !busy;

  const chooseDestination = (name) => {
    setDestinationName(name);
    const loc = byName[name];
    // Sugere o responsavel da loja como recebedor, sem sobrescrever o que ja foi escolhido.
    if (loc && !receiver.name) setReceiver({ ...EMPTY_PERSON, name: loc.manager || '', branch: loc.name });
  };

  const termDraft = () => ({
    kind: 'transferencia',
    status: 'em_transito',
    origin: cleanPlace(originLoc),
    destination: cleanPlace(destinationLoc || {}),
    receiver,
    transport,
    expectedAt,
    notes,
    issuedByName: currentUser?.name,
    assets: assets.map((a) => snapshotAsset(a, conditions[a.id])),
    issuedAtDate: new Date(),
  });

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const win = openWindow();
    try {
      const term = await dispatchTransfer({
        tenantId: currentUser.tenantId,
        user: currentUser,
        assets,
        origin: originLoc,
        destination: destinationLoc,
        receiver,
        transport,
        expectedAt,
        conditions,
        notes,
      });
      printTerm(term, { win });
      toast.success(`${term.number}: ${assets.length} item(ns) em trânsito para ${destinationName}.`);
      onDispatched?.(term);
      onClose();
    } catch (error) {
      console.error(error);
      win?.close();
      toast.error(error?.code === 'permission-denied' ? 'Seu perfil não pode transferir ativos.' : error.message || 'Erro ao registrar a transferência.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <TermModalFrame
      icon={Truck}
      wide
      title="Transferência para loja"
      subtitle="Emite o Termo de Transferência e Recebimento. Os itens ficam em trânsito até a loja confirmar."
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <button
            type="button"
            onClick={() => printTerm(termDraft(), { draft: true })}
            disabled={assets.length === 0 || !destinationName}
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
            <Send size={15} /> {busy ? 'Registrando…' : 'Emitir termo e enviar'}
          </button>
        </div>
      }
    >
      <section>
        <SectionTitle>Rota</SectionTitle>
        <div className="flex flex-col sm:flex-row items-stretch gap-2">
          <PlaceCard label="Origem" place={{ ...originLoc, kind: locationKind(originLoc) }} tone="border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200" />
          <div className="flex items-center justify-center text-gray-300 dark:text-slate-600"><ArrowRight size={22} className="rotate-90 sm:rotate-0" /></div>
          <PlaceCard
            label="Destino"
            place={destinationLoc ? { ...destinationLoc, kind: locationKind(destinationLoc) } : null}
            tone={destinationLoc ? 'border-brand/40 bg-brand/5 text-gray-900 dark:text-white' : 'border-dashed border-gray-300 dark:border-slate-600 text-gray-400'}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div>
            <label htmlFor="transfer-origin" className={labelClass}>Origem</label>
            <LocationSelect id="transfer-origin" value={effectiveOrigin} onChange={(e) => setOriginName(e.target.value)} groupBy="kind" emptyLabel="Selecione a origem…" showManageLink className={fieldClass} />
          </div>
          <div>
            <label htmlFor="transfer-destination" className={labelClass}>Destino (loja) *</label>
            <LocationSelect id="transfer-destination" value={destinationName} onChange={(e) => chooseDestination(e.target.value)} groupBy="kind" exclude={effectiveOrigin} emptyLabel="Selecione a loja de destino…" showManageLink className={fieldClass} />
          </div>
        </div>
        {!headquarters && locations.length > 0 && (
          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400 flex items-start gap-1.5">
            <Info size={12} className="shrink-0 mt-0.5 text-brand" /> Dica: marque a matriz em Configurações → Filiais e locais para ela vir sempre como origem.
          </p>
        )}
      </section>

      <TermAssetsEditor
        assets={assets}
        onChange={setAssets}
        conditions={conditions}
        onConditionsChange={setConditions}
        conditionLabel="Estado no envio"
        blockReason={transferBlocker}
        emptyText="Adicione os equipamentos que vão para a loja."
      />

      {outsideOrigin.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs font-bold text-amber-700 dark:text-amber-300">
          <Info size={14} className="shrink-0 mt-0.5" />
          {outsideOrigin.length} item(ns) não estão registrados em {effectiveOrigin} ({[...new Set(outsideOrigin.map((a) => a.location))].join(', ')}). Confira antes de enviar.
        </p>
      )}

      <section>
        <SectionTitle>Quem recebe na loja</SectionTitle>
        <PersonFields value={receiver} onChange={setReceiver} title="Recebedor" preferBranch={destinationName} idPrefix="transfer-receiver" />
      </section>

      <section>
        <SectionTitle>Transporte</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="transfer-mode" className={labelClass}>Meio de transporte</label>
            <select id="transfer-mode" value={transport.mode} onChange={(e) => setTransport({ ...transport, mode: e.target.value })} className={fieldClass}>
              {TRANSPORT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="transfer-carrier" className={labelClass}>Transportador / motorista</label>
            <input id="transfer-carrier" value={transport.carrier} onChange={(e) => setTransport({ ...transport, carrier: e.target.value })} className={fieldClass} placeholder="Nome de quem leva" />
          </div>
          <div>
            <label htmlFor="transfer-document" className={labelClass}>NF / romaneio</label>
            <input id="transfer-document" value={transport.document} onChange={(e) => setTransport({ ...transport, document: e.target.value })} className={fieldClass} placeholder="Opcional" />
          </div>
          <div>
            <label htmlFor="transfer-expected" className={labelClass}>Previsão de chegada</label>
            <input id="transfer-expected" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} className={fieldClass} />
          </div>
        </div>
      </section>

      <section>
        <label htmlFor="transfer-notes" className={labelClass}>Observações (saem no termo)</label>
        <textarea id="transfer-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${fieldClass} resize-y`} placeholder="Ex.: caixa lacrada; entregar ao gerente." />
      </section>
    </TermModalFrame>
  );
};

export default TransferModal;

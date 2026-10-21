// src/components/audit/AuditReport.jsx
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download, MapPin, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import { moveAsset } from '../../services/assetService';
import { lifecycleBlocker } from '../../utils/assetStatus';
import { sameLocation, SCAN_RESULTS } from '../../utils/audit';
import { auditPdfName, buildAuditPdf } from '../../utils/auditReport';

const SECTIONS = [
  { result: 'missing', hint: 'Não foram lidos no local. Procure o equipamento; se sumiu, dê baixa como extraviado na tela do ativo.' },
  { result: 'other_location', hint: 'Estão aqui, mas o cadastro aponta outro local. Corrija o cadastro ou devolva o equipamento.' },
  { result: 'retired', hint: 'Constam como baixados, mas estão no local. Reative ou recolha.' },
  { result: 'transit_out', hint: 'Foram enviados com termo de transferência, mas ainda estão aqui.' },
  { result: 'transit_in', hint: 'Chegaram de uma transferência: anexe o termo assinado em Termos para concluir.' },
  { result: 'unknown', hint: 'Códigos lidos que não existem no cadastro.' },
  { result: 'found', hint: 'Conferidos no local.' },
];

const TONE = {
  green: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/20 dark:text-green-300',
  rose: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300',
  blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-300',
  slate: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
};

/** Relatorio de uma auditoria salva, com acoes de correcao. */
const AuditReport = ({ audit, assets, currentUser, canWrite, onBack }) => {
  const [exporting, setExporting] = useState(false);
  const [moving, setMoving] = useState(null);
  const [moved, setMoved] = useState(() => new Set());
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const stats = audit.stats || {};
  const accuracy = stats.accuracy ?? (stats.expected ? Math.round((stats.found / stats.expected) * 100) : 100);

  const exportPdf = async () => {
    setExporting(true);
    try {
      const pdf = await buildAuditPdf(audit, { companyName: currentUser?.companyName });
      pdf.save(auditPdfName(audit));
    } catch (error) {
      console.error(error);
      toast.error('Erro ao gerar o PDF.');
    } finally {
      setExporting(false);
    }
  };

  const bringHere = async (item) => {
    const asset = byId.get(item.assetId);
    if (!asset) return;
    setMoving(item.assetId);
    try {
      await moveAsset(asset.id, asset, {
        newLocation: audit.location,
        newResponsible: asset.assignedTo || '',
        newCpf: asset.clientCpf || '',
        reason: `Encontrado na auditoria de ${audit.location}`,
      }, currentUser?.email || 'Sistema');
      setMoved((prev) => new Set(prev).add(item.assetId));
      toast.success(`${asset.internalId} agora está em ${audit.location}.`);
    } catch (error) {
      toast.error(error.message || 'Não foi possível mover o ativo.');
    } finally {
      setMoving(null);
    }
  };

  // Relatorios antigos so tinham listas de patrimonios.
  const items = audit.items?.length
    ? audit.items
    : [
      ...(audit.missingItems || []).map((code) => ({ internalId: code, result: 'missing' })),
      ...(audit.intruderItems || []).map((code) => ({ internalId: code, result: 'other_location' })),
    ];

  return (
    <div className="max-w-5xl mx-auto pb-24 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <button type="button" onClick={onBack} aria-label="Voltar" className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300"><ArrowLeft size={18} /></button>
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-gray-400">Relatório de auditoria</p>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2"><MapPin size={20} className="text-brand" /> {audit.location}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {audit.dateValue ? audit.dateValue.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }) : '—'} · {audit.auditedByName || audit.auditedBy} · {audit.status}
            </p>
          </div>
        </div>
        <button type="button" onClick={exportPdf} disabled={exporting} className="self-start px-4 py-2.5 rounded-xl bg-brand text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-50">
          {exporting ? <RefreshCcw size={15} className="animate-spin" /> : <Download size={15} />} Exportar PDF
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ['Acuracidade', `${accuracy}%`],
          ['Conferidos', `${stats.found ?? 0}/${stats.expected ?? 0}`],
          ['Não localizados', stats.missing ?? 0],
          ['De outro local', stats.intruders ?? 0],
          ['Pelo agente', stats.byAgent ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-4 text-center">
            <p className="text-2xl font-black text-gray-900 dark:text-white tabular-nums">{value}</p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      {audit.notes && (
        <p className="rounded-2xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 p-4 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
          <span className="block text-[10px] font-black uppercase text-gray-400 mb-1">Observações</span>{audit.notes}
        </p>
      )}

      {SECTIONS.map(({ result, hint }) => {
        const list = items.filter((i) => i.result === result);
        if (!list.length) return null;
        const meta = SCAN_RESULTS[result];
        return (
          <section key={result} className={`rounded-2xl border p-4 space-y-3 ${TONE[meta.tone]}`}>
            <div>
              <h2 className="font-black text-sm uppercase tracking-wider">{meta.label} ({list.length})</h2>
              <p className="text-xs opacity-80">{hint}</p>
            </div>
            <ul className="divide-y divide-black/5 dark:divide-white/5 rounded-xl bg-white/70 dark:bg-slate-900/60">
              {list.map((item) => {
                const live = item.assetId ? byId.get(item.assetId) : null;
                const canBring = canWrite && result === 'other_location' && live && !lifecycleBlocker(live) && !sameLocation(live.location, audit.location) && !moved.has(item.assetId);
                return (
                  <li key={`${item.assetId}-${item.internalId}`} className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 text-gray-800 dark:text-gray-100">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">
                        {live ? <Link to={`/assets/${live.id}`} className="hover:underline font-mono">{item.internalId}</Link> : <span className="font-mono">{item.internalId}</span>}
                        {item.model && <span className="font-normal text-gray-500 dark:text-gray-400"> · {item.model}</span>}
                      </p>
                      {item.from && result !== 'found' && result !== 'missing' && <p className="text-[11px] text-gray-500 dark:text-gray-400">Cadastro na época: {item.from}{live && !sameLocation(live.location, item.from) ? ` · hoje: ${live.location}` : ''}</p>}
                      {item.method === 'agent' && <p className="text-[11px] text-indigo-600 dark:text-indigo-300">Presença confirmada pelo Agente ITAM</p>}
                    </div>
                    {canBring && (
                      <button type="button" onClick={() => bringHere(item)} disabled={moving === item.assetId} className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[10px] font-black uppercase tracking-wider disabled:opacity-50">
                        {moving === item.assetId ? 'Movendo…' : `Trazer para ${audit.location}`}
                      </button>
                    )}
                    {moved.has(item.assetId) && <span className="text-[10px] font-black uppercase text-green-600">Movido</span>}
                    {(result === 'missing' || result === 'retired') && live && (
                      <Link to={`/assets/${live.id}`} className="shrink-0 text-[10px] font-black uppercase tracking-wider underline">
                        {result === 'missing' ? 'Abrir para dar baixa' : 'Abrir para reativar'}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
};

export default AuditReport;

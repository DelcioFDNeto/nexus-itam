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
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300',
  rose: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300',
  amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300',
  blue: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-300',
  slate: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-zinc-800 dark:bg-[#111113] dark:text-zinc-300',
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
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2.5 rounded-xl bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-900 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-zinc-400">Relatório de auditoria</p>
            <h1 className="text-2xl font-black text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
              <MapPin size={20} className="text-brand-aa" aria-hidden="true" /> {audit.location}
            </h1>
            <p className="text-sm text-slate-600 dark:text-zinc-400 tabular-nums">
              {audit.dateValue ? audit.dateValue.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }) : '—'} · {audit.auditedByName || audit.auditedBy} · {audit.status}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={exportPdf}
          disabled={exporting}
          className="min-h-[44px] self-start px-4 py-2.5 rounded-xl bg-brand hover:bg-brand-dark text-brand-fg text-xs font-black uppercase tracking-wider flex items-center gap-2 disabled:opacity-50 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {exporting ? <RefreshCcw size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />} Exportar PDF
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
          <div key={label} className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 p-4 text-center shadow-sm">
            <p className="text-2xl font-black text-slate-900 dark:text-[#fafafa] tabular-nums">{value}</p>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {audit.notes && (
        <p className="rounded-2xl bg-white dark:bg-[#111113] border border-slate-200/90 dark:border-zinc-800 p-4 text-sm text-slate-700 dark:text-zinc-200 whitespace-pre-wrap">
          <span className="block text-xs font-black uppercase text-slate-500 dark:text-zinc-400 mb-1">Observações</span>{audit.notes}
        </p>
      )}

      {SECTIONS.map(({ result, hint }) => {
        const list = items.filter((i) => i.result === result);
        if (!list.length) return null;
        const meta = SCAN_RESULTS[result];
        return (
          <section key={result} className={`rounded-2xl border p-4 space-y-3 ${TONE[meta.tone]}`}>
            <div>
              <h2 className="font-black text-sm uppercase tracking-wider tabular-nums">{meta.label} ({list.length})</h2>
              <p className="text-xs opacity-90">{hint}</p>
            </div>
            <ul className="divide-y divide-black/5 dark:divide-zinc-800 rounded-xl bg-white/85 dark:bg-[#111113]/90">
              {list.map((item) => {
                const live = item.assetId ? byId.get(item.assetId) : null;
                const canBring = canWrite && result === 'other_location' && live && !lifecycleBlocker(live) && !sameLocation(live.location, audit.location) && !moved.has(item.assetId);
                return (
                  <li key={`${item.assetId}-${item.internalId}`} className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 text-slate-800 dark:text-zinc-100">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">
                        {live ? (
                          <Link to={`/assets/${live.id}`} className="hover:underline font-mono rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                            {item.internalId}
                          </Link>
                        ) : (
                          <span className="font-mono">{item.internalId}</span>
                        )}
                        {item.model && <span className="font-normal text-slate-500 dark:text-zinc-400"> · {item.model}</span>}
                      </p>
                      {item.from && result !== 'found' && result !== 'missing' && (
                        <p className="text-xs text-slate-600 dark:text-zinc-400">
                          Cadastro na época: {item.from}{live && !sameLocation(live.location, item.from) ? ` · hoje: ${live.location}` : ''}
                        </p>
                      )}
                      {item.method === 'agent' && <p className="text-xs text-sky-700 dark:text-sky-300 font-medium">Presença confirmada pelo Agente ITAM</p>}
                    </div>
                    {canBring && (
                      <button
                        type="button"
                        onClick={() => bringHere(item)}
                        disabled={moving === item.assetId}
                        className="min-h-[44px] shrink-0 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white dark:bg-[#fafafa] dark:hover:bg-zinc-200 dark:text-[#09090b] text-xs font-black uppercase tracking-wider disabled:opacity-50 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        {moving === item.assetId ? 'Movendo…' : `Trazer para ${audit.location}`}
                      </button>
                    )}
                    {moved.has(item.assetId) && <span className="text-xs font-black uppercase text-emerald-700 dark:text-emerald-400">Movido</span>}
                    {(result === 'missing' || result === 'retired') && live && (
                      <Link
                        to={`/assets/${live.id}`}
                        className="min-h-[44px] inline-flex items-center px-2 rounded-lg shrink-0 text-xs font-black uppercase tracking-wider underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
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

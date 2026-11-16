// src/components/settings/DocumentsSection.jsx
import React from 'react';
import { FileSignature, FileText, RotateCcw, Truck } from 'lucide-react';
import { ARRIVAL_STATUSES, DEFAULT_TERM_CLAUSES, DEFAULT_TRANSFER_CLAUSES } from '../../utils/terms';
import { Card, Field, SectionHeader } from './settingsUi';
import { inputClass } from './settingsStyles';

const LoadDefault = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="mt-2 min-h-[44px] px-1 rounded-lg text-xs font-bold text-brand-aa hover:underline inline-flex items-center gap-1.5 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
  >
    <RotateCcw size={14} aria-hidden="true" /> Carregar texto padrão para editar
  </button>
);

/** Termos de responsabilidade, devolucao e transferencia. */
const DocumentsSection = ({ config, set }) => (
  <div className="space-y-6">
    <SectionHeader icon={FileText} title="Termos e documentos" description="Texto e regras dos termos de responsabilidade, devolução e transferência." />

    <Card icon={FileSignature} title="Termo de responsabilidade" subtitle="Entrega de equipamento a um colaborador">
      <Field label="Título do termo" htmlFor="cfg-term-title">
        <input id="cfg-term-title" name="termTitle" className={inputClass} value={config.termTitle} onChange={(e) => set('termTitle', e.target.value)} placeholder="Termo de Responsabilidade" />
      </Field>
      <Field label="Cláusulas" hint="Uma cláusula por linha. Em branco, o termo usa o texto padrão (CLT Art. 462 e Código Civil)." htmlFor="cfg-term-clauses">
        <textarea id="cfg-term-clauses" name="termClauses" value={config.termClauses} onChange={(e) => set('termClauses', e.target.value)} className={`${inputClass} h-36 resize-y font-medium`} placeholder="1. DO USO E FINALIDADE: …" />
        <LoadDefault onClick={() => set('termClauses', DEFAULT_TERM_CLAUSES)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
        <Field label="Cidade (data dos termos)" hint="Ex.: Belém. Sai como “Belém, 9 de outubro de 2026”." htmlFor="cfg-term-city">
          <input id="cfg-term-city" name="termCity" className={inputClass} value={config.termCity} onChange={(e) => set('termCity', e.target.value)} placeholder="Em branco: preencher à mão" />
        </Field>
        <label htmlFor="cfg-term-show-value" className="flex items-center gap-2.5 min-h-[44px] sm:pb-4 text-xs font-bold text-slate-700 dark:text-zinc-300 cursor-pointer">
          <input id="cfg-term-show-value" name="cfg-term-show-value" type="checkbox" checked={Boolean(config.termShowValue)} onChange={(e) => set('termShowValue', e.target.checked)} className="h-4 w-4 accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed" />
          Mostrar o valor dos bens
        </label>
        <label htmlFor="cfg-term-witnesses" className="flex items-center gap-2.5 min-h-[44px] sm:pb-4 text-xs font-bold text-slate-700 dark:text-zinc-300 cursor-pointer">
          <input id="cfg-term-witnesses" name="cfg-term-witnesses" type="checkbox" checked={Boolean(config.termWitnesses)} onChange={(e) => set('termWitnesses', e.target.checked)} className="h-4 w-4 accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed" />
          Incluir duas testemunhas
        </label>
      </div>
    </Card>

    <Card icon={Truck} title="Termo de transferência" subtitle="Envio da matriz para as lojas, com recebimento">
      <Field label="Condições da transferência" hint="Uma condição por linha; em branco usa o texto padrão." htmlFor="cfg-transfer-clauses">
        <textarea id="cfg-transfer-clauses" name="transferClauses" value={config.transferClauses} onChange={(e) => set('transferClauses', e.target.value)} className={`${inputClass} h-28 resize-y font-medium`} placeholder="1. DA CONFERÊNCIA: …" />
        <LoadDefault onClick={() => set('transferClauses', DEFAULT_TRANSFER_CLAUSES)} />
      </Field>

      <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/40 p-4 space-y-3">
        <div>
          <p className="text-xs font-black text-slate-900 dark:text-[#fafafa]">Conclusão automática</p>
          <p className="text-xs text-slate-600 dark:text-zinc-400 mt-0.5">
            Ao anexar o termo assinado, o sistema conclui sozinho: a transferência vira &ldquo;Recebido&rdquo; e os itens passam para a loja; o termo de responsabilidade vira &ldquo;Assinado&rdquo;.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <Field label="Itens que chegam na loja ficam" htmlFor="cfg-arrival">
            <select id="cfg-arrival" name="transferArrivalStatus" className={inputClass} value={config.transferArrivalStatus} onChange={(e) => set('transferArrivalStatus', e.target.value)}>
              {ARRIVAL_STATUSES.map((status) => <option key={status} value={status}>{status === 'Disponível' ? 'Disponível (estoque da loja)' : status}</option>)}
            </select>
          </Field>
          <label htmlFor="cfg-transfer-assign-receiver" className="flex items-center gap-2.5 min-h-[44px] pb-1 text-xs font-bold text-slate-700 dark:text-zinc-300 cursor-pointer">
            <input id="cfg-transfer-assign-receiver" name="cfg-transfer-assign-receiver" type="checkbox" checked={Boolean(config.transferAssignReceiver)} onChange={(e) => set('transferAssignReceiver', e.target.checked)} className="h-4 w-4 accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed" />
            Registrar o recebedor como responsável pelos itens
          </label>
          <Field label="Pendência atrasada após (dias)" hint="Sem previsão de chegada, vale este prazo." htmlFor="cfg-overdue">
            <input
              id="cfg-overdue"
              name="termOverdueDays"
              type="number"
              min={1}
              max={90}
              className={inputClass}
              value={config.termOverdueDays ?? ''}
              onChange={(e) => set('termOverdueDays', e.target.value)}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                if (!raw) {
                  set('termOverdueDays', 30);
                  return;
                }
                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) {
                  set('termOverdueDays', 30);
                  return;
                }
                set('termOverdueDays', Math.min(90, Math.max(1, Math.round(parsed))));
              }}
            />
          </Field>
        </div>
      </div>
    </Card>
  </div>
);

export default DocumentsSection;

// src/components/settings/DocumentsSection.jsx
import React from 'react';
import { FileSignature, FileText, RotateCcw, Truck } from 'lucide-react';
import { ARRIVAL_STATUSES, DEFAULT_TERM_CLAUSES, DEFAULT_TRANSFER_CLAUSES } from '../../utils/terms';
import { Card, Field, SectionHeader } from './settingsUi';
import { inputClass } from './settingsStyles';

const LoadDefault = ({ onClick }) => (
  <button type="button" onClick={onClick} className="mt-2 text-xs font-bold text-brand hover:underline flex items-center gap-1">
    <RotateCcw size={12} /> Carregar texto padrão para editar
  </button>
);

/** Termos de responsabilidade, devolucao e transferencia. */
const DocumentsSection = ({ config, set }) => (
  <div className="space-y-6">
    <SectionHeader icon={FileText} title="Termos e documentos" description="Texto e regras dos termos de responsabilidade, devolução e transferência." />

    <Card icon={FileSignature} title="Termo de responsabilidade" subtitle="Entrega de equipamento a um colaborador">
      <Field label="Título do termo" htmlFor="cfg-term-title">
        <input id="cfg-term-title" className={inputClass} value={config.termTitle} onChange={(e) => set('termTitle', e.target.value)} placeholder="Termo de Responsabilidade" />
      </Field>
      <Field label="Cláusulas" hint="Uma cláusula por linha. Em branco, o termo usa o texto padrão (CLT Art. 462 e Código Civil)." htmlFor="cfg-term-clauses">
        <textarea id="cfg-term-clauses" value={config.termClauses} onChange={(e) => set('termClauses', e.target.value)} className={`${inputClass} h-36 resize-y font-medium`} placeholder="1. DO USO E FINALIDADE: ..." />
        <LoadDefault onClick={() => set('termClauses', DEFAULT_TERM_CLAUSES)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
        <Field label="Cidade (data dos termos)" hint="Ex.: Belém. Sai como “Belém, 9 de outubro de 2026”." htmlFor="cfg-term-city">
          <input id="cfg-term-city" className={inputClass} value={config.termCity} onChange={(e) => set('termCity', e.target.value)} placeholder="Em branco: preencher à mão" />
        </Field>
        <label className="flex items-center gap-2 pb-6 text-xs font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" checked={Boolean(config.termShowValue)} onChange={(e) => set('termShowValue', e.target.checked)} className="h-4 w-4" />
          Mostrar o valor dos bens
        </label>
        <label className="flex items-center gap-2 pb-6 text-xs font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
          <input type="checkbox" checked={Boolean(config.termWitnesses)} onChange={(e) => set('termWitnesses', e.target.checked)} className="h-4 w-4" />
          Incluir duas testemunhas
        </label>
      </div>
    </Card>

    <Card icon={Truck} title="Termo de transferência" subtitle="Envio da matriz para as lojas, com recebimento">
      <Field label="Condições da transferência" hint="Uma condição por linha; em branco usa o texto padrão." htmlFor="cfg-transfer-clauses">
        <textarea id="cfg-transfer-clauses" value={config.transferClauses} onChange={(e) => set('transferClauses', e.target.value)} className={`${inputClass} h-28 resize-y font-medium`} placeholder="1. DA CONFERÊNCIA: ..." />
        <LoadDefault onClick={() => set('transferClauses', DEFAULT_TRANSFER_CLAUSES)} />
      </Field>

      <div className="rounded-xl border border-gray-200 dark:border-slate-600 p-4 space-y-3">
        <div>
          <p className="text-xs font-black text-gray-800 dark:text-gray-100">Conclusão automática</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Ao anexar o termo assinado, o sistema conclui sozinho: a transferência vira "Recebido" e os itens passam para a loja; o termo de responsabilidade vira "Assinado".
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <Field label="Itens que chegam na loja ficam" htmlFor="cfg-arrival">
            <select id="cfg-arrival" className={inputClass} value={config.transferArrivalStatus} onChange={(e) => set('transferArrivalStatus', e.target.value)}>
              {ARRIVAL_STATUSES.map((status) => <option key={status} value={status}>{status === 'Disponível' ? 'Disponível (estoque da loja)' : status}</option>)}
            </select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-xs font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={Boolean(config.transferAssignReceiver)} onChange={(e) => set('transferAssignReceiver', e.target.checked)} className="h-4 w-4" />
            Registrar o recebedor como responsável pelos itens
          </label>
          <Field label="Pendência atrasada após (dias)" hint="Sem previsão de chegada, vale este prazo." htmlFor="cfg-overdue">
            <input id="cfg-overdue" type="number" min={1} max={90} className={inputClass} value={config.termOverdueDays} onChange={(e) => set('termOverdueDays', Number(e.target.value) || '')} />
          </Field>
        </div>
      </div>
    </Card>
  </div>
);

export default DocumentsSection;

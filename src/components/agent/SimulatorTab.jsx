// src/components/agent/SimulatorTab.jsx
import React, { useState } from 'react';
import { AlertTriangle, FileJson, Play, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { enqueueAgentSubmission, loadAgentContext, previewAgentPayload } from '../../services/agentService';

const SAMPLE = {
  agentVersion: '2.0.0',
  deviceId: '6f1c2a3b-0000-4000-8000-000000000001',
  hostname: 'LOJA-PDV-01',
  loggedUser: 'EMPRESA\\joao.silva',
  serialNumber: 'Default string',
  os: { name: 'Microsoft Windows 11 Pro', build: '22631', lastBoot: new Date().toISOString() },
  hardware: { manufacturer: 'Dell Inc.', model: 'OptiPlex 3080', processor: 'Intel Core i5-10500', ramGb: 16, pc_system_type: 1 },
  network: [{ name: 'Ethernet', mac: '00:11:22:AA:BB:CC', ip: '192.168.0.10', gateway: '192.168.0.1' }],
  volumes: [{ drive: 'C:', sizeGb: 237.9, freeGb: 120.4, encrypted: false }],
  security: { antivirus: [{ name: 'Microsoft Defender', enabled: true, upToDate: true }], firewall: 'Domain, Private, Public' },
  software: [{ name: 'Google Chrome', version: '130.0' }, { name: 'Microsoft Office Professional Plus 2019', version: '16.0' }],
};

/** Testa um inventario (JSON do agente) sem instalar nada: mostra o que aconteceria. */
const SimulatorTab = ({ tenantId, onQueued }) => {
  const [json, setJson] = useState(JSON.stringify(SAMPLE, null, 2));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const parse = () => {
    const parsed = JSON.parse(json);
    return parsed.payload || parsed;
  };

  const analyze = async () => {
    setBusy(true);
    try {
      const ctx = await loadAgentContext(tenantId);
      setResult(await previewAgentPayload(parse(), { tenantId, context: ctx }));
    } catch (error) {
      setResult(null);
      toast.error(`JSON inválido ou incompleto: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const enqueue = async () => {
    setBusy(true);
    try {
      await enqueueAgentSubmission(parse(), 'Simulador', tenantId);
      toast.success('Enviado para a fila. Incorpore pela aba "Fila".');
      onQueued?.();
    } catch (error) {
      toast.error(error.message || 'Erro ao enviar para a fila.');
    } finally {
      setBusy(false);
    }
  };

  const load = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then(setJson);
    event.target.value = '';
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      <section className="xl:col-span-3 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 space-y-3">
        <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2"><FileJson size={16} /> Inventário (JSON)</h3>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          spellCheck={false}
          aria-label="JSON do inventário"
          className="w-full h-80 p-4 rounded-xl bg-gray-900 text-cyan-100 font-mono text-xs outline-none border border-gray-800 focus:ring-2 focus:ring-brand resize-y"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={analyze} disabled={busy} className="px-4 py-2.5 rounded-xl bg-brand text-white text-xs font-black uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-40">
            <Play size={14} /> Analisar
          </button>
          <button type="button" onClick={enqueue} disabled={busy} className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-black uppercase tracking-wider text-gray-700 dark:text-gray-200 disabled:opacity-40">
            Enviar para a fila
          </button>
          <label className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-black uppercase tracking-wider text-gray-700 dark:text-gray-200 flex items-center gap-1.5 cursor-pointer">
            <UploadCloud size={14} /> Abrir arquivo
            <input type="file" accept=".json,application/json" onChange={load} className="sr-only" />
          </label>
        </div>
      </section>

      <aside className="xl:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 space-y-3 self-start">
        {!result ? (
          <p className="text-sm text-gray-400">Cole um inventário e clique em Analisar para ver como ele entraria no inventário: identidade, patrimônio, local, responsável e alertas.</p>
        ) : (
          <>
            <p className="font-black text-sm text-gray-900 dark:text-white">
              {result.duplicate ? `Atualizaria ${result.duplicate.internalId} (por ${result.duplicate.matchField})` : `Criaria ${result.internalId}`}
            </p>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-[10px] font-black uppercase text-gray-400">Tipo</dt><dd className="font-bold">{result.inventory.type}</dd></div>
              <div><dt className="text-[10px] font-black uppercase text-gray-400">Serial útil</dt><dd className="font-mono font-bold">{result.inventory.serialNumber || 'não (genérico)'}</dd></div>
              <div><dt className="text-[10px] font-black uppercase text-gray-400">Local pela rede</dt><dd className="font-bold">{result.location || '—'}</dd></div>
              <div><dt className="text-[10px] font-black uppercase text-gray-400">Colaborador</dt><dd className="font-bold">{result.employee || '—'}</dd></div>
            </dl>
            {result.alerts.map((a) => (
              <p key={a.code} className="text-xs flex items-start gap-1.5 text-amber-700 dark:text-amber-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {a.message}</p>
            ))}
          </>
        )}
      </aside>
    </div>
  );
};

export default SimulatorTab;

// src/components/settings/BackupSection.jsx
import React, { useRef, useState } from 'react';
import { AlertTriangle, Code, Download, EyeOff, FileJson, Info, Play, RefreshCcw, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { generateFullBackup, restoreBackup } from '../../services/backupService';
import { useConfirm } from '../ConfirmDialog';
import { can } from '../../utils/permissions';
import { isoDay } from '../../utils/dates';
import { Card, SectionHeader } from './settingsUi';

const downloadJson = (data, filename) => {
  // Blob em vez de data: URI — backups grandes estouravam o limite de URL.
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Backup completo em JSON e restauracao (somente o proprietario). */
const BackupSection = ({ currentUser }) => {
  const confirm = useConfirm();
  const tenantId = currentUser?.tenantId;
  const canBackup = can(currentUser, 'backup:create');
  const canRestore = can(currentUser, 'backup:restore');
  const fileInputRef = useRef(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreStatus, setRestoreStatus] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [showFormatGuide, setShowFormatGuide] = useState(false);

  const handleFullBackup = async () => {
    setBackupLoading(true);
    try {
      downloadJson(await generateFullBackup(tenantId, false), `BACKUP_NEXUS_${isoDay()}.json`);
      toast.success('Backup gerado.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao gerar backup.');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDownloadTemplate = () =>
    downloadJson(
      {
        meta: { version: '2.0', type: 'full_backup', date: new Date().toISOString() },
        data: { assets: [{ internalId: 'TAG-001', model: 'Exemplo', type: 'Notebook', status: 'Disponível' }], employees: [], history: [], projects: [], tasks: [], sectors: [] },
      },
      'TEMPLATE_IMPORTACAO.json',
    );

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleFile = (file) => {
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      toast.error('Arquivo inválido. Envie um JSON.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (!json.meta || !json.data) {
          toast.error("Estrutura inválida: faltam 'meta' ou 'data'. Consulte o formato esperado.");
          return;
        }
        setImportSummary({
          filename: file.name,
          date: json.meta.date ? new Date(json.meta.date).toLocaleString('pt-BR') : 'N/A',
          counts: Object.keys(json.data).reduce((acc, key) => {
            if (Array.isArray(json.data[key])) acc[key] = json.data[key].length;
            return acc;
          }, {}),
          rawData: json,
        });
      } catch (err) {
        toast.error(`Erro ao ler o arquivo JSON: ${err.message}`);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const confirmRestore = async () => {
    if (!importSummary) return;
    const summary = importSummary;
    const confirmed = await confirm({
      title: 'Confirmar Restauração de Backup',
      message: 'Registros com o mesmo ID serão atualizados e os demais serão criados. Deseja prosseguir?',
      danger: true,
      confirmLabel: 'Restaurar Dados',
    });
    if (!confirmed) return;

    setImportSummary(null);
    setRestoreLoading(true);
    setRestoreProgress(0);
    setRestoreStatus('Inicializando...');
    try {
      const stats = await restoreBackup(summary.rawData, (progress, message) => {
        setRestoreProgress(progress);
        setRestoreStatus(message);
      }, tenantId, currentUser);
      const notes = [
        `Documentos restaurados: ${stats.totalDocsProcessed}`,
        stats.rejectedDocs ? `Recusados (outra empresa ou ID inválido): ${stats.rejectedDocs}` : null,
        stats.skippedCollections.length ? `Ignoradas por segurança: ${stats.skippedCollections.join(', ')}` : null,
        stats.errors.length ? `Erros: ${stats.errors.length}` : null,
      ].filter(Boolean);
      toast.success('Restauração finalizada.', { description: notes.join(' · '), duration: 8000 });
    } catch (error) {
      console.error(error);
      toast.error(`Falha na restauração: ${error.message}`);
    } finally {
      setRestoreLoading(false);
      setRestoreStatus('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader icon={Download} title="Backup e restauração" description="Cópia completa dos dados da empresa em JSON, para guardar fora do sistema." />

      {canBackup && (
        <Card icon={Download} title="Backup" subtitle="Ativos, histórico, termos, equipe, locais e inventário do agente (sem as cópias dos termos assinados)">
          <button onClick={handleFullBackup} disabled={backupLoading} className="w-full sm:w-auto bg-blue-600 text-white px-5 py-3 rounded-xl font-bold hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-60">
            {backupLoading ? <RefreshCcw className="animate-spin" size={18} /> : <FileJson size={18} />}
            {backupLoading ? 'Gerando arquivo...' : 'Baixar backup completo'}
          </button>
        </Card>
      )}

      {canRestore && (
        <Card
          icon={UploadCloud}
          title="Restauração"
          subtitle="Importa um backup JSON desta empresa"
          action={
            <button
              type="button"
              onClick={() => setShowFormatGuide((v) => !v)}
              aria-expanded={showFormatGuide}
              className="text-[10px] font-bold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white flex items-center gap-1 bg-gray-100 dark:bg-slate-700 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600"
            >
              {showFormatGuide ? <EyeOff size={12} /> : <Code size={12} />} {showFormatGuide ? 'Ocultar formato' : 'Ver formato'}
            </button>
          }
        >
          {showFormatGuide && (
            <div className="text-xs space-y-3">
              <div className="flex justify-between items-center">
                <p className="font-bold text-gray-700 dark:text-gray-200 flex items-center gap-1.5"><Info size={14} className="text-blue-500" /> Estrutura esperada</p>
                <button type="button" onClick={handleDownloadTemplate} className="text-[10px] bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 px-2 py-1 rounded font-bold text-gray-700 dark:text-gray-200">Baixar modelo</button>
              </div>
              <pre className="bg-gray-900 text-gray-100 p-3 rounded-xl overflow-x-auto font-mono text-[11px]">{`{
  "meta": { "version": "2.2", "date": "2026-01-01T10:00:00Z" },
  "data": {
    "assets": [ { "internalId": "NB-001", "model": "Dell", ... } ],
    "employees": [ ... ],
    "history": [ ... ],
    "locations": [ ... ],
    "terms": [ ... ]
  }
}`}</pre>
              <p className="flex items-start gap-1.5 text-orange-700 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-300 p-2.5 rounded-lg">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                Registros com o mesmo ID são atualizados; os demais são criados. Usuários, planos, configurações de segurança e cópias pesadas de termos não entram na restauração.
              </p>
            </div>
          )}

          {importSummary ? (
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/50 rounded-xl p-4 space-y-3">
              <p className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-2 text-sm"><FileJson size={16} /> {importSummary.filename}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Gerado em {importSummary.date}</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(importSummary.counts).map(([key, count]) => (
                  <div key={key} className="bg-white dark:bg-slate-800 p-2 rounded text-center border border-gray-100 dark:border-slate-700">
                    <span className="block text-base font-black text-gray-800 dark:text-gray-100">{count}</span>
                    <span className="text-[9px] text-gray-500 dark:text-gray-400 uppercase font-bold">{key}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setImportSummary(null)} className="flex-1 py-2.5 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-200 font-bold rounded-lg text-xs">Cancelar</button>
                <button type="button" onClick={confirmRestore} className="flex-1 py-2.5 bg-blue-600 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1.5"><Play size={14} /> Restaurar</button>
              </div>
            </div>
          ) : restoreLoading ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-3" />
              <p className="font-bold text-lg text-gray-800 dark:text-gray-100">{restoreProgress}%</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{restoreStatus}</p>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              className={`p-6 border-2 border-dashed ${dragActive ? 'border-brand bg-brand/5' : 'border-gray-200 dark:border-slate-600 bg-gray-50/50 dark:bg-slate-900/50'} transition-all text-center rounded-xl cursor-pointer group`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
            >
              <input ref={fileInputRef} type="file" className="hidden" accept=".json" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <UploadCloud size={28} className="mx-auto mb-2 text-gray-400 group-hover:text-orange-500 transition-colors" />
              <p className="font-bold text-sm text-gray-700 dark:text-gray-200">Clique ou arraste o JSON aqui</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">O arquivo é validado antes de importar.</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default BackupSection;

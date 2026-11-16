// src/components/settings/BackupSection.jsx
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Code, Download, EyeOff, FileJson, Info, Play, RefreshCcw, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { generateFullBackup, restoreBackup } from '../../services/backupService';
import { useConfirm } from '../ConfirmDialog';
import { can } from '../../utils/permissions';
import { isoDay } from '../../utils/dates';
import { Card, SectionHeader } from './settingsUi';
import { buttonPrimaryClass, buttonSecondaryClass } from './settingsStyles';

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
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleFullBackup = async () => {
    if (backupLoading) return;
    setBackupLoading(true);
    try {
      const data = await generateFullBackup(tenantId, false);
      if (!isMountedRef.current) return;
      downloadJson(data, `BACKUP_NEXUS_${isoDay()}.json`);
      toast.success('Backup gerado.');
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error('Erro ao gerar backup.');
    } finally {
      if (isMountedRef.current) setBackupLoading(false);
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
    const isJson = file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
    if (!isJson) {
      toast.error('Arquivo inválido. Envie um JSON.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      if (!isMountedRef.current) return;
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
    reader.onerror = () => {
      if (isMountedRef.current) {
        toast.error('Erro ao ler o arquivo selecionado.');
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
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
    if (!importSummary || restoreLoading) return;
    const summary = importSummary;
    const confirmed = await confirm({
      title: 'Confirmar Restauração de Backup',
      message: 'Registros com o mesmo ID serão atualizados e os demais serão criados. Deseja prosseguir?',
      danger: true,
      confirmLabel: 'Restaurar Dados',
    });
    if (!confirmed || !isMountedRef.current) return;

    setImportSummary(null);
    setRestoreLoading(true);
    setRestoreProgress(0);
    setRestoreStatus('Inicializando…');
    try {
      const stats = await restoreBackup(summary.rawData, (progress, message) => {
        if (!isMountedRef.current) return;
        setRestoreProgress(progress);
        setRestoreStatus(message);
      }, tenantId, currentUser);
      if (!isMountedRef.current) return;
      const notes = [
        `Documentos restaurados: ${stats.totalDocsProcessed}`,
        stats.rejectedDocs ? `Recusados (outra empresa ou ID inválido): ${stats.rejectedDocs}` : null,
        stats.skippedCollections.length ? `Ignoradas por segurança: ${stats.skippedCollections.join(', ')}` : null,
        stats.errors.length ? `Erros: ${stats.errors.length}` : null,
      ].filter(Boolean);
      toast.success('Restauração finalizada.', { description: notes.join(' · '), duration: 8000 });
    } catch (error) {
      console.error(error);
      if (isMountedRef.current) toast.error(`Falha na restauração: ${error.message}`);
    } finally {
      if (isMountedRef.current) {
        setRestoreLoading(false);
        setRestoreStatus('');
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader icon={Download} title="Backup e restauração" description="Cópia completa dos dados da empresa em JSON, para guardar fora do sistema." />

      {canBackup && (
        <Card icon={Download} title="Backup" subtitle="Ativos, histórico, termos, equipe, locais e inventário do agente (sem as cópias dos termos assinados)">
          <button type="button" onClick={handleFullBackup} disabled={backupLoading} className={`${buttonPrimaryClass} w-full sm:w-auto min-h-[44px] shadow-sm`}>
            {backupLoading ? <RefreshCcw className="animate-spin" size={18} aria-hidden="true" /> : <FileJson size={18} aria-hidden="true" />}
            {backupLoading ? 'Gerando arquivo…' : 'Baixar backup completo'}
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
              className={`${buttonSecondaryClass} min-h-[44px] px-3 py-2 text-xs`}
            >
              {showFormatGuide ? <EyeOff size={14} aria-hidden="true" /> : <Code size={14} aria-hidden="true" />} {showFormatGuide ? 'Ocultar formato' : 'Ver formato'}
            </button>
          }
        >
          {showFormatGuide && (
            <div className="text-xs space-y-3">
              <div className="flex justify-between items-center gap-2">
                <p className="font-bold text-slate-700 dark:text-zinc-200 flex items-center gap-1.5">
                  <Info size={14} className="text-brand-aa" aria-hidden="true" /> Estrutura esperada
                </p>
                <button type="button" onClick={handleDownloadTemplate} className={`${buttonSecondaryClass} min-h-[44px] px-3 py-2 text-xs`}>
                  Baixar modelo
                </button>
              </div>
              <pre className="bg-slate-900 text-slate-100 p-3.5 rounded-xl overflow-x-auto font-mono text-xs">{`{
  "meta": { "version": "2.2", "date": "2026-01-01T10:00:00Z" },
  "data": {
    "assets": [ { "internalId": "NB-001", "model": "Dell" } ],
    "employees": [],
    "history": [],
    "locations": [],
    "terms": []
  }
}`}</pre>
              <p className="flex items-start gap-2 text-amber-800 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 p-3 rounded-xl text-xs">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                Registros com o mesmo ID são atualizados; os demais são criados. Usuários, planos, configurações de segurança e cópias pesadas de termos não entram na restauração.
              </p>
            </div>
          )}

          {importSummary ? (
            <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/50 rounded-xl p-4 space-y-3">
              <p className="font-bold text-sky-900 dark:text-sky-200 flex items-center gap-2 text-sm">
                <FileJson size={16} aria-hidden="true" /> {importSummary.filename}
              </p>
              <p className="text-xs text-slate-600 dark:text-zinc-400 tabular-nums">Gerado em {importSummary.date}</p>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(importSummary.counts).map(([key, count]) => (
                  <div key={key} className="bg-white dark:bg-[#111113] p-2.5 rounded-xl text-center border border-slate-200 dark:border-zinc-800">
                    <span className="block text-base font-black text-slate-900 dark:text-[#fafafa] tabular-nums">{count}</span>
                    <span className="text-xs text-slate-500 dark:text-zinc-400 uppercase font-bold">{key}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setImportSummary(null)} className={`${buttonSecondaryClass} flex-1 min-h-[44px] text-xs`}>Cancelar</button>
                <button type="button" onClick={confirmRestore} className={`${buttonPrimaryClass} flex-1 min-h-[44px] text-xs`}>
                  <Play size={14} aria-hidden="true" /> Restaurar
                </button>
              </div>
            </div>
          ) : restoreLoading ? (
            <div className="text-center py-6" role="status">
              <div className="w-12 h-12 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-3" aria-hidden="true" />
              <p className="font-bold text-lg text-slate-900 dark:text-[#fafafa] tabular-nums">{restoreProgress}%</p>
              <p className="text-xs text-slate-500 dark:text-zinc-400">{restoreStatus}</p>
            </div>
          ) : (
            <div>
              <input
                id="backup-restore-file"
                name="backup-restore-file"
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".json"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <button
                type="button"
                className={`w-full p-6 border-2 border-dashed ${dragActive ? 'border-brand bg-brand/5' : 'border-slate-200 dark:border-zinc-700 bg-slate-50/50 dark:bg-zinc-900/50'} transition-colors text-center rounded-xl cursor-pointer group min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand active:scale-[0.98]`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloud size={28} className="mx-auto mb-2 text-slate-400 group-hover:text-brand-aa transition-colors" aria-hidden="true" />
                <span className="block font-bold text-sm text-slate-700 dark:text-zinc-200">Clique ou arraste o JSON aqui</span>
                <span className="block text-xs text-slate-500 dark:text-zinc-400 mt-1">O arquivo é validado antes de importar.</span>
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default BackupSection;

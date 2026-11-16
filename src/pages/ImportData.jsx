// src/pages/ImportData.jsx
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { collection, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { assertWithinLimit } from '../services/tenantService';
import { useConfirm } from '../components/ConfirmDialog';
import { 
  UploadCloud, FileSpreadsheet, AlertTriangle, ArrowLeft, 
  Download, X, Play, ShieldAlert, RefreshCw, 
  Search, CheckCircle2, XCircle, Volume2, VolumeX
} from 'lucide-react';
import {
  IMPORT_SCHEMAS,
  isSystemFormat,
  normalizeHeader,
  transformSystemRow
} from '../utils/importSchemas';

// Sintetizador de áudio Web Audio API (feedback sonoro sem arquivos mp3 externos)
const playFeedbackAudio = (type, audioCtxRef) => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioCtxRef.current ||= new AudioCtx();
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;

    if (type === 'drop' || type === 'load') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(784, now + 0.12);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (type === 'success') {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.09, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.3);
      });
    } else if (type === 'error') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.22);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch {
    // Modo silencioso em ambientes sem suporte
  }
};

const MODULE_ICON_TONE = {
  assets: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  employees: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  projects: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
  tasks: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
};

const ImportData = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const fileInputId = useId();
  const previewSearchId = useId();
  const skipErrorsId = useId();
  const confirm = useConfirm();
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId;
  
  const [selectedType, setSelectedType] = useState('assets');
  const [fileAnalysis, setFileAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [notification, setNotification] = useState(null); 
  const [dragActive, setDragActive] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Filtros da pré-visualização linha a linha
  const [previewFilter, setPreviewFilter] = useState('all'); // 'all' | 'valid' | 'warning' | 'error'
  const [previewSearch, setPreviewSearch] = useState('');
  const [skipErrors, setSkipErrors] = useState(true);

  const currentSchema = IMPORT_SCHEMAS[selectedType];
  const IconComponent = currentSchema.icon;
  const audioCtxRef = useRef(null);
  const notificationTimerRef = useRef(null);
  const readTokenRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
      audioCtxRef.current?.close?.().catch(() => {});
      audioCtxRef.current = null;
    };
  }, []);

  const triggerSound = (type) => {
    if (soundEnabled) playFeedbackAudio(type, audioCtxRef);
  };

  const resetFileInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Download de Modelos: Suporte a XLSX, CSV e JSON
  const handleDownloadTemplate = async (format = 'xlsx') => {
    const filename = `Modelo_NexusITAM_${selectedType}.${format}`;
    const sample = currentSchema.sampleData || [];

    if (format === 'json') {
      const jsonStr = JSON.stringify(sample, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      triggerSound('load');
      return;
    }

    if (format === 'csv') {
      const headers = Object.keys(sample[0] || {});
      const csvRows = [headers.join(';')];
      sample.forEach(row => {
        csvRows.push(headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(';'));
      });
      const csvContent = '\uFEFF' + csvRows.join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      triggerSound('load');
      return;
    }

    // Formato Excel XLSX nativo
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modelo");
    XLSX.writeFile(wb, filename);
    triggerSound('load');
  };

  // Validação detalhada da estrutura e de cada registro linha a linha
  const analyzeDataset = (rows, filename, fileFormat, isDirectSystem = false, schema = currentSchema) => {
    if (!rows || rows.length === 0) {
      throw new Error("Arquivo vazio ou sem dados legíveis.");
    }

    const headers = Object.keys(rows[0] || {});
    const aliases = schema.colAliases || {};
    const missing = isDirectSystem
      ? []
      : schema.requiredCols.filter(req => {
          const accepted = [req, ...(aliases[req] || [])].map(normalizeHeader);
          return !headers.some(h => accepted.includes(normalizeHeader(h)));
        });

    // Linha a linha com validações específicas
    const analyzedRows = rows.map((row, idx) => {
      const rowNum = idx + 1;
      const { errors, warnings } = schema.validateRow(row);
      const status = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid';
      return {
        rowNum,
        raw: row,
        status,
        errors,
        warnings
      };
    });

    const errorCount = analyzedRows.filter(r => r.status === 'error').length;
    const warningCount = analyzedRows.filter(r => r.status === 'warning').length;
    const validCount = analyzedRows.filter(r => r.status === 'valid').length;

    triggerSound(missing.length === 0 ? 'load' : 'error');

    return {
      filename,
      type: fileFormat,
      isSystemJson: isDirectSystem,
      totalRows: rows.length,
      valid: missing.length === 0,
      missingCols: missing,
      analyzedRows,
      counts: {
        total: rows.length,
        valid: validCount,
        warning: warningCount,
        error: errorCount
      },
      rawData: rows
    };
  };

  const processFile = (file) => {
    if (loading) return;
    const readId = ++readTokenRef.current;
    const targetType = selectedType;
    const targetSchema = IMPORT_SCHEMAS[targetType];

    setError('');
    setFileAnalysis(null);
    setPreviewFilter('all');
    setPreviewSearch('');

    const lowerName = file.name.toLowerCase();
    const reader = new FileReader();

    reader.onerror = () => {
      if (!mountedRef.current || readId !== readTokenRef.current) return;
      setError("Erro ao ler o arquivo selecionado. Verifique o arquivo e tente novamente.");
      triggerSound('error');
      resetFileInput();
    };

    if (lowerName.endsWith('.json')) {
      reader.onload = (evt) => {
        if (!mountedRef.current || readId !== readTokenRef.current) return;
        try {
          const json = JSON.parse(evt.target.result);
          const arrayData = Array.isArray(json) ? json : (json.data || []);
          if (arrayData.length === 0) throw new Error("JSON vazio ou sem registros válidos.");
          const isDirect = isSystemFormat(arrayData[0], targetType);
          const analysis = analyzeDataset(arrayData, file.name, 'JSON', isDirect, targetSchema);
          setFileAnalysis(analysis);
        } catch (err) {
          setError("Erro ao ler JSON: " + err.message);
          triggerSound('error');
        }
        resetFileInput();
      };
      reader.readAsText(file);
    } else {
      reader.onload = async (evt) => {
        if (!mountedRef.current || readId !== readTokenRef.current) return;
        try {
          const XLSX = await import("xlsx");
          if (!mountedRef.current || readId !== readTokenRef.current) return;
          const buffer = evt.target.result;
          const isCsv = lowerName.endsWith('.csv');
          const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', codepage: 65001 });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const rawData = XLSX.utils.sheet_to_json(ws);
          
          if (!rawData || rawData.length === 0) throw new Error("Planilha vazia ou sem dados reconhecíveis.");
          const isDirect = isSystemFormat(rawData[0], targetType);
          const analysis = analyzeDataset(rawData, file.name, isCsv ? 'CSV' : 'Excel', isDirect, targetSchema);
          setFileAnalysis(analysis);
        } catch (err) {
          if (!mountedRef.current || readId !== readTokenRef.current) return;
          setError("Erro ao ler planilha: " + err.message);
          triggerSound('error');
        }
        if (mountedRef.current && readId === readTokenRef.current) resetFileInput();
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      triggerSound('drop');
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      triggerSound('drop');
      processFile(e.target.files[0]);
    }
  };

  // Linhas filtradas na tabela de pré-visualização
  const filteredRows = useMemo(() => {
    if (!fileAnalysis?.analyzedRows) return [];
    return fileAnalysis.analyzedRows.filter(rowItem => {
      // Filtro de status
      if (previewFilter !== 'all' && rowItem.status !== previewFilter) {
        return false;
      }
      // Filtro textual
      if (previewSearch.trim()) {
        const query = previewSearch.toLowerCase();
        const matchesValues = Object.values(rowItem.raw).some(v => String(v).toLowerCase().includes(query));
        const matchesErrors = rowItem.errors.some(e => e.toLowerCase().includes(query));
        const matchesWarnings = rowItem.warnings.some(w => w.toLowerCase().includes(query));
        return matchesValues || matchesErrors || matchesWarnings;
      }
      return true;
    });
  }, [fileAnalysis?.analyzedRows, previewFilter, previewSearch]);

  const hasBlockingErrors = Boolean(fileAnalysis && !skipErrors && fileAnalysis.counts.error > 0);
  const validCandidatesCount = fileAnalysis ? (fileAnalysis.counts.valid + fileAnalysis.counts.warning) : 0;

  const confirmImport = async () => {
    if (!fileAnalysis || !fileAnalysis.rawData) return;
    if (!tenantId) {
      setError("Inquilino corporativo não identificado. Faça login novamente.");
      triggerSound('error');
      return;
    }

    if (!skipErrors && fileAnalysis.counts.error > 0) {
      setError(`Importação bloqueada: existem ${fileAnalysis.counts.error} registro(s) com erros. Corrija a planilha ou marque "Ignorar registros com erros".`);
      triggerSound('error');
      return;
    }

    const isSystem = fileAnalysis.isSystemJson;
    
    // Apenas registros válidos ou com avisos são aptos para importação.
    const candidates = fileAnalysis.analyzedRows.filter(rowItem => rowItem.status !== 'error');

    if (candidates.length === 0) {
      setError("Nenhum registro apto para importação selecionado.");
      triggerSound('error');
      return;
    }

    const formattedData = candidates.map(rowItem => {
      if (isSystem) {
        return transformSystemRow(rowItem.raw, selectedType, tenantId);
      }
      return {
        ...currentSchema.transform(rowItem.raw),
        tenantId
      };
    });

    const skippedCount = fileAnalysis.analyzedRows.length - formattedData.length;
    const confirmMessage = skippedCount > 0
      ? `Deseja importar ${formattedData.length} registro(s) válidos em '${currentSchema.label}'? (${skippedCount} registro(s) com erros serão ignorados).`
      : `Deseja importar ${formattedData.length} registro(s) em '${currentSchema.label}'?`;

    const confirmed = await confirm({
      title: 'Confirmar Ingestão em Massa V3',
      message: confirmMessage,
      confirmLabel: `Importar ${formattedData.length} Registros`
    });
    if (!confirmed) return;
    
    setLoading(true);
    setError('');
    let written = 0;
    try {
      const collectionRef = collection(db, currentSchema.collection);
      const historyCollectionRef = collection(db, 'history');

      // Limite do plano da empresa
      if (currentSchema.collection === 'assets') {
        await assertWithinLimit(currentUser, 'assets', formattedData.length);
      }

      // Lotes do Firestore (máximo 500 por lote)
      const isAssetCollection = currentSchema.collection === 'assets';
      const CHUNK = isAssetCollection ? 200 : 400;

      setProgress({ done: 0, total: formattedData.length, currentBatch: 1, totalBatches: Math.ceil(formattedData.length / CHUNK) });

      for (let i = 0; i < formattedData.length; i += CHUNK) {
        const batch = writeBatch(db);
        const chunkItems = formattedData.slice(i, i + CHUNK);
        const batchIndex = Math.floor(i / CHUNK) + 1;
        
        chunkItems.forEach(item => {
          const docRef = doc(collectionRef);
          if (isAssetCollection) {
            batch.set(docRef, {
              ...item,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            const historyRef = doc(historyCollectionRef);
            batch.set(historyRef, {
              assetId: docRef.id,
              tenantId,
              type: 'creation',
              action: 'Ativo Criado',
              date: serverTimestamp(),
              user: currentUser?.name || currentUser?.email || 'Sistema V3',
              details: 'Importação em massa via ingestão corporativa V3.'
            });
          } else {
            batch.set(docRef, {
              ...item,
              updatedAt: serverTimestamp()
            });
          }
        });
        await batch.commit();
        written = Math.min(i + CHUNK, formattedData.length);
        if (mountedRef.current) {
          setProgress({ 
            done: written, 
            total: formattedData.length, 
            currentBatch: batchIndex, 
            totalBatches: Math.ceil(formattedData.length / CHUNK) 
          });
        }
      }

      if (!mountedRef.current) return;
      triggerSound('success');
      setNotification({
        type: 'success',
        message: `${formattedData.length} registros foram importados com sucesso em '${currentSchema.label}'!${skippedCount > 0 ? ` (${skippedCount} ignorados por erros)` : ''}`
      });

      setFileAnalysis(null);
      resetFileInput();

      if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
      notificationTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setNotification(null);
      }, 6000);

    } catch (err) {
      console.error(err);
      if (!mountedRef.current) return;
      triggerSound('error');
      setError(
        (err?.message?.startsWith('Limite') || err?.message?.startsWith('O plano'))
          ? err.message
          : `Erro ao gravar no banco de dados${written ? ` (${written} registros gravados)` : ''}. ${err.message}`
      );
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setProgress(null);
      }
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-28 min-h-screen text-slate-900 dark:text-[#fafafa]">
      {/* Top Header V3 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-white dark:bg-[#111113] border border-slate-200/90 dark:border-zinc-800 p-5 md:p-6 rounded-2xl shadow-sm">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 rounded-xl text-slate-700 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-zinc-700 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand group"
            title="Voltar para Configurações"
            aria-label="Voltar para Configurações"
          >
            <ArrowLeft size={18} aria-hidden="true" className="group-hover:-translate-x-0.5 transition-transform" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                Ingestão & Importação de Dados
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-brand/10 border border-brand/30 text-brand-aa font-mono text-xs font-bold">
                V3 Engine
              </span>
            </div>
            <p className="text-sm text-slate-600 dark:text-zinc-400 mt-0.5">
              Importação em lote de equipamentos, colaboradores, projetos e tarefas com validação profunda pré-ingestão.
            </p>
          </div>
        </div>

        {/* Controles de Áudio e Atalhos */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={() => setSoundEnabled(v => !v)}
            aria-pressed={soundEnabled}
            className={`min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              soundEnabled
                ? 'bg-sky-50 border-sky-200 text-sky-800 dark:bg-sky-500/10 dark:border-sky-500/30 dark:text-sky-300'
                : 'bg-slate-100 border-slate-200 text-slate-700 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300'
            }`}
            title={soundEnabled ? 'Som ativado (desativar)' : 'Som desativado (ativar)'}
          >
            {soundEnabled ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Som Ativo' : 'Mudo'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleDownloadTemplate('xlsx')}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-xs font-bold text-slate-800 dark:text-zinc-100 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shadow-sm"
          >
            <Download size={14} aria-hidden="true" className="text-brand-aa" />
            <span>Modelo Excel</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Menu Lateral de Tipos */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between px-2">
            <h3 className="font-bold text-slate-600 dark:text-zinc-400 text-xs uppercase tracking-wider">Módulos do Sistema</h3>
            <span className="text-xs text-slate-500 dark:text-zinc-400 font-mono tabular-nums">4 disponíveis</span>
          </div>

          <div className="space-y-2">
            {Object.entries(IMPORT_SCHEMAS).map(([key, schema]) => {
              const Icon = schema.icon;
              const isSelected = selectedType === key;
              const iconTone = MODULE_ICON_TONE[key] || schema.badgeColor;
              return (
                <button
                  type="button"
                  key={key}
                  disabled={loading}
                  aria-pressed={isSelected}
                  onClick={() => {
                    readTokenRef.current += 1;
                    setSelectedType(key);
                    setFileAnalysis(null);
                    setError('');
                    resetFileInput();
                    triggerSound('load');
                  }}
                  className={`w-full min-h-[44px] p-3.5 rounded-xl border transition-colors text-left relative overflow-hidden active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed group ${
                    isSelected
                      ? 'border-brand bg-brand/5 dark:bg-brand/10 shadow-sm text-slate-900 dark:text-white'
                      : 'border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] hover:bg-slate-50 dark:hover:bg-zinc-900 text-slate-700 dark:text-zinc-200'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand" aria-hidden="true" />
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg border ${isSelected ? iconTone : 'bg-slate-100 border-slate-200 text-slate-600 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white'}`}>
                        <Icon size={18} aria-hidden="true" />
                      </div>
                      <div>
                        <span className="font-bold text-sm block leading-tight">{schema.label}</span>
                        <span className="text-xs text-slate-600 dark:text-zinc-400 font-mono tabular-nums">
                          {schema.requiredCols.length} campos obrig.
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-brand shrink-0" aria-hidden="true" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Card de Formatos de Download dos Modelos */}
          <div className="p-4 bg-white dark:bg-[#111113] border border-slate-200/90 dark:border-zinc-800 rounded-xl space-y-3 shadow-sm">
            <span className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
              <Download size={14} aria-hidden="true" className="text-brand-aa" /> Modelos para {currentSchema.label}:
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleDownloadTemplate('xlsx')}
                className="min-h-[44px] px-2 py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 dark:border-emerald-500/30 dark:text-emerald-300 text-xs font-bold font-mono transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand text-center"
              >
                .XLSX
              </button>
              <button
                type="button"
                onClick={() => handleDownloadTemplate('csv')}
                className="min-h-[44px] px-2 py-2 rounded-lg bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-800 dark:bg-sky-500/10 dark:hover:bg-sky-500/20 dark:border-sky-500/30 dark:text-sky-300 text-xs font-bold font-mono transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand text-center"
              >
                .CSV
              </button>
              <button
                type="button"
                onClick={() => handleDownloadTemplate('json')}
                className="min-h-[44px] px-2 py-2 rounded-lg bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-800 dark:bg-teal-500/10 dark:hover:bg-teal-500/20 dark:border-teal-500/30 dark:text-teal-300 text-xs font-bold font-mono transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand text-center"
              >
                .JSON
              </button>
            </div>
          </div>
        </div>

        {/* Área Central Maior */}
        <div className="lg:col-span-9 space-y-6">
          {/* Card de Informações e Esquema Atual */}
          <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 p-5 md:p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg border ${MODULE_ICON_TONE[selectedType] || currentSchema.badgeColor}`}>
                  <IconComponent size={18} aria-hidden="true" />
                </div>
                <h2 className="text-lg font-black text-slate-900 dark:text-[#fafafa]">
                  Módulo de Ingestão: {currentSchema.label}
                </h2>
              </div>
              <p className="text-xs text-slate-600 dark:text-zinc-400 mt-1.5 max-w-2xl leading-relaxed">
                {currentSchema.description}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-600 dark:text-zinc-400 font-semibold text-xs">Colunas Obrigatórias:</span>
                {currentSchema.requiredCols.map(col => (
                  <span key={col} className="bg-brand/10 border border-brand/30 text-brand-aa px-2 py-0.5 rounded-md font-mono text-xs font-bold">
                    {col}
                  </span>
                ))}
                {currentSchema.optionalCols?.length > 0 && (
                  <>
                    <span className="text-slate-500 dark:text-zinc-400 font-semibold text-xs ml-1">Opcionais:</span>
                    {currentSchema.optionalCols.map(col => (
                      <span key={col} className="bg-slate-100 border border-slate-200 text-slate-700 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded-md font-mono text-xs">
                        {col}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleDownloadTemplate('xlsx')}
                className="min-h-[44px] flex items-center gap-2 px-4 py-2 bg-brand hover:bg-brand-dark text-brand-fg rounded-xl text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand shadow-sm"
              >
                <Download size={14} aria-hidden="true" /> Baixar Modelo
              </button>
            </div>
          </div>

          {/* Caixa de Erro Geral */}
          {error && (
            <div role="alert" className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-300 rounded-xl text-xs font-bold flex items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-2.5">
                <ShieldAlert size={18} aria-hidden="true" className="text-rose-600 dark:text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => setError('')}
                aria-label="Fechar alerta de erro"
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-lg text-rose-600 dark:text-rose-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}

          {/* QUADROS DINÂMICOS: Se há análise de arquivo pronta, exibe o Dashboard de Pré-Visualização Linha a Linha */}
          {fileAnalysis ? (
            <div className="bg-white dark:bg-[#111113] rounded-2xl border border-slate-200/90 dark:border-zinc-800 shadow-lg overflow-hidden animate-zoom-in">
              {/* Header do Arquivo Analisado */}
              <div className="bg-slate-50 dark:bg-zinc-900/70 p-4 md:p-5 border-b border-slate-200 dark:border-zinc-800 flex flex-wrap justify-between items-center gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-sky-50 border border-sky-200 text-sky-700 dark:bg-sky-500/15 dark:border-sky-500/30 dark:text-sky-300 rounded-xl">
                    <FileSpreadsheet size={22} aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-[#fafafa] text-sm md:text-base flex flex-wrap items-center gap-2">
                      <span>{fileAnalysis.filename}</span>
                      <span className="text-xs font-mono px-2 py-0.5 bg-slate-100 dark:bg-zinc-900 rounded-full text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700">
                        {fileAnalysis.type}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-zinc-400 font-medium mt-0.5 tabular-nums">
                      {fileAnalysis.totalRows} registros detectados • Esquema: {currentSchema.label}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => { readTokenRef.current += 1; setFileAnalysis(null); resetFileInput(); }}
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 hover:bg-slate-200/80 dark:hover:bg-zinc-800 rounded-xl text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Remover arquivo e escolher outro"
                    aria-label="Remover arquivo e escolher outro"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="p-5 md:p-6 space-y-6">
                {/* Validação de Colunas Obrigatórias */}
                {!fileAnalysis.valid ? (
                  <div role="alert" className="text-center py-8 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl p-6">
                    <div className="inline-flex p-3.5 bg-rose-100 border border-rose-200 text-rose-700 dark:bg-rose-500/20 dark:border-rose-500/30 dark:text-rose-400 rounded-2xl mb-3">
                      <AlertTriangle size={32} aria-hidden="true" />
                    </div>
                    <h3 className="font-bold text-lg text-slate-900 dark:text-[#fafafa] mb-1">Colunas Obrigatórias Ausentes</h3>
                    <p className="text-xs text-slate-600 dark:text-zinc-400 mb-5 max-w-md mx-auto">
                      O arquivo selecionado não contém as colunas mínimas exigidas para o módulo <strong>{currentSchema.label}</strong>:
                    </p>

                    <div className="flex flex-wrap justify-center gap-2 mb-6">
                      {fileAnalysis.missingCols.map(col => (
                        <span key={col} className="bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 px-3 py-1 rounded-lg border dark:border-rose-500/30 font-bold font-mono text-xs">
                          {col}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => handleDownloadTemplate('xlsx')}
                        className="min-h-[44px] px-4 py-2.5 bg-brand hover:bg-brand-dark text-brand-fg font-bold text-xs rounded-xl inline-flex items-center gap-2 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <Download size={14} aria-hidden="true" /> Baixar Modelo Correto
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => { readTokenRef.current += 1; setFileAnalysis(null); resetFileInput(); }}
                        className="min-h-[44px] px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200 font-bold text-xs rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Escolher Outro Arquivo
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* KPIs de Validação Linha a Linha */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 dark:bg-zinc-900/70 dark:border-zinc-800">
                        <span className="text-xs text-slate-600 dark:text-zinc-400 uppercase font-bold tracking-wider block mb-1">Total de Linhas</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl md:text-2xl font-black text-slate-900 dark:text-[#fafafa] font-mono tabular-nums">{fileAnalysis.counts.total}</span>
                          <span className="text-xs text-slate-600 dark:text-zinc-400">registros</span>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800/40">
                        <span className="text-xs text-emerald-700 dark:text-emerald-400 uppercase font-bold tracking-wider block mb-1">Prontos (Válidos)</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl md:text-2xl font-black text-emerald-800 dark:text-emerald-300 font-mono tabular-nums">{fileAnalysis.counts.valid}</span>
                          <span className="text-xs text-emerald-700 dark:text-emerald-400/90 tabular-nums">100% conformes</span>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800/40">
                        <span className="text-xs text-amber-800 dark:text-amber-400 uppercase font-bold tracking-wider block mb-1">Avisos Menores</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl md:text-2xl font-black text-amber-800 dark:text-amber-300 font-mono tabular-nums">{fileAnalysis.counts.warning}</span>
                          <span className="text-xs text-amber-700 dark:text-amber-400/90">ajustes padrão</span>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 dark:bg-rose-950/30 dark:border-rose-800/40">
                        <span className="text-xs text-rose-700 dark:text-rose-400 uppercase font-bold tracking-wider block mb-1">Erros Bloqueantes</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl md:text-2xl font-black text-rose-800 dark:text-rose-300 font-mono tabular-nums">{fileAnalysis.counts.error}</span>
                          <span className="text-xs text-rose-700 dark:text-rose-400/90">requerem atenção</span>
                        </div>
                      </div>
                    </div>

                    {/* Barra de Filtro e Busca na Pré-visualização */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-50 dark:bg-zinc-900/70 p-3 rounded-xl border border-slate-200 dark:border-zinc-800">
                      {/* Tabs de Filtro de Linhas */}
                      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                        {[
                          { id: 'all', label: `Todos (${fileAnalysis.counts.total})` },
                          { id: 'valid', label: `Válidos (${fileAnalysis.counts.valid})`, color: 'text-emerald-700 dark:text-emerald-400' },
                          { id: 'warning', label: `Avisos (${fileAnalysis.counts.warning})`, color: 'text-amber-700 dark:text-amber-400' },
                          { id: 'error', label: `Erros (${fileAnalysis.counts.error})`, color: 'text-rose-700 dark:text-rose-400' },
                        ].map(f => (
                          <button
                            type="button"
                            key={f.id}
                            aria-pressed={previewFilter === f.id}
                            onClick={() => setPreviewFilter(f.id)}
                            className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-bold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand whitespace-nowrap tabular-nums ${
                              previewFilter === f.id
                                ? 'bg-brand text-brand-fg shadow-sm'
                                : 'bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'
                            }`}
                          >
                            <span className={previewFilter !== f.id ? f.color : ''}>{f.label}</span>
                          </button>
                        ))}
                      </div>

                      {/* Busca textual na tabela */}
                      <div className="relative min-w-[200px]">
                        <label htmlFor={previewSearchId} className="sr-only">
                          Buscar registros na pré-visualização
                        </label>
                        <Search size={14} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-400 pointer-events-none" />
                        <input
                          id={previewSearchId}
                          name="previewSearch"
                          type="text"
                          value={previewSearch}
                          onChange={(e) => setPreviewSearch(e.target.value)}
                          placeholder="Buscar registros…"
                          aria-label="Buscar registros na pré-visualização"
                          className="w-full min-h-[44px] bg-white hover:border-slate-400 active:border-slate-500 focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25 dark:bg-[#111113] dark:border-zinc-700 dark:hover:border-zinc-600 border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-900 dark:text-[#fafafa] placeholder:text-slate-400 dark:placeholder:text-zinc-500 transition-colors"
                        />
                      </div>
                    </div>

                    {/* Tabela Interativa de Validação Linha a Linha */}
                    <div className="overflow-hidden border border-slate-200 dark:border-zinc-800 rounded-xl">
                      <div className="overflow-x-auto max-h-[380px] overflow-y-auto no-scrollbar">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 uppercase font-mono text-xs tracking-wider sticky top-0 z-10 border-b border-slate-200 dark:border-zinc-800">
                            <tr>
                              <th className="p-3 w-16 text-center">Linha</th>
                              <th className="p-3 w-32">Status</th>
                              <th className="p-3 min-w-[220px]">Diagnóstico</th>
                              {Object.keys(fileAnalysis.rawData[0] || {}).slice(0, 6).map(k => (
                                <th key={k} className="p-3 font-semibold text-slate-800 dark:text-zinc-300">{k}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-zinc-800 font-mono text-slate-700 dark:text-zinc-300 bg-white dark:bg-[#111113]">
                            {filteredRows.length === 0 ? (
                              <tr>
                                <td colSpan={10} className="p-6 text-center text-slate-500 dark:text-zinc-400 italic font-sans">
                                  Nenhum registro correspondente ao filtro selecionado.
                                </td>
                              </tr>
                            ) : (
                              filteredRows.map((item) => (
                                <tr key={item.rowNum} className="hover:bg-slate-50 dark:hover:bg-zinc-900/60 transition-colors">
                                  <td className="p-3 text-center text-slate-500 dark:text-zinc-400 font-bold tabular-nums">
                                    #{item.rowNum}
                                  </td>
                                  <td className="p-3 whitespace-nowrap">
                                    {item.status === 'valid' && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-500/15 dark:border-emerald-500/30 dark:text-emerald-300 font-bold text-xs">
                                        <CheckCircle2 size={12} aria-hidden="true" /> Válido
                                      </span>
                                    )}
                                    {item.status === 'warning' && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-500/15 dark:border-amber-500/30 dark:text-amber-300 font-bold text-xs">
                                        <AlertTriangle size={12} aria-hidden="true" /> Aviso
                                      </span>
                                    )}
                                    {item.status === 'error' && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-500/20 dark:border-rose-500/40 dark:text-rose-300 font-bold text-xs">
                                        <XCircle size={12} aria-hidden="true" /> Erro
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3 text-xs font-sans">
                                    {item.errors.length > 0 ? (
                                      <span className="text-rose-700 dark:text-rose-400 font-semibold">{item.errors.join(' • ')}</span>
                                    ) : item.warnings.length > 0 ? (
                                      <span className="text-amber-700 dark:text-amber-400">{item.warnings.join(' • ')}</span>
                                    ) : (
                                      <span className="text-emerald-700 dark:text-emerald-400">Pronto para ingestão</span>
                                    )}
                                  </td>
                                  {Object.keys(fileAnalysis.rawData[0] || {}).slice(0, 6).map(k => (
                                    <td key={k} className="p-3 whitespace-nowrap text-slate-700 dark:text-zinc-300">
                                      {String(item.raw[k] ?? '—')}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {hasBlockingErrors && (
                      <div
                        role="alert"
                        className="rounded-xl border border-rose-200 bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30 px-4 py-3 text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-2 tabular-nums"
                      >
                        <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />
                        <span>
                          Importação bloqueada: existem {fileAnalysis.counts.error} registro(s) com erros. Corrija a planilha ou marque &ldquo;Ignorar registros com erros&rdquo; para continuar.
                        </span>
                      </div>
                    )}

                    {/* Barra de Ações e Ingestão */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-slate-200 dark:border-zinc-800">
                      {/* Checkbox de Tolerância a Falhas */}
                      <label htmlFor={skipErrorsId} className="min-h-[44px] flex items-center gap-2.5 text-xs text-slate-700 dark:text-zinc-300 cursor-pointer tabular-nums">
                        <input
                          id={skipErrorsId}
                          name="skipErrors"
                          type="checkbox"
                          disabled={loading}
                          checked={skipErrors}
                          onChange={(e) => setSkipErrors(e.target.checked)}
                          className="w-5 h-5 rounded border-slate-300 dark:border-zinc-700 bg-white dark:bg-[#111113] accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                        />
                        <span>
                          Ignorar registros com erros ({fileAnalysis.counts.error}) e importar apenas os válidos ({validCandidatesCount})
                        </span>
                      </label>

                      <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                        <button
                          type="button"
                          onClick={() => { readTokenRef.current += 1; setFileAnalysis(null); resetFileInput(); }}
                          disabled={loading}
                          className="min-h-[44px] px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:text-zinc-200 border border-slate-200 dark:border-zinc-700 font-bold text-xs rounded-xl transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                        >
                          Cancelar
                        </button>

                        <button
                          type="button"
                          onClick={confirmImport}
                          disabled={loading || hasBlockingErrors || validCandidatesCount === 0}
                          className="min-h-[44px] px-6 py-2.5 bg-brand hover:bg-brand-dark text-brand-fg font-bold text-xs rounded-xl shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand tabular-nums"
                        >
                          {loading ? (
                            <>
                              <RefreshCw size={15} aria-hidden="true" className="animate-spin" />
                              <span>{progress ? `Importando ${progress.done}/${progress.total}…` : 'Processando…'}</span>
                            </>
                          ) : (
                            <>
                              <Play size={15} aria-hidden="true" fill="currentColor" />
                              <span>Iniciar Ingestão em Massa</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Barra de Progresso Animada */}
                    {loading && progress && (
                      <div className="space-y-2 pt-2 animate-fade-in">
                        <div className="flex justify-between text-xs text-slate-600 dark:text-zinc-400 font-mono tabular-nums">
                          <span>Processando lote {progress.currentBatch} de {progress.totalBatches}…</span>
                          <span className="font-bold text-brand-aa">
                            {Math.round((progress.done / progress.total) * 100)}% ({progress.done}/{progress.total})
                          </span>
                        </div>
                        <div
                          role="progressbar"
                          aria-valuenow={Math.round((progress.done / progress.total) * 100)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="Progresso da importação"
                          className="w-full bg-slate-200 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden border border-slate-300 dark:border-zinc-700"
                        >
                          <div
                            className="h-full bg-gradient-to-r from-brand via-sky-500 to-emerald-500 rounded-full transition-[width] duration-300"
                            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Dropzone Interativo e Responsivo acessível via teclado */
            <div className="relative">
              <input
                id={fileInputId}
                name="importFile"
                ref={fileInputRef}
                type="file"
                disabled={loading}
                className="sr-only peer"
                accept=".xlsx,.xls,.csv,.json"
                onChange={handleFileChange}
                aria-label={`Selecionar arquivo para ${currentSchema.label}`}
              />
              <label
                htmlFor={fileInputId}
                className={`border-2 border-dashed rounded-2xl p-10 md:p-16 text-center transition-colors cursor-pointer group flex flex-col items-center justify-center min-h-[340px] relative overflow-hidden peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-[#09090b] ${
                  dragActive
                    ? 'border-brand bg-brand/10 dark:bg-brand/15 shadow-lg'
                    : 'border-slate-300 dark:border-zinc-800 bg-white dark:bg-[#111113] hover:border-brand/60 hover:bg-slate-50 dark:hover:bg-zinc-900/70'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <span className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-5 transition-colors shadow-sm border ${
                  dragActive
                    ? 'bg-brand text-brand-fg border-brand scale-105'
                    : 'bg-slate-100 text-brand-aa border-slate-200 dark:bg-zinc-900 dark:border-zinc-700 group-hover:bg-brand/10 group-hover:border-brand/40'
                }`}>
                  {dragActive ? (
                    <UploadCloud size={40} aria-hidden="true" />
                  ) : (
                    <FileSpreadsheet size={40} aria-hidden="true" />
                  )}
                </span>

                <span className={`block text-lg md:text-xl font-black mb-2 transition-colors ${
                  dragActive ? 'text-brand-aa' : 'text-slate-900 dark:text-[#fafafa]'
                }`}>
                  {dragActive ? 'Solte a planilha agora' : 'Arraste ou Selecione seu Arquivo'}
                </span>

                <span className="block text-slate-600 dark:text-zinc-400 text-xs md:text-sm max-w-md mx-auto mb-6 leading-relaxed">
                  Suporta planilhas <strong>Excel (.xlsx, .xls)</strong>, arquivos <strong>CSV (.csv)</strong> ou <strong>JSON (.json)</strong> estruturados para <strong>{currentSchema.label}</strong>.
                </span>

                {/* Badges de Formatos Aceitos */}
                <span className="flex flex-wrap justify-center gap-2">
                  <span className="px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-700 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300 font-mono text-xs font-bold">
                    .XLSX
                  </span>
                  <span className="px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-700 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300 font-mono text-xs font-bold">
                    .CSV
                  </span>
                  <span className="px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-slate-700 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-300 font-mono text-xs font-bold">
                    .JSON
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Alerta Flutuante de Sucesso */}
      {notification && (
        <div role="status" aria-live="polite" className="fixed bottom-8 right-8 z-50 animate-slide-up bg-white dark:bg-[#111113] border border-emerald-200 dark:border-emerald-500/40 text-slate-900 dark:text-[#fafafa] px-5 py-4 rounded-2xl shadow-xl flex items-center gap-3.5">
          <div className="p-2 bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-500/20 dark:border-emerald-500/40 dark:text-emerald-400 rounded-xl">
            <CheckCircle2 size={24} aria-hidden="true" />
          </div>
          <div>
            <h4 className="font-black text-sm text-slate-900 dark:text-[#fafafa]">Ingestão Concluída!</h4>
            <p className="text-xs text-slate-600 dark:text-zinc-300">{notification.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportData;

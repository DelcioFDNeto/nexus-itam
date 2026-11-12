// src/pages/ImportData.jsx
import React, { useState, useRef, useMemo } from 'react';
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
  transformSystemRow
} from '../utils/importSchemas';

// Sintetizador de áudio Web Audio API (feedback sonoro sem arquivos mp3 externos)
const playFeedbackAudio = (type) => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
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

const ImportData = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
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

  const triggerSound = (type) => {
    if (soundEnabled) playFeedbackAudio(type);
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
  const analyzeDataset = (rows, filename, fileFormat, isDirectSystem = false) => {
    if (!rows || rows.length === 0) {
      throw new Error("Arquivo vazio ou sem dados legíveis.");
    }

    const headers = Object.keys(rows[0] || {});
    const aliases = currentSchema.colAliases || {};
    const missing = isDirectSystem
      ? []
      : currentSchema.requiredCols.filter(req => {
          const reqLower = String(req).trim().toLowerCase();
          const accepted = [reqLower, ...(aliases[req] || []).map(a => a.toLowerCase())];
          return !headers.some(h => accepted.includes(String(h).trim().toLowerCase()));
        });

    // Linha a linha com validações específicas
    const analyzedRows = rows.map((row, idx) => {
      const rowNum = idx + 1;
      const { errors, warnings } = currentSchema.validateRow(row);
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
    setError('');
    setFileAnalysis(null);
    setPreviewFilter('all');
    setPreviewSearch('');

    const lowerName = file.name.toLowerCase();
    const reader = new FileReader();

    if (lowerName.endsWith('.json')) {
      reader.onload = (evt) => {
        try {
          const json = JSON.parse(evt.target.result);
          const arrayData = Array.isArray(json) ? json : (json.data || []);
          if (arrayData.length === 0) throw new Error("JSON vazio ou sem registros válidos.");
          const isDirect = isSystemFormat(arrayData[0], selectedType);
          const analysis = analyzeDataset(arrayData, file.name, 'JSON', isDirect);
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
        try {
          const XLSX = await import("xlsx");
          const buffer = evt.target.result;
          const isCsv = lowerName.endsWith('.csv');
          const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', codepage: 65001 });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const rawData = XLSX.utils.sheet_to_json(ws);
          
          if (!rawData || rawData.length === 0) throw new Error("Planilha vazia ou sem dados reconhecíveis.");
          const isDirect = isSystemFormat(rawData[0], selectedType);
          const analysis = analyzeDataset(rawData, file.name, isCsv ? 'CSV' : 'Excel', isDirect);
          setFileAnalysis(analysis);
        } catch (err) {
          setError("Erro ao ler planilha: " + err.message);
          triggerSound('error');
        }
        resetFileInput();
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

  const confirmImport = async () => {
    if (!fileAnalysis || !fileAnalysis.rawData) return;
    if (!tenantId) {
      setError("Inquilino corporativo não identificado. Faça login novamente.");
      triggerSound('error');
      return;
    }

    const isSystem = fileAnalysis.isSystemJson;
    
    // Filtra apenas registros válidos se skipErrors estiver ativo
    const candidates = fileAnalysis.analyzedRows.filter(rowItem => {
      if (skipErrors) return rowItem.status !== 'error';
      return true;
    });

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
        setProgress({ 
          done: written, 
          total: formattedData.length, 
          currentBatch: batchIndex, 
          totalBatches: Math.ceil(formattedData.length / CHUNK) 
        });
      }

      triggerSound('success');
      setNotification({
        type: 'success',
        message: `${formattedData.length} registros foram importados com sucesso em '${currentSchema.label}'!${skippedCount > 0 ? ` (${skippedCount} ignorados por erros)` : ''}`
      });

      setFileAnalysis(null);
      resetFileInput();

      setTimeout(() => setNotification(null), 6000);

    } catch (err) {
      console.error(err);
      triggerSound('error');
      setError(
        (err?.message?.startsWith('Limite') || err?.message?.startsWith('O plano'))
          ? err.message
          : `Erro ao gravar no banco de dados${written ? ` (${written} registros gravados)` : ''}. ${err.message}`
      );
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto pb-28 min-h-screen text-slate-100">
      
      {/* Top Header V3 com Dark Glassmorphism */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 p-5 md:p-6 rounded-2xl shadow-xl">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/settings')} 
            className="p-2.5 bg-slate-800/80 hover:bg-slate-700 rounded-xl text-slate-300 hover:text-white border border-slate-700/60 transition-all shadow-sm group"
            title="Voltar para Configurações"
          >
            <ArrowLeft size={18} className="group-hover:-translate-x-0.5 transition-transform" />
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white flex items-center gap-2">
                Ingestão & Importação de Dados
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 font-mono text-[11px] font-bold">
                V3 Engine
              </span>
            </div>
            <p className="text-sm text-slate-400 mt-0.5">
              Importação em lote de equipamentos, colaboradores, projetos e tarefas com validação profunda pré-ingestão.
            </p>
          </div>
        </div>

        {/* Controles de Áudio e Atalhos */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={() => setSoundEnabled(v => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
              soundEnabled
                ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                : 'bg-slate-800/80 border-slate-700 text-slate-400'
            }`}
            title={soundEnabled ? 'Som ativado (desativar)' : 'Som desativado (ativar)'}
          >
            {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            <span className="hidden sm:inline">{soundEnabled ? 'Som Ativo' : 'Mudo'}</span>
          </button>

          <button
            onClick={() => handleDownloadTemplate('xlsx')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition-all shadow-sm"
          >
            <Download size={14} className="text-blue-400" />
            <span>Modelo Excel</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Menu Lateral de Tipos (Cards V3 com Glassmorphism) */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between px-2">
            <h3 className="font-bold text-slate-400 text-[11px] uppercase tracking-wider">Módulos do Sistema</h3>
            <span className="text-[10px] text-slate-500 font-mono">4 disponíveis</span>
          </div>

          <div className="space-y-2">
            {Object.entries(IMPORT_SCHEMAS).map(([key, schema]) => {
              const Icon = schema.icon;
              const isSelected = selectedType === key;
              return (
                <button 
                  key={key} 
                  onClick={() => { 
                    setSelectedType(key); 
                    setFileAnalysis(null); 
                    setError(''); 
                    resetFileInput(); 
                    triggerSound('load');
                  }} 
                  className={`w-full p-3.5 rounded-xl border transition-all text-left relative overflow-hidden group ${
                    isSelected 
                      ? 'border-indigo-500/80 bg-gradient-to-r from-indigo-950/70 via-slate-900 to-slate-900 shadow-lg shadow-indigo-950/40 text-white' 
                      : 'border-slate-800/80 bg-slate-900/50 hover:bg-slate-800/60 text-slate-300 hover:text-white'
                  }`}
                >
                  {isSelected && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500" />
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg border ${isSelected ? schema.badgeColor : 'bg-slate-800/70 border-slate-700/60 text-slate-400 group-hover:text-white'}`}>
                        <Icon size={18} />
                      </div>
                      <div>
                        <span className="font-bold text-sm block leading-tight">{schema.label}</span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {schema.requiredCols.length} campos obrig.
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Card de Formatos de Download dos Modelos */}
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl space-y-3">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Download size={14} className="text-indigo-400" /> Modelos para {currentSchema.label}:
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleDownloadTemplate('xlsx')}
                className="px-2 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-bold font-mono transition-colors text-center"
              >
                .XLSX
              </button>
              <button
                onClick={() => handleDownloadTemplate('csv')}
                className="px-2 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[11px] font-bold font-mono transition-colors text-center"
              >
                .CSV
              </button>
              <button
                onClick={() => handleDownloadTemplate('json')}
                className="px-2 py-1.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[11px] font-bold font-mono transition-colors text-center"
              >
                .JSON
              </button>
            </div>
          </div>
        </div>

        {/* Área Central Maior */}
        <div className="lg:col-span-9 space-y-6">
          
          {/* Card de Informações e Esquema Atual */}
          <div className="bg-slate-900/60 backdrop-blur-xl rounded-2xl border border-slate-800/80 p-5 md:p-6 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg border ${currentSchema.badgeColor}`}>
                  <IconComponent size={18} />
                </div>
                <h2 className="text-lg font-black text-white">
                  Módulo de Ingestão: {currentSchema.label}
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
                {currentSchema.description}
              </p>
              
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-400 font-semibold text-[11px]">Colunas Obrigatórias:</span>
                {currentSchema.requiredCols.map(col => (
                  <span key={col} className="bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded-md font-mono text-[11px] font-bold">
                    {col}
                  </span>
                ))}
                {currentSchema.optionalCols?.length > 0 && (
                  <>
                    <span className="text-slate-500 font-semibold text-[11px] ml-1">Opcionais:</span>
                    {currentSchema.optionalCols.map(col => (
                      <span key={col} className="bg-slate-800 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-md font-mono text-[11px]">
                        {col}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button 
                onClick={() => handleDownloadTemplate('xlsx')} 
                className="flex items-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/20"
              >
                <Download size={14}/> Baixar Modelo
              </button>
            </div>
          </div>

          {/* Caixa de Erro Geral */}
          {error && (
            <div className="p-4 bg-rose-950/40 border border-rose-800/60 text-rose-300 rounded-xl text-xs font-bold flex items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-2.5">
                <ShieldAlert size={18} className="text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
              <button onClick={() => setError('')} className="p-1 hover:bg-rose-900/50 rounded text-rose-400">
                <X size={16} />
              </button>
            </div>
          )}

          {/* QUADROS DINÂMICOS: Se há análise de arquivo pronta, exibe o Dashboard de Pré-Visualização Linha a Linha */}
          {fileAnalysis ? (
            <div className="bg-slate-900/70 backdrop-blur-xl rounded-2xl border border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
              
              {/* Header do Arquivo Analisado */}
              <div className="bg-slate-900/90 p-4 md:p-5 border-b border-slate-800 flex flex-wrap justify-between items-center gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-blue-500/15 border border-blue-500/30 text-blue-400 rounded-xl">
                    <FileSpreadsheet size={22}/>
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-sm md:text-base flex items-center gap-2">
                      {fileAnalysis.filename}
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-800 rounded-full text-slate-300 border border-slate-700">
                        {fileAnalysis.type}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">
                      {fileAnalysis.totalRows} registros detectados • Esquema: {currentSchema.label}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => { setFileAnalysis(null); resetFileInput(); }} 
                    className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
                    title="Remover arquivo e escolher outro"
                  >
                    <X size={18}/>
                  </button>
                </div>
              </div>

              <div className="p-5 md:p-6 space-y-6">
                
                {/* Validação de Colunas Obrigatórias */}
                {!fileAnalysis.valid ? (
                  <div className="text-center py-8 bg-rose-950/20 border border-rose-900/40 rounded-xl p-6">
                    <div className="inline-flex p-3.5 bg-rose-500/20 border border-rose-500/30 text-rose-400 rounded-2xl mb-3">
                      <AlertTriangle size={32}/>
                    </div>
                    <h3 className="font-bold text-lg text-white mb-1">Colunas Obrigatórias Ausentes</h3>
                    <p className="text-xs text-slate-400 mb-5 max-w-md mx-auto">
                      O arquivo selecionado não contém as colunas mínimas exigidas para o módulo <strong>{currentSchema.label}</strong>:
                    </p>
                    
                    <div className="flex flex-wrap justify-center gap-2 mb-6">
                      {fileAnalysis.missingCols.map(col => (
                        <span key={col} className="bg-rose-500/15 text-rose-300 px-3 py-1 rounded-lg border border-rose-500/30 font-bold font-mono text-xs">
                          {col}
                        </span>
                      ))}
                    </div>

                    <div className="flex justify-center gap-3">
                      <button 
                        onClick={() => handleDownloadTemplate('xlsx')} 
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl inline-flex items-center gap-2"
                      >
                        <Download size={14} /> Baixar Modelo Correto
                      </button>
                      <button 
                        onClick={() => { setFileAnalysis(null); resetFileInput(); }} 
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl"
                      >
                        Escolher Outro Arquivo
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* KPIs de Validação Linha a Linha */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block mb-1">Total de Linhas</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl md:text-2xl font-black text-white font-mono">{fileAnalysis.counts.total}</span>
                          <span className="text-xs text-slate-400">registros</span>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40">
                        <span className="text-[10px] text-emerald-400 uppercase font-bold tracking-wider block mb-1">Prontos (Válidos)</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl md:text-2xl font-black text-emerald-300 font-mono">{fileAnalysis.counts.valid}</span>
                          <span className="text-xs text-emerald-400/80">100% conformes</span>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/40">
                        <span className="text-[10px] text-amber-400 uppercase font-bold tracking-wider block mb-1">Avisos Menores</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl md:text-2xl font-black text-amber-300 font-mono">{fileAnalysis.counts.warning}</span>
                          <span className="text-xs text-amber-400/80">ajustes padrão</span>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-800/40">
                        <span className="text-[10px] text-rose-400 uppercase font-bold tracking-wider block mb-1">Erros Bloqueantes</span>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl md:text-2xl font-black text-rose-300 font-mono">{fileAnalysis.counts.error}</span>
                          <span className="text-xs text-rose-400/80">requerem atenção</span>
                        </div>
                      </div>
                    </div>

                    {/* Barra de Filtro e Busca na Pré-visualização */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-800/40 p-3 rounded-xl border border-slate-700/60">
                      
                      {/* Tabs de Filtro de Linhas */}
                      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                        {[
                          { id: 'all', label: `Todos (${fileAnalysis.counts.total})` },
                          { id: 'valid', label: `Válidos (${fileAnalysis.counts.valid})`, color: 'text-emerald-400' },
                          { id: 'warning', label: `Avisos (${fileAnalysis.counts.warning})`, color: 'text-amber-400' },
                          { id: 'error', label: `Erros (${fileAnalysis.counts.error})`, color: 'text-rose-400' },
                        ].map(f => (
                          <button
                            key={f.id}
                            onClick={() => setPreviewFilter(f.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                              previewFilter === f.id
                                ? 'bg-indigo-600 text-white shadow-sm'
                                : 'bg-slate-800/70 text-slate-400 hover:text-white'
                            }`}
                          >
                            <span className={previewFilter !== f.id ? f.color : ''}>{f.label}</span>
                          </button>
                        ))}
                      </div>

                      {/* Busca textual na tabela */}
                      <div className="relative min-w-[200px]">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          type="text"
                          value={previewSearch}
                          onChange={(e) => setPreviewSearch(e.target.value)}
                          placeholder="Buscar registros..."
                          className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    {/* Tabela Interativa de Validação Linha a Linha */}
                    <div className="overflow-hidden border border-slate-800 rounded-xl">
                      <div className="overflow-x-auto max-h-[380px] overflow-y-auto no-scrollbar">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-900 text-slate-400 uppercase font-mono text-[10px] tracking-wider sticky top-0 z-10 border-b border-slate-800">
                            <tr>
                              <th className="p-3 w-16 text-center">Linha</th>
                              <th className="p-3 w-32">Status</th>
                              <th className="p-3 min-w-[220px]">Diagnóstico</th>
                              {Object.keys(fileAnalysis.rawData[0] || {}).slice(0, 6).map(k => (
                                <th key={k} className="p-3 font-semibold text-slate-300">{k}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300 bg-slate-900/40">
                            {filteredRows.length === 0 ? (
                              <tr>
                                <td colSpan={10} className="p-6 text-center text-slate-500 italic">
                                  Nenhum registro correspondente ao filtro selecionado.
                                </td>
                              </tr>
                            ) : (
                              filteredRows.map((item) => (
                                <tr key={item.rowNum} className="hover:bg-slate-800/40 transition-colors">
                                  <td className="p-3 text-center text-slate-500 font-bold">
                                    #{item.rowNum}
                                  </td>
                                  <td className="p-3 whitespace-nowrap">
                                    {item.status === 'valid' && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-[10px]">
                                        <CheckCircle2 size={12} /> Válido
                                      </span>
                                    )}
                                    {item.status === 'warning' && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-[10px]">
                                        <AlertTriangle size={12} /> Aviso
                                      </span>
                                    )}
                                    {item.status === 'error' && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold text-[10px]">
                                        <XCircle size={12} /> Erro
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3 text-[11px] font-sans">
                                    {item.errors.length > 0 ? (
                                      <span className="text-rose-400 font-semibold">{item.errors.join(' • ')}</span>
                                    ) : item.warnings.length > 0 ? (
                                      <span className="text-amber-400/90">{item.warnings.join(' • ')}</span>
                                    ) : (
                                      <span className="text-emerald-400/80">Pronto para ingestão</span>
                                    )}
                                  </td>
                                  {Object.keys(fileAnalysis.rawData[0] || {}).slice(0, 6).map(k => (
                                    <td key={k} className="p-3 whitespace-nowrap text-slate-300">
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

                    {/* Barra de Ações e Ingestão */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-slate-800">
                      
                      {/* Checkbox de Tolerância a Falhas */}
                      <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={skipErrors}
                          onChange={(e) => setSkipErrors(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>
                          Ignorar registros com erros ({fileAnalysis.counts.error}) e importar apenas os válidos ({fileAnalysis.counts.valid + fileAnalysis.counts.warning})
                        </span>
                      </label>

                      <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                        <button 
                          onClick={() => { setFileAnalysis(null); resetFileInput(); }} 
                          disabled={loading} 
                          className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition-colors disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                        
                        <button 
                          onClick={confirmImport} 
                          disabled={loading || (fileAnalysis.counts.valid + fileAnalysis.counts.warning === 0)}
                          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 flex items-center gap-2 disabled:opacity-50 transition-all"
                        >
                          {loading ? (
                            <>
                              <RefreshCw size={15} className="animate-spin"/>
                              <span>{progress ? `Importando ${progress.done}/${progress.total}...` : 'Processando...'}</span>
                            </>
                          ) : (
                            <>
                              <Play size={15} fill="currentColor"/>
                              <span>Iniciar Ingestão em Massa</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Barra de Progresso Animada */}
                    {loading && progress && (
                      <div className="space-y-2 pt-2 animate-in fade-in duration-300">
                        <div className="flex justify-between text-xs text-slate-400 font-mono">
                          <span>Processando lote {progress.currentBatch} de {progress.totalBatches}...</span>
                          <span className="font-bold text-indigo-400">
                            {Math.round((progress.done / progress.total) * 100)}% ({progress.done}/{progress.total})
                          </span>
                        </div>
                        <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden border border-slate-700">
                          <div 
                            className="h-full bg-gradient-to-r from-indigo-500 via-blue-500 to-emerald-400 rounded-full transition-all duration-300"
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
            
            /* Dropzone Interativo e Responsivo com Drag & Drop */
            <div 
              className={`border-2 border-dashed rounded-2xl p-10 md:p-16 text-center transition-all cursor-pointer group flex flex-col items-center justify-center min-h-[340px] relative overflow-hidden backdrop-blur-xl ${
                dragActive 
                  ? 'border-indigo-400 bg-indigo-950/40 shadow-2xl shadow-indigo-500/20 scale-[1.01]' 
                  : 'border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/80'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {/* Efeito Glow de Fundo */}
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-blue-500/5 pointer-events-none" />

              <input 
                ref={fileInputRef} 
                type="file" 
                className="hidden" 
                accept=".xlsx,.xls,.csv,.json" 
                onChange={handleFileChange} 
              />
              
              <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-5 transition-all shadow-xl ${
                dragActive 
                  ? 'bg-indigo-600 text-white scale-110 rotate-3' 
                  : 'bg-slate-800/90 text-indigo-400 group-hover:scale-105 group-hover:bg-indigo-600/20 group-hover:text-indigo-300 border border-slate-700'
              }`}>
                {dragActive ? (
                  <UploadCloud size={40} className="animate-bounce"/>
                ) : (
                  <FileSpreadsheet size={40}/>
                )}
              </div>
              
              <h3 className={`text-lg md:text-xl font-black mb-2 transition-colors ${
                dragActive ? 'text-indigo-200' : 'text-white group-hover:text-indigo-200'
              }`}>
                {dragActive ? 'Solte a planilha agora' : 'Arraste ou Selecione seu Arquivo'}
              </h3>
              
              <p className="text-slate-400 text-xs md:text-sm max-w-md mx-auto mb-6 leading-relaxed">
                Suporta planilhas <strong>Excel (.xlsx, .xls)</strong>, arquivos <strong>CSV (.csv)</strong> ou <strong>JSON (.json)</strong> estruturados para <strong>{currentSchema.label}</strong>.
              </p>

              {/* Badges de Formatos Aceitos */}
              <div className="flex flex-wrap justify-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[11px] font-bold">
                  .XLSX
                </span>
                <span className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[11px] font-bold">
                  .CSV
                </span>
                <span className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[11px] font-bold">
                  .JSON
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Alerta Flutuante de Sucesso com Estilo V3 */}
      {notification && (
        <div className="fixed bottom-8 right-8 z-50 animate-in slide-in-from-bottom-5 duration-300 bg-slate-900 border border-emerald-500/50 text-white px-5 py-4 rounded-2xl shadow-2xl shadow-emerald-950/50 flex items-center gap-3.5 backdrop-blur-xl">
          <div className="p-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 rounded-xl">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <h4 className="font-black text-sm text-white">Ingestão Concluída!</h4>
            <p className="text-xs text-slate-300">{notification.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportData;

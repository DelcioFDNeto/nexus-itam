// src/components/employees/EmployeeCustodyModal.jsx
import React, { useState } from 'react';
import { 
  X, Briefcase, Laptop, Smartphone, Monitor, HardDrive, 
  Copy, Check, ExternalLink, FileSignature, Undo2, 
  DollarSign, ShieldCheck, UserCheck, MapPin, Mail, 
  CreditCard, Network, AlertCircle, ArrowUpRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { parseBRL, formatBRL } from '../../utils/currency';

const getAssetIcon = (type) => {
  const t = (type || '').toLowerCase();
  if (t.includes('note') || t.includes('laptop')) return Laptop;
  if (t.includes('cel') || t.includes('phone') || t.includes('smart')) return Smartphone;
  if (t.includes('monit') || t.includes('tela')) return Monitor;
  return HardDrive;
};

const EmployeeCustodyModal = ({
  employee,
  assets = [],
  onClose,
  onOpenTerm,
  canIssueTerms = true
}) => {
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState(null);

  if (!employee) return null;

  const copyToClipboard = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success(`Copiado: ${text}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const totalValue = assets.reduce((sum, a) => {
    return sum + parseBRL(a.valor ?? a.purchase_value ?? a.purchaseValue ?? 0);
  }, 0);

  const collaboratorPortalUrl = `${window.location.origin}/meus-ativos?employee=${encodeURIComponent(employee.name || '')}`;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col border border-slate-200 dark:border-slate-700 animate-in zoom-in-95 overflow-hidden">
        
        {/* Header do Colaborador */}
        <div className="p-6 border-b border-slate-100 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/70 flex justify-between items-start">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-brand text-white flex items-center justify-center font-black text-xl shadow-md uppercase shrink-0">
              {(employee.name || '?').substring(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-slate-900 dark:text-white leading-tight">
                  {employee.name}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-brand/10 text-brand border border-brand/20">
                  Custódia de Ativos
                </span>
              </div>
              
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {employee.role || 'Cargo não informado'} • <span className="font-bold text-slate-700 dark:text-slate-200">{employee.sector || 'Setor Geral'}</span>
              </p>

              <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                {employee.branch && (
                  <span className="flex items-center gap-1">
                    <MapPin size={12} className="text-slate-400"/> {employee.branch}
                  </span>
                )}
                {employee.email && (
                  <span className="flex items-center gap-1 truncate max-w-[200px]" title={employee.email}>
                    <Mail size={12} className="text-slate-400"/> {employee.email}
                  </span>
                )}
                {employee.cpf && (
                  <span className="flex items-center gap-1 font-mono">
                    <CreditCard size={12} className="text-slate-400"/> {employee.cpf}
                  </span>
                )}
                {employee.login && (
                  <span className="flex items-center gap-1 font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px]">
                    <Network size={11} className="text-brand"/> {employee.login}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button 
            onClick={onClose} 
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Resumo de Custódia KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-5 bg-slate-100/50 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-700">
          <div className="bg-white dark:bg-slate-800 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand/10 text-brand">
              <Briefcase size={20} />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Itens em Custódia</span>
              <p className="text-lg font-black text-slate-900 dark:text-white leading-tight">
                {assets.length} {assets.length === 1 ? 'ativo' : 'ativos'}
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600">
              <DollarSign size={20} />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Patrimônio em Posse</span>
              <p className="text-lg font-black text-slate-900 dark:text-white leading-tight truncate" title={formatBRL(totalValue)}>
                {formatBRL(totalValue)}
              </p>
            </div>
          </div>

          <div className="col-span-2 sm:col-span-1 bg-white dark:bg-slate-800 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm flex items-center justify-between sm:justify-start gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-600">
              <ShieldCheck size={20} />
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Conformidade Legal</span>
              <p className="text-xs font-black text-slate-800 dark:text-slate-200 leading-tight">
                {assets.length > 0 ? 'Art. 462 §1 CLT' : 'Sem equipamentos'}
              </p>
            </div>
          </div>
        </div>

        {/* Lista de Ativos em Posse */}
        <div className="p-6 overflow-y-auto max-h-[48vh] space-y-3 custom-scrollbar flex-1">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Laptop size={14} className="text-brand" /> Equipamentos Alocados ao Colaborador ({assets.length})
            </h3>
            <span className="text-[10px] text-slate-400">Clique na tag ou serial para copiar</span>
          </div>

          {assets.length === 0 ? (
            <div className="py-12 px-4 text-center border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl text-slate-400 dark:text-slate-500">
              <Briefcase size={40} className="mx-auto mb-2 opacity-30 text-brand" />
              <p className="font-bold text-slate-700 dark:text-slate-300 text-sm">
                Nenhum ativo atribuído a este colaborador
              </p>
              <p className="text-xs mt-1 text-slate-400 max-w-sm mx-auto">
                Para vincular um equipamento, edite um ativo na lista de inventário e defina este colaborador como responsável.
              </p>
            </div>
          ) : (
            assets.map(asset => {
              const IconComp = getAssetIcon(asset.type);
              const tag = asset.internalId || asset.internal_id || asset.id;
              const serial = asset.serialNumber || asset.serial_number || 'S/N';
              const assetVal = asset.valor ?? asset.purchase_value ?? asset.purchaseValue;

              return (
                <div 
                  key={asset.id} 
                  className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-800/90 hover:border-brand/40 hover:shadow-md transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0">
                      <IconComp size={22} className="text-brand" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-bold text-slate-900 dark:text-white text-sm truncate">
                          {asset.model || asset.brand || 'Equipamento Corporativo'}
                        </h4>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                          {asset.type || 'Dispositivo'}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                          {asset.status || 'Em Uso'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs">
                        {/* Tag com Botão de Cópia */}
                        <button
                          onClick={() => copyToClipboard(tag, `tag-${asset.id}`)}
                          className="font-mono font-bold text-slate-700 dark:text-slate-200 hover:text-brand flex items-center gap-1 bg-slate-50 dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 transition-colors"
                          title="Copiar Patrimônio / Tag"
                        >
                          <span className="text-[10px] text-slate-400 font-sans">Tag:</span> {tag}
                          {copiedId === `tag-${asset.id}` ? <Check size={12} className="text-emerald-500" /> : <Copy size={11} className="text-slate-400" />}
                        </button>

                        {/* Serial Number com Cópia */}
                        {serial !== 'S/N' && (
                          <button
                            onClick={() => copyToClipboard(serial, `sn-${asset.id}`)}
                            className="font-mono text-slate-600 dark:text-slate-400 hover:text-brand flex items-center gap-1 text-[11px] transition-colors"
                            title="Copiar Número de Série"
                          >
                            <span className="text-slate-400">S/N:</span> {serial}
                            {copiedId === `sn-${asset.id}` ? <Check size={12} className="text-emerald-500" /> : <Copy size={10} className="text-slate-400" />}
                          </button>
                        )}

                        {assetVal && (
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            Valor: {formatBRL(assetVal)}
                          </span>
                        )}

                        {asset.location && (
                          <span className="text-[11px] text-slate-400 flex items-center gap-1">
                            <MapPin size={11} /> {asset.location}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Ação de abrir ficha */}
                  <button
                    onClick={() => {
                      onClose();
                      navigate(`/assets/${asset.id}`);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-brand hover:bg-brand/10 rounded-xl transition-all shrink-0"
                    title="Abrir prontuário completo deste ativo"
                  >
                    <span>Ficha</span>
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Rodapé de Ações do Gestor */}
        <div className="p-5 border-t border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Link para autoatendimento */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => {
                copyToClipboard(collaboratorPortalUrl, 'portal-url');
              }}
              className="text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-brand flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 transition-colors"
              title="Copiar link da página de custódia do colaborador"
            >
              {copiedId === 'portal-url' ? <Check size={14} className="text-emerald-500" /> : <ExternalLink size={14} className="text-brand" />}
              <span>{copiedId === 'portal-url' ? 'Link Copiado!' : 'Copiar Link da Central'}</span>
            </button>

            <button
              onClick={() => {
                onClose();
                navigate(`/meus-ativos?employee=${encodeURIComponent(employee.name || '')}`);
              }}
              className="text-xs font-bold text-brand hover:underline flex items-center gap-1 px-2 py-1"
            >
              <span>Abrir Central</span>
              <ArrowUpRight size={13} />
            </button>
          </div>

          {/* Botões de Termo & Devolução */}
          {canIssueTerms && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => onOpenTerm('responsabilidade')}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 font-bold text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Emitir Termo de Responsabilidade e Uso"
              >
                <FileSignature size={15} className="text-brand" />
                <span>Emitir Termo</span>
              </button>

              <button
                onClick={() => onOpenTerm('devolucao')}
                disabled={assets.length === 0}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 font-bold text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                title="Registrar devolução de ativos (desligamento ou troca)"
              >
                <Undo2 size={15} className="text-amber-500" />
                <span>Devolução</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeCustodyModal;

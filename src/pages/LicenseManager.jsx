// src/pages/LicenseManager.jsx
import React, { useState, useEffect } from 'react';
import { getLicenses, createLicense, deleteLicense, assignLicense, unassignLicense } from '../services/licenseService';
import { useAssets } from '../hooks/useAssets';
import {
  Key, ShieldCheck, Plus, Trash2, Search, Monitor,
  X, Copy, CheckCircle, AlertTriangle, Calendar
} from 'lucide-react';

const LicenseManager = () => {
  const [licenses, setLicenses] = useState([]);
  const { assets } = useAssets();
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Modais
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [selectedLicense, setSelectedLicense] = useState(null);

  // Form State
  const [formData, setFormData] = useState({
    softwareName: '',
    key: '',
    type: 'Vitalícia',
    totalSeats: 1,
    expirationDate: ''
  });

  // Assign State
  const [selectedAssetId, setSelectedAssetId] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getLicenses();
      setLicenses(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // --- AÇÕES ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createLicense(formData);
      alert("Licença cadastrada!");
      setIsFormOpen(false);
      setFormData({ softwareName: '', key: '', type: 'Vitalícia', totalSeats: 1, expirationDate: '' });
      loadData();
    } catch (error) {
      alert("Erro ao salvar.");
    }
  };

  const handleDelete = async (id) => {
    if (confirm("Excluir esta licença?")) {
      await deleteLicense(id);
      loadData();
    }
  };

  const handleAssign = async () => {
    if (!selectedAssetId || !selectedLicense) return;

    const used = selectedLicense.assignedAssets?.length || 0;
    if (used >= selectedLicense.totalSeats) return alert("Todas as ativações foram usadas!");

    const assetObj = assets.find(a => a.id === selectedAssetId);

    try {
      await assignLicense(selectedLicense.id, assetObj.id, `${assetObj.model} (${assetObj.internalId})`);
      alert("Ativo vinculado!");
      setIsAssignOpen(false);
      loadData();
    } catch (error) {
      alert("Erro ao vincular.");
    }
  };

  const handleUnassign = async (license, assetObj) => {
    if (confirm(`Remover a licença de ${assetObj.name}?`)) {
      await unassignLicense(license.id, assetObj);
      loadData();
    }
  };

  const getUsageColor = (used, total) => {
    const percentage = (used / total) * 100;
    if (percentage >= 100) return 'bg-red-500';
    if (percentage >= 80) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const filteredLicenses = licenses.filter(l =>
    l.softwareName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-8 max-w-[1600px] mx-auto pb-24"> {/* Adicionado pb-24 para scroll e footer */}

      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
            <ShieldCheck className="text-shineray" /> Licenças & Software
          </h1>
          <p className="text-sm text-gray-500">Gestão de chaves, contratos e ativações.</p>
        </div>
        <button onClick={() => setIsFormOpen(true)} className="bg-black text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-gray-800 transition shadow-lg hover:scale-105 active:scale-95">
          <Plus size={20} /> Nova Licença
        </button>
      </div>

      {/* FILTRO */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex items-center gap-3 sticky top-0 z-10"> {/* Sticky search bar */}
        <Search className="text-gray-400" size={20} />
        <input
          type="text"
          placeholder="Buscar software (Office, Windows, Adobe...)"
          className="flex-1 outline-none text-sm bg-transparent"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="text-gray-400 hover:text-gray-600">
                <X size={16} />
            </button>
        )}
      </div>

      {/* LISTA DE LICENÇAS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"> {/* Mudança para Grid Responsivo */}
        {loading ? (
            <div className="col-span-full text-center py-10">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                <p className="mt-2 text-gray-500">Carregando licenças...</p>
            </div>
        ) : filteredLicenses.length === 0 ? (
            <div className="col-span-full text-center py-10 text-gray-500">
                Nenhuma licença encontrada.
            </div>
        ) : (
          filteredLicenses.map(license => {
            const used = license.assignedAssets?.length || 0;
            const total = parseInt(license.totalSeats) || 1;
            const percentage = Math.min((used / total) * 100, 100);
            const isExpired = license.expirationDate && new Date(license.expirationDate) < new Date();
            const daysToExpire = license.expirationDate ? Math.ceil((new Date(license.expirationDate) - new Date()) / (1000 * 60 * 60 * 24)) : null;


            return (
              <div key={license.id} className={`bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between ${isExpired ? 'border-red-300 bg-red-50' : ''}`}>
                
                {/* Cabeçalho do Card */}
                <div>
                    <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${isExpired ? 'bg-red-200 text-red-700' : 'bg-blue-50 text-blue-600'}`}>
                                <Key size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-gray-900 line-clamp-1" title={license.softwareName}>{license.softwareName}</h3>
                                <div className="flex gap-2 text-xs mt-1">
                                    <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-200">{license.type}</span>
                                    {isExpired ? (
                                        <span className="bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded flex items-center gap-1"><AlertTriangle size={10}/> VENCIDA</span>
                                    ) : daysToExpire !== null && daysToExpire <= 30 ? (
                                        <span className="bg-yellow-100 text-yellow-800 font-bold px-2 py-0.5 rounded flex items-center gap-1"><AlertTriangle size={10}/> Vence em {daysToExpire} dias</span>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                        <button onClick={() => handleDelete(license.id)} className="text-gray-300 hover:text-red-500 p-1 rounded hover:bg-gray-100 transition-colors" title="Excluir Licença">
                            <Trash2 size={18} />
                        </button>
                    </div>

                    {/* Chave de Licença */}
                    <div className="flex items-center gap-2 text-sm font-mono bg-gray-50 p-2 rounded border border-gray-200 mb-4 select-all relative group">
                        <span className="text-gray-500 font-bold text-xs select-none">KEY:</span>
                        <span className="font-bold text-gray-800 truncate flex-1" title={license.key}>{license.key}</span>
                        <button 
                            onClick={() => { navigator.clipboard.writeText(license.key); alert("Chave copiada para a área de transferência!"); }} 
                            className="text-gray-400 hover:text-blue-600 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity absolute right-1 bg-gray-50"
                            title="Copiar Chave"
                        >
                            <Copy size={14} />
                        </button>
                    </div>

                    {/* Barra de Progresso */}
                    <div className="mb-4">
                        <div className="flex justify-between text-xs font-bold uppercase mb-1 text-gray-500">
                            <span>Utilização</span>
                            <span className={`${used >= total ? 'text-red-600' : 'text-green-600'}`}>{used} / {total}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden border border-gray-100">
                            <div className={`h-full rounded-full transition-all duration-500 ${getUsageColor(used, total)}`} style={{ width: `${percentage}%` }}></div>
                        </div>
                    </div>

                    {/* Lista de Ativos Vinculados (Scrollável se muitos) */}
                    <div className="space-y-1 max-h-24 overflow-y-auto custom-scrollbar mb-4 pr-1">
                        {license.assignedAssets?.length > 0 ? (
                            license.assignedAssets.map((asset, idx) => (
                                <div key={idx} className="flex items-center justify-between bg-gray-50 px-2 py-1.5 rounded text-xs border border-gray-100 group/item hover:border-gray-300 transition-colors">
                                    <div className="flex items-center gap-2 truncate">
                                        <Monitor size={12} className="text-gray-400" />
                                        <span className="font-medium text-gray-700 truncate" title={asset.name}>{asset.name}</span>
                                    </div>
                                    <button onClick={() => handleUnassign(license, asset)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover/item:opacity-100 transition-opacity" title="Desvincular">
                                        <X size={12} />
                                    </button>
                                </div>
                            ))
                        ) : (
                            <p className="text-xs text-gray-400 italic text-center py-2">Nenhum ativo vinculado.</p>
                        )}
                    </div>
                </div>

                {/* Rodapé do Card */}
                <div className="pt-3 border-t border-gray-100 flex justify-between items-center mt-auto">
                    <div className="text-xs text-gray-400 flex items-center gap-1">
                        {license.expirationDate ? (
                            <>
                                <Calendar size={12}/> Vence em {new Date(license.expirationDate).toLocaleDateString('pt-BR')}
                            </>
                        ) : (
                            <>
                                <CheckCircle size={12} className="text-green-500"/> Permanente
                            </>
                        )}
                    </div>
                    
                    {used < total && !isExpired && (
                        <button 
                            onClick={() => { setSelectedLicense(license); setIsAssignOpen(true); }}
                            className="flex items-center gap-1 bg-black text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-800 transition-colors shadow-sm hover:shadow"
                        >
                            <Plus size={12} /> Vincular
                        </button>
                    )}
                </div>

              </div>
            );
          })
        )}
      </div>

      {/* MODAL NOVA LICENÇA */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in duration-200">
            <div className="bg-black p-4 text-white flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2 text-lg"><Key size={20} /> Cadastrar Software</h3>
              <button onClick={() => setIsFormOpen(false)} className="hover:bg-gray-800 p-1 rounded transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome do Software</label>
                  <input required className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black outline-none transition-all" placeholder="Ex: Microsoft Office 2021 Home & Business" value={formData.softwareName} onChange={e => setFormData({ ...formData, softwareName: e.target.value })} />
              </div>
              <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Chave de Ativação (Key)</label>
                  <input required className="w-full p-3 border border-gray-300 rounded-lg font-mono bg-gray-50 text-sm focus:ring-2 focus:ring-black outline-none transition-all" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" value={formData.key} onChange={e => setFormData({ ...formData, key: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo</label>
                    <div className="relative">
                        <select className="w-full p-3 border border-gray-300 rounded-lg bg-white appearance-none focus:ring-2 focus:ring-black outline-none transition-all cursor-pointer" value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })}>
                            <option>Vitalícia</option>
                            <option>Assinatura Anual</option>
                            <option>Assinatura Mensal</option>
                            <option>OEM</option>
                            <option>Open License (Volume)</option>
                        </select>
                        <div className="absolute right-3 top-3.5 pointer-events-none text-gray-400 text-xs">▼</div>
                    </div>
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Quantidade (Seats)</label>
                    <input type="number" min="1" required className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black outline-none transition-all" value={formData.totalSeats} onChange={e => setFormData({ ...formData, totalSeats: e.target.value })} />
                </div>
              </div>
              <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Expiração (Opcional)</label>
                  <input type="date" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black outline-none transition-all text-gray-600" value={formData.expirationDate} onChange={e => setFormData({ ...formData, expirationDate: e.target.value })} />
              </div>
              <div className="pt-2">
                  <button type="submit" className="w-full bg-black hover:bg-gray-800 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg active:scale-95 text-sm uppercase tracking-wide">
                      Salvar Licença
                  </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL VINCULAR ATIVO */}
      {isAssignOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in duration-200">
            <div className="bg-black p-4 text-white flex justify-between items-center">
              <h3 className="font-bold text-lg">Vincular a Ativo</h3>
              <button onClick={() => setIsAssignOpen(false)} className="hover:bg-gray-800 p-1 rounded transition-colors"><X size={20} /></button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                  Selecione qual máquina receberá uma ativação de <strong className="text-black">{selectedLicense?.softwareName}</strong>.
              </p>
              
              <div className="relative mb-6">
                  <select 
                    className="w-full p-3 border border-gray-300 rounded-xl bg-white appearance-none focus:ring-2 focus:ring-black outline-none transition-all cursor-pointer font-medium text-gray-700" 
                    value={selectedAssetId} 
                    onChange={e => setSelectedAssetId(e.target.value)}
                  >
                    <option value="">Selecione um ativo...</option>
                    {assets.sort((a, b) => a.model.localeCompare(b.model)).map(asset => (
                      <option key={asset.id} value={asset.id}>{asset.model} ({asset.internalId})</option>
                    ))}
                  </select>
                  <div className="absolute right-3 top-3.5 pointer-events-none text-gray-400 text-xs">▼</div>
              </div>

              <button 
                onClick={handleAssign} 
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg active:scale-95 text-sm uppercase tracking-wide flex justify-center items-center gap-2"
              >
                  <CheckCircle size={18} /> Confirmar Vínculo
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default LicenseManager;
// src/components/MoveAssetModal.jsx
import React, { useState, useEffect } from 'react';
import { X, MapPin, User, Calendar, Truck, Search, ArrowRight, ArrowRightLeft } from 'lucide-react';
import { getEmployees } from '../services/employeeService';

const MoveAssetModal = ({ isOpen, onClose, asset, onConfirm }) => {
  const [employees, setEmployees] = useState([]);
  
  const [formData, setFormData] = useState({
    newLocation: '',
    newResponsible: '',
    date: new Date().toISOString().split('T')[0],
    reason: ''
  });

  useEffect(() => {
    if (isOpen) {
        const fetchEmps = async () => {
            const data = await getEmployees();
            setEmployees(data);
        };
        fetchEmps();
        
        // Inicializa com vazio para forçar o usuário a escolher, 
        // ou você pode iniciar com os dados atuais se preferir.
        setFormData({
            newLocation: '', // Começa vazio para o usuário selecionar
            newResponsible: asset?.assignedTo || '', // Mantém o responsável atual como sugestão
            date: new Date().toISOString().split('T')[0],
            reason: ''
        });
    }
  }, [isOpen, asset]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.newLocation) return alert("Selecione o novo local!");
    onConfirm(formData);
    onClose();
  };

  const handleResponsibleSelect = (e) => {
      setFormData({ ...formData, newResponsible: e.target.value });
  };

  const isCustomResponsible = formData.newResponsible && !employees.find(e => e.name === formData.newResponsible);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 border border-gray-200">
        
        {/* Header Shineray */}
        <div className="bg-red-600 p-5 flex justify-between items-center text-white shadow-md">
          <div>
            <h2 className="text-xl font-black flex items-center gap-2 uppercase tracking-wide">
              <Truck className="text-white" size={24}/> Transferência
            </h2>
            <p className="text-red-100 text-xs mt-0.5 font-bold opacity-90">{asset?.model} ({asset?.internalId})</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-red-700 rounded-lg transition-colors text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          
          {/* --- QUADRO DE PRÉVIA (ORIGEM -> DESTINO) --- */}
          <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
              
              {/* ORIGEM (ATUAL) */}
              <div className="bg-gray-100 p-3 rounded-xl border border-gray-200 flex flex-col h-full justify-center opacity-70">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">Origem (Atual)</span>
                  <div className="flex items-center gap-1.5 text-gray-700 font-bold text-xs mb-1">
                      <MapPin size={12}/> <span className="truncate">{asset?.location || "N/A"}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-gray-500 font-medium text-[10px]">
                      <User size={12}/> <span className="truncate">{asset?.assignedTo || "Sem resp."}</span>
                  </div>
              </div>

              {/* SETA */}
              <div className="flex justify-center text-gray-300">
                  <ArrowRight size={24} />
              </div>

              {/* DESTINO (NOVO) */}
              <div className={`p-3 rounded-xl border flex flex-col h-full justify-center transition-all ${formData.newLocation ? 'bg-blue-50 border-blue-200' : 'bg-white border-dashed border-gray-300'}`}>
                  <span className={`text-[10px] font-black uppercase tracking-wider mb-1 ${formData.newLocation ? 'text-blue-600' : 'text-gray-300'}`}>Destino (Novo)</span>
                  <div className={`flex items-center gap-1.5 font-bold text-xs mb-1 ${formData.newLocation ? 'text-blue-900' : 'text-gray-300'}`}>
                      <MapPin size={12}/> <span className="truncate">{formData.newLocation || "Selecione..."}</span>
                  </div>
                  <div className={`flex items-center gap-1.5 font-medium text-[10px] ${formData.newResponsible ? 'text-blue-700' : 'text-gray-300'}`}>
                      <User size={12}/> <span className="truncate">{formData.newResponsible || "..."}</span>
                  </div>
              </div>
          </div>

          <div className="h-px bg-gray-100 w-full"></div>

          {/* --- FORMULÁRIO --- */}
          <div className="space-y-4">
              
              {/* Seleção de Local (LISTA COMPLETA) */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Novo Local / Filial</label>
                <div className="relative">
                    <select 
                        required
                        value={formData.newLocation} 
                        onChange={(e) => setFormData({...formData, newLocation: e.target.value})} 
                        className="w-full p-3 border-2 border-gray-200 rounded-xl outline-none focus:border-red-600 font-bold bg-white text-gray-800 appearance-none text-sm transition-all focus:shadow-md"
                    >
                        <option value="">Selecione o destino...</option>
                        
                        <optgroup label="Pará - Região Metropolitana">
                            <option value="Matriz - Belém">Matriz - Belém</option>
                            <option value="Fábrica / CD - Ananindeua">Fábrica / CD - Ananindeua</option>
                            <option value="Filial Ananindeua">Filial Ananindeua</option>
                            <option value="Filial Castanhal">Filial Castanhal</option>
                            <option value="Icoaraci">Icoaraci</option>
                            <option value="Barcarena">Barcarena</option>
                        </optgroup>

                        <optgroup label="Pará - Interior">
                            <option value="Acará">Acará</option>
                            <option value="Bragança">Bragança</option>
                            <option value="Breves">Breves</option>
                            <option value="Capanema">Capanema</option>
                            <option value="Capitão Poço">Capitão Poço</option>
                            <option value="Concórdia">Concórdia</option>
                            <option value="Curuçá">Curuçá</option>
                            <option value="Moju">Moju</option>
                            <option value="Igarapé Mirim">Igarapé Mirim</option>
                            <option value="São Miguel">São Miguel</option>
                            <option value="Soure">Soure</option>
                            <option value="Tailândia">Tailândia</option>
                            <option value="Tomé-Açu">Tomé-Açu</option>
                        </optgroup>

                        <optgroup label="Ceará">
                            <option value="Fortaleza (CE)">Fortaleza (CE)</option>
                            <option value="Aldeota (CE)">Aldeota (CE)</option>
                            <option value="Demócrito Rocha (CE)">Demócrito Rocha (CE)</option>
                            <option value="Parangaba (CE)">Parangaba (CE)</option>
                        </optgroup>

                        <optgroup label="Outros">
                            <option value="Home Office">Home Office</option>
                            <option value="Em Trânsito">Em Trânsito</option>
                        </optgroup>
                    </select>
                    <div className="absolute right-4 top-3.5 pointer-events-none text-gray-400">▼</div>
                </div>
              </div>

              {/* Novo Responsável */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Novo Responsável</label>
                <div className="relative">
                    <select 
                        value={formData.newResponsible} 
                        onChange={handleResponsibleSelect}
                        className="w-full p-3 border-2 border-gray-200 rounded-xl outline-none focus:border-red-600 font-medium bg-white text-gray-800 appearance-none pr-10 text-sm"
                    >
                        <option value="">Manter atual / Sem responsável</option>
                        {employees.map(emp => (
                            <option key={emp.id} value={emp.name}>{emp.name} - {emp.sector}</option>
                        ))}
                        {isCustomResponsible && <option value={formData.newResponsible}>{formData.newResponsible}</option>}
                    </select>
                    <Search size={16} className="absolute right-4 top-3.5 text-gray-400 pointer-events-none"/>
                </div>
                {(!formData.newResponsible || isCustomResponsible) && (
                    <input 
                        value={formData.newResponsible} 
                        onChange={(e) => setFormData({...formData, newResponsible: e.target.value})} 
                        className="w-full p-3 border-2 border-gray-200 rounded-xl outline-none focus:border-red-600 text-sm mt-2 bg-gray-50 placeholder-gray-400 font-bold text-gray-700 animate-in slide-in-from-top-1"
                        placeholder="Ou digite o nome manualmente..." 
                    />
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Data</label>
                    <input 
                        type="date"
                        required
                        value={formData.date} 
                        onChange={(e) => setFormData({...formData, date: e.target.value})} 
                        className="w-full p-3 border-2 border-gray-200 rounded-xl outline-none focus:border-red-600 text-sm font-bold text-gray-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Motivo</label>
                    <input 
                        value={formData.reason} 
                        onChange={(e) => setFormData({...formData, reason: e.target.value})} 
                        className="w-full p-3 border-2 border-gray-200 rounded-xl outline-none focus:border-red-600 text-sm font-bold text-gray-700"
                        placeholder="Ex: Promoção..." 
                    />
                  </div>
              </div>
          </div>

          <div className="pt-2">
            <button type="submit" className="w-full bg-black text-white py-4 rounded-xl font-black hover:bg-gray-900 transition shadow-lg flex justify-center items-center gap-2 uppercase tracking-wide text-sm group">
                <ArrowRightLeft size={18} className="group-hover:scale-110 transition-transform"/> Confirmar Transferência
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};

export default MoveAssetModal;
// src/pages/EmployeeManager.jsx
import React, { useState, useEffect } from 'react';
import { 
  getEmployees, addEmployee, updateEmployee, deleteEmployee, 
  getSectors, addSector, updateSector, deleteSector 
} from '../services/employeeService';
import { 
  Users, Briefcase, Plus, Trash2, Search, Edit,
  UserCircle, Building2, MapPin, Mail, Save, X 
} from 'lucide-react';

const EmployeeManager = () => {
  // Estados de Dados
  const [employees, setEmployees] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Controle de Interface
  const [activeTab, setActiveTab] = useState('employees'); 
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // NULL = Criar, ID = Editar
  const [searchTerm, setSearchTerm] = useState('');

  // Formulário Unificado
  const initialForm = {
    name: '', role: '', email: '', cpf: '', branch: 'Matriz - Belém', sectorId: '',
    sectorName: '', manager: '', description: ''
  };
  const [formData, setFormData] = useState(initialForm);

  // --- CARGA DE DADOS ---
  const loadData = async () => {
    setLoading(true);
    try {
        const [empData, secData] = await Promise.all([getEmployees(), getSectors()]);
        setEmployees(empData);
        setSectors(secData);
    } catch (error) {
        console.error("Erro ao carregar:", error);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // --- AÇÕES DO MODAL (CRIAR vs EDITAR) ---
  
  const openCreateModal = () => {
      setEditingId(null);
      setFormData(initialForm);
      setIsModalOpen(true);
  };

  const openEditModal = (item) => {
      setEditingId(item.id);
      
      if (activeTab === 'employees') {
          // Preenche dados do Funcionário
          setFormData({
              ...initialForm,
              name: item.name,
              role: item.role,
              email: item.email,
              cpf: item.cpf,
              branch: item.branch,
              sectorId: item.sector // Aqui 'sector' guarda o nome ou ID
          });
      } else {
          // Preenche dados do Setor
          setFormData({
              ...initialForm,
              sectorName: item.name,
              manager: item.manager,
              description: item.description
          });
      }
      setIsModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
        if (activeTab === 'employees') {
            const payload = {
                name: formData.name,
                role: formData.role,
                email: formData.email,
                cpf: formData.cpf,
                branch: formData.branch,
                sector: formData.sectorId || 'Geral',
                updatedAt: new Date()
            };

            if (editingId) {
                await updateEmployee(editingId, payload);
            } else {
                await addEmployee({ ...payload, createdAt: new Date() });
            }
        } else {
            const payload = {
                name: formData.sectorName,
                manager: formData.manager,
                description: formData.description,
                updatedAt: new Date()
            };

            if (editingId) {
                await updateSector(editingId, payload);
            } else {
                await addSector({ ...payload, createdAt: new Date() });
            }
        }
        setIsModalOpen(false);
        loadData();
    } catch (error) {
        alert("Erro ao salvar.");
    }
  };

  const handleDelete = async (id) => {
    if (confirm("Tem certeza que deseja excluir este registro?")) {
        if (activeTab === 'employees') await deleteEmployee(id);
        else await deleteSector(id);
        loadData();
    }
  };

  // --- FILTROS ---
  const filteredList = activeTab === 'employees' 
    ? employees.filter(e => e.name.toLowerCase().includes(searchTerm.toLowerCase()) || e.role?.toLowerCase().includes(searchTerm.toLowerCase()))
    : sectors.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto pb-24">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-8">
        <div>
            <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                <Users className="text-shineray" size={28}/> Gestão de Pessoas & Áreas
            </h1>
            <p className="text-sm text-gray-500">Mantenha a estrutura organizacional atualizada</p>
        </div>
        <button onClick={openCreateModal} className="bg-black text-white px-5 py-2.5 rounded-xl font-bold hover:bg-gray-800 flex items-center gap-2 shadow-lg transition-all active:scale-95">
            <Plus size={20}/> {activeTab === 'employees' ? 'Novo Colaborador' : 'Novo Setor'}
        </button>
      </div>

      {/* TABS DE NAVEGAÇÃO */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-full md:w-fit mb-6">
          <button 
            onClick={() => setActiveTab('employees')} 
            className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'employees' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
              <UserCircle size={18}/> Colaboradores
          </button>
          <button 
            onClick={() => setActiveTab('sectors')} 
            className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'sectors' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
              <Briefcase size={18}/> Setores / Deptos
          </button>
      </div>

      {/* BARRA DE BUSCA */}
      <div className="relative mb-6">
          <Search className="absolute left-3 top-3 text-gray-400" size={20}/>
          <input 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={activeTab === 'employees' ? "Buscar por nome, cargo, email..." : "Buscar setor..."}
            className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl outline-none focus:border-black focus:ring-1 focus:ring-black transition-all"
          />
      </div>

      {/* CONTEÚDO */}
      {loading ? (
          <div className="text-center py-20 text-gray-400 animate-pulse">Carregando dados...</div>
      ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              
              {/* --- LISTA DE COLABORADORES --- */}
              {activeTab === 'employees' && filteredList.map(emp => (
                  <div key={emp.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all group relative flex flex-col">
                      <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-black text-lg border border-gray-200 uppercase">
                                  {emp.name.substring(0,2)}
                              </div>
                              <div>
                                  <h3 className="font-bold text-gray-900 leading-tight">{emp.name}</h3>
                                  <p className="text-xs text-gray-500 font-medium">{emp.role || "Cargo não inf."}</p>
                              </div>
                          </div>
                          <div className="flex gap-1">
                              <button onClick={() => openEditModal(emp)} className="text-gray-400 hover:text-blue-600 p-1.5 rounded-lg hover:bg-blue-50 transition-colors"><Edit size={16}/></button>
                              <button onClick={() => handleDelete(emp.id)} className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors"><Trash2 size={16}/></button>
                          </div>
                      </div>
                      
                      <div className="mt-auto space-y-2 pt-3 border-t border-gray-50">
                          <div className="flex items-center gap-2 text-xs text-gray-600">
                              <Briefcase size={14} className="text-shineray"/> 
                              <span className="font-bold bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{emp.sector}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-600">
                              <MapPin size={14} className="text-gray-400"/> {emp.branch}
                          </div>
                          {emp.email && (
                              <div className="flex items-center gap-2 text-xs text-gray-500 truncate" title={emp.email}>
                                  <Mail size={14} className="text-gray-400"/> {emp.email}
                              </div>
                          )}
                      </div>
                  </div>
              ))}

              {/* --- LISTA DE SETORES --- */}
              {activeTab === 'sectors' && filteredList.map(sec => (
                  <div key={sec.id} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:border-black transition-all group relative">
                      <div className="flex justify-between items-start mb-4">
                          <div className="p-3 bg-gray-50 rounded-xl">
                              <Building2 size={24} className="text-gray-700"/>
                          </div>
                          <div className="flex gap-1">
                              <button onClick={() => openEditModal(sec)} className="text-gray-400 hover:text-blue-600 p-1.5 rounded-lg hover:bg-blue-50 transition-colors"><Edit size={16}/></button>
                              <button onClick={() => handleDelete(sec.id)} className="text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors"><Trash2 size={16}/></button>
                          </div>
                      </div>
                      
                      <h3 className="text-xl font-black text-gray-900 mb-1">{sec.name}</h3>
                      <p className="text-sm text-gray-500 mb-4 line-clamp-2 h-10">{sec.description || "Sem descrição."}</p>
                      
                      <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border border-gray-100">
                          <UserCircle size={16} className="text-gray-400"/>
                          <div className="text-xs">
                              <span className="block font-bold text-gray-400 uppercase text-[9px]">Gestor / Responsável</span>
                              <span className={`font-bold ${sec.manager ? 'text-gray-800' : 'text-gray-400 italic'}`}>{sec.manager || "Não atribuído"}</span>
                          </div>
                      </div>
                  </div>
              ))}

              {filteredList.length === 0 && (
                  <div className="col-span-full py-12 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-2xl">
                      Nenhum registro encontrado.
                  </div>
              )}
          </div>
      )}

      {/* MODAL DE EDIÇÃO / CRIAÇÃO */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-black text-gray-900 flex items-center gap-2">
                    {editingId ? <Edit size={20}/> : <Plus size={20}/>} 
                    {editingId ? 'Editar' : 'Novo'} {activeTab === 'employees' ? 'Colaborador' : 'Setor'}
                </h2>
                <button onClick={() => setIsModalOpen(false)} className="p-1 rounded hover:bg-gray-100"><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSave} className="space-y-4">
              
              {activeTab === 'employees' ? (
                  // --- FORMULÁRIO DE COLABORADOR ---
                  <>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Nome Completo</label>
                        <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full p-3 border rounded-xl font-bold outline-none focus:border-black" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase">Cargo</label>
                            <input value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} className="w-full p-3 border rounded-xl outline-none focus:border-black" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase">Setor</label>
                            <select value={formData.sectorId} onChange={e => setFormData({...formData, sectorId: e.target.value})} className="w-full p-3 border rounded-xl bg-white outline-none focus:border-black cursor-pointer">
                                <option value="">Selecione...</option>
                                {/* Puxa os setores da outra aba */}
                                {sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                <option value="Outro">Outro / Externo</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Email</label>
                        <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full p-3 border rounded-xl outline-none focus:border-black" />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Unidade / Base</label>
                        <select value={formData.branch} onChange={e => setFormData({...formData, branch: e.target.value})} className="w-full p-3 border rounded-xl bg-white outline-none focus:border-black">
                            <option>Matriz - Belém</option>
                            <option>Fábrica / CD - Ananindeua</option>
                            <option>Filial Castanhal</option>
                            <option>Filial Ananindeua</option>
                            <option>Fortaleza (CE)</option>
                            <option>Home Office</option>
                        </select>
                    </div>
                  </>
              ) : (
                  // --- FORMULÁRIO DE SETOR ---
                  <>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Nome do Setor</label>
                        <input required value={formData.sectorName} onChange={e => setFormData({...formData, sectorName: e.target.value})} className="w-full p-3 border rounded-xl font-bold outline-none focus:border-black" placeholder="Ex: Financeiro, TI..." />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Gestor Responsável</label>
                        <select value={formData.manager} onChange={e => setFormData({...formData, manager: e.target.value})} className="w-full p-3 border rounded-xl bg-white outline-none focus:border-black cursor-pointer">
                            <option value="">Selecione um colaborador...</option>
                            {/* Puxa os funcionários da outra aba */}
                            {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Descrição</label>
                        <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full p-3 border rounded-xl outline-none focus:border-black" rows="3" placeholder="Função deste departamento..."></textarea>
                    </div>
                  </>
              )}

              <div className="flex gap-3 pt-4 border-t border-gray-50 mt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-white border border-gray-200 rounded-xl font-bold text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit" className="flex-1 py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-800 shadow-lg flex justify-center items-center gap-2">
                    <Save size={18}/> Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeManager;
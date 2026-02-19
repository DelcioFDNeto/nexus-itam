import React, { useState, useEffect } from 'react';
import { getEmployees, createEmployee, updateEmployee, deleteEmployee } from '../services/employeeService';
import { Users, Search, Plus, Edit, Trash2, MapPin, Briefcase, Save, X } from 'lucide-react';

const Employees = () => {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Estado do Formulário
  const [isEditing, setIsEditing] = useState(false);
  const [currentId, setCurrentId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    cpf: '',
    sector: '',
    branch: 'Matriz', // Valor padrão
    role: '' // Cargo
  });

  const loadEmployees = async () => {
    setLoading(true);
    try {
      const data = await getEmployees();
      setEmployees(data);
    } catch (error) {
      console.error("Erro ao buscar funcionários:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
  }, []);

  // Máscara de CPF simples
  const handleCpfChange = (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 11) value = value.slice(0, 11);
    value = value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    setFormData({ ...formData, cpf: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (isEditing) {
        await updateEmployee(currentId, formData);
        alert("Funcionário atualizado!");
      } else {
        await createEmployee(formData);
        alert("Funcionário cadastrado!");
      }
      resetForm();
      loadEmployees();
    } catch (error) {
      console.error(error);
      alert("Erro ao salvar.");
    }
  };

  const handleEdit = (employee) => {
    setFormData({
      name: employee.name,
      cpf: employee.cpf || '',
      sector: employee.sector || '',
      branch: employee.branch || 'Matriz',
      role: employee.role || ''
    });
    setCurrentId(employee.id);
    setIsEditing(true);
    // Rola para o topo para ver o formulário
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (confirm("Tem certeza que deseja excluir este funcionário?")) {
      await deleteEmployee(id);
      loadEmployees();
    }
  };

  const resetForm = () => {
    setFormData({ name: '', cpf: '', sector: '', branch: 'Matriz', role: '' });
    setIsEditing(false);
    setCurrentId(null);
  };

  const filteredEmployees = employees.filter(emp => 
    emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.sector?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-8 max-w-6xl mx-auto flex flex-col lg:flex-row gap-8">
      
      {/* --- FORMULÁRIO (Lado Esquerdo ou Topo) --- */}
      <div className="lg:w-1/3">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 sticky top-4">
          <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            {isEditing ? <Edit size={20} className="text-blue-600"/> : <Plus size={20} className="text-green-600"/>}
            {isEditing ? "Editar Funcionário" : "Novo Colaborador"}
          </h2>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nome Completo</label>
              <input 
                type="text" required
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                className="w-full p-2 border rounded focus:ring-2 focus:ring-black outline-none uppercase"
                placeholder="Ex: JOÃO SILVA"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">CPF</label>
              <input 
                type="text"
                value={formData.cpf}
                onChange={handleCpfChange}
                className="w-full p-2 border rounded focus:ring-2 focus:ring-black outline-none"
                placeholder="000.000.000-00"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Setor</label>
                    <input 
                        type="text"
                        value={formData.sector}
                        onChange={(e) => setFormData({...formData, sector: e.target.value})}
                        className="w-full p-2 border rounded focus:ring-2 focus:ring-black outline-none uppercase"
                        placeholder="TI"
                    />
                </div>
                <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cargo</label>
                    <input 
                        type="text"
                        value={formData.role}
                        onChange={(e) => setFormData({...formData, role: e.target.value})}
                        className="w-full p-2 border rounded focus:ring-2 focus:ring-black outline-none uppercase"
                        placeholder="Analista"
                    />
                </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Filial / Local</label>
              <select 
                value={formData.branch}
                onChange={(e) => setFormData({...formData, branch: e.target.value})}
                className="w-full p-2 border rounded focus:ring-2 focus:ring-black outline-none"
              >
                <option value="Matriz">Matriz (Belém)</option>
                <option value="Castanhal">Filial Castanhal</option>
                <option value="Ananindeua">Filial Ananindeua</option>
                <option value="Fábrica">Fábrica (Benfica)</option>
              </select>
            </div>

            <div className="flex gap-2 pt-2">
                <button type="submit" className="flex-1 bg-black text-white py-2 rounded font-bold hover:bg-gray-800 flex justify-center items-center gap-2">
                    <Save size={18} /> {isEditing ? "Atualizar" : "Cadastrar"}
                </button>
                {isEditing && (
                    <button type="button" onClick={resetForm} className="px-4 bg-gray-200 text-gray-700 rounded font-bold hover:bg-gray-300">
                        <X size={18} />
                    </button>
                )}
            </div>
          </form>
        </div>
      </div>

      {/* --- LISTA (Lado Direito ou Baixo) --- */}
      <div className="lg:w-2/3">
        <div className="flex justify-between items-center mb-4">
             <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Users /> Equipe BySabel
             </h1>
             <div className="relative">
                <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
                <input 
                    type="text" 
                    placeholder="Buscar nome..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 pr-4 py-2 border rounded-full text-sm w-64 focus:outline-none focus:ring-2 focus:ring-black"
                />
             </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {loading ? (
                <div className="p-8 text-center text-gray-500">Carregando equipe...</div>
            ) : filteredEmployees.length === 0 ? (
                <div className="p-8 text-center text-gray-500">Nenhum funcionário encontrado.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 text-gray-500 uppercase font-bold border-b border-gray-200">
                            <tr>
                                <th className="p-4">Nome / Cargo</th>
                                <th className="p-4">Setor</th>
                                <th className="p-4">Local</th>
                                <th className="p-4 text-center">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredEmployees.map(emp => (
                                <tr key={emp.id} className="hover:bg-gray-50">
                                    <td className="p-4">
                                        <p className="font-bold text-gray-900">{emp.name}</p>
                                        <p className="text-xs text-gray-500 flex items-center gap-1">
                                            {emp.role || "Cargo não inf."} • {emp.cpf || "CPF n/a"}
                                        </p>
                                    </td>
                                    <td className="p-4">
                                        <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-bold uppercase">
                                            {emp.sector || "---"}
                                        </span>
                                    </td>
                                    <td className="p-4 text-gray-600 flex items-center gap-1">
                                        <MapPin size={14} /> {emp.branch}
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="flex justify-center gap-2">
                                            <button onClick={() => handleEdit(emp)} className="p-2 text-blue-600 hover:bg-blue-50 rounded">
                                                <Edit size={16} />
                                            </button>
                                            <button onClick={() => handleDelete(emp.id)} className="p-2 text-red-600 hover:bg-red-50 rounded">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
        <p className="text-xs text-gray-400 mt-2 text-right">Total: {filteredEmployees.length} colaboradores</p>
      </div>

    </div>
  );
};

export default Employees;
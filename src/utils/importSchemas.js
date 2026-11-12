// src/utils/importSchemas.js
import { serverTimestamp } from 'firebase/firestore';
import { Server, Users, FolderGit2, Layers } from 'lucide-react';

export const normalizeStatus = (status, fallback = 'Planejamento') => {
  if (!status) return fallback;
  const s = String(status).toLowerCase();
  
  if (s.includes('desenvolvimento') || s.includes('andamento') || s.includes('development') || s.includes('progress')) return 'Em Andamento';
  if (s.includes('concluído') || s.includes('concluido') || s.includes('completed') || s.includes('done') || s.includes('stable')) return 'Concluído';
  if (s.includes('pausado') || s.includes('bloqueado') || s.includes('blocked')) return 'Pausado';
  if (s.includes('a fazer') || s.includes('todo') || s.includes('waiting')) return 'A Fazer';
  if (s.includes('revisão') || s.includes('revisao') || s.includes('review')) return 'Revisão';

  return fallback; 
};

export const normalizePriority = (p) => {
  if (!p) return 'Média';
  const s = String(p).toLowerCase();
  if (s.includes('crítica') || s.includes('critica') || s.includes('critical')) return 'Crítica';
  if (s.includes('alta') || s.includes('high')) return 'Alta';
  if (s.includes('baixa') || s.includes('low')) return 'Baixa';
  return 'Média';
};

export const normalizeCategory = (cat) => {
  if (!cat) return 'Geral';
  const s = String(cat).toLowerCase();
  if (s.includes('manutenção') || s.includes('manutencao') || s.includes('maintenance')) return 'Manutenção';
  if (s.includes('inventário') || s.includes('inventario') || s.includes('inventory')) return 'Inventário';
  if (s.includes('auditoria') || s.includes('audit')) return 'Auditoria';
  if (s.includes('infra') || s.includes('rede')) return 'Infraestrutura';
  return 'Geral';
};

export const isSystemFormat = (row, type) => {
  if (!row || typeof row !== 'object') return false;
  if (type === 'assets') return 'internalId' in row || 'model' in row;
  if (type === 'employees') return 'name' in row || 'role' in row || 'sector' in row;
  if (type === 'projects') return 'name' in row && ('status' in row || 'priority' in row || 'leader' in row);
  if (type === 'tasks') return 'title' in row;
  return false;
};

export const transformSystemRow = (row, type, tenantId) => {
  if (type === 'assets') {
    return {
      ...row,
      internalId: String(row.internalId || row.tag || '').trim(),
      model: row.model || '',
      type: row.type || 'Outros',
      status: row.status || 'Disponível',
      location: row.location || 'Matriz',
      serialNumber: row.serialNumber || '',
      assignedTo: row.assignedTo || '',
      tenantId
    };
  }
  if (type === 'employees') {
    return {
      ...row,
      name: row.name || '',
      email: String(row.email || '').trim().toLowerCase(),
      role: row.role || 'Analista',
      sector: row.sector || row.department || 'Geral',
      branch: row.branch || row.location || 'Matriz',
      status: row.status || 'Ativo',
      tenantId
    };
  }
  if (type === 'projects') {
    return {
      ...row,
      name: row.name || '',
      description: row.description || '',
      status: normalizeStatus(row.status),
      priority: normalizePriority(row.priority),
      leader: row.leader || '',
      version: row.version || '3.0',
      progress: typeof row.progress === 'number' ? row.progress : 0,
      tenantId
    };
  }
  if (type === 'tasks') {
    return {
      ...row,
      title: row.title || '',
      description: row.description || '',
      status: normalizeStatus(row.status, 'A Fazer'),
      priority: normalizePriority(row.priority),
      category: normalizeCategory(row.category),
      projectId: row.projectId || '',
      tenantId
    };
  }
  return { ...row, tenantId };
};

const parseSafeDate = (val) => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

// Dicionário de regras definindo a estrutura esperada e as colunas vitais para cada tipo de importação
export const IMPORT_SCHEMAS = {
  assets: {
    label: 'Ativos (Hardware)',
    icon: Server,
    badgeColor: 'border-blue-500/40 text-blue-400 bg-blue-500/10',
    description: 'Importe notebooks, desktops, servidores e outros equipamentos de TI para o inventário patrimonial.',
    collection: 'assets',
    requiredCols: ['Patrimonio', 'Modelo', 'Tipo', 'Status'],
    colAliases: {
      Patrimonio: ['patrimonio', 'tag', 'internalid', 'id', 'tombamento'],
      Modelo: ['modelo', 'model'],
      Tipo: ['tipo', 'type'],
      Status: ['status'],
    },
    optionalCols: ['Local', 'Serial', 'Usuario'],
    sampleData: [
      { Patrimonio: 'NTB-001', Modelo: 'Dell Latitude 3420', Tipo: 'Notebook', Status: 'Disponível', Local: 'Matriz - SP', Serial: 'BRG1234567', Usuario: 'carlos.silva@shineray.com.br' },
      { Patrimonio: 'DSK-002', Modelo: 'Lenovo ThinkCentre M70q', Tipo: 'Desktop', Status: 'Em Uso', Local: 'Filial - RJ', Serial: 'LNV9876543', Usuario: 'ana.souza@shineray.com.br' }
    ],
    validateRow: (row) => {
      const errors = [];
      const warnings = [];
      if (!row || typeof row !== 'object') return { errors: ['Linha vazia ou ilegível.'], warnings: [] };

      const id = String(row['Patrimonio'] || row['Tag'] || row['internalId'] || row['id'] || '').trim();
      const model = String(row['Modelo'] || row['model'] || '').trim();
      const type = String(row['Tipo'] || row['type'] || '').trim();
      const status = String(row['Status'] || row['status'] || '').trim();
      const serial = String(row['Serial'] || row['serialNumber'] || '').trim();
      const location = String(row['Local'] || row['location'] || '').trim();

      if (!id) errors.push('Patrimônio/Tag obrigatório ausente.');
      if (!model) errors.push('Modelo do equipamento obrigatório ausente.');
      if (!type) warnings.push('Tipo não informado (padrão: Outros).');
      if (!status) warnings.push('Status não informado (padrão: Disponível).');
      if (!serial) warnings.push('Número de série (Serial) não informado.');
      if (!location) warnings.push('Localização não informada (padrão: Matriz).');

      return { errors, warnings };
    },
    transform: (row) => ({
      internalId: String(row['Patrimonio'] || row['Tag'] || row['internalId'] || row['id'] || '').trim(),
      model: String(row['Modelo'] || row['model'] || '').trim(),
      type: String(row['Tipo'] || row['type'] || 'Outros').trim(),
      status: String(row['Status'] || row['status'] || 'Disponível').trim(),
      location: String(row['Local'] || row['location'] || 'Matriz').trim(),
      serialNumber: String(row['Serial'] || row['serialNumber'] || '').trim(),
      assignedTo: String(row['Usuario'] || row['assignedTo'] || '').trim(),
      createdAt: serverTimestamp()
    })
  },
  employees: {
    label: 'Colaboradores',
    icon: Users,
    badgeColor: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10',
    description: 'Cadastre funcionários e colaboradores para vinculação direta de termos e custódia de equipamentos.',
    collection: 'employees',
    requiredCols: ['Nome', 'Email', 'Cargo'],
    colAliases: {
      Nome: ['nome', 'name', 'colaborador'],
      Email: ['email', 'e-mail'],
      Cargo: ['cargo', 'role', 'funcao'],
    },
    optionalCols: ['Setor', 'Departamento', 'Filial', 'Local'],
    sampleData: [
      { Nome: 'Carlos Silva', Email: 'carlos.silva@shineray.com.br', Cargo: 'Analista de Infraestrutura', Setor: 'Tecnologia da Informação', Filial: 'Matriz - SP' },
      { Nome: 'Ana Souza', Email: 'ana.souza@shineray.com.br', Cargo: 'Coordenadora de Projetos', Setor: 'Operações', Filial: 'Filial - RJ' }
    ],
    validateRow: (row) => {
      const errors = [];
      const warnings = [];
      if (!row || typeof row !== 'object') return { errors: ['Linha vazia ou ilegível.'], warnings: [] };

      const name = String(row['Nome'] || row['name'] || '').trim();
      const email = String(row['Email'] || row['email'] || '').trim();
      const role = String(row['Cargo'] || row['role'] || '').trim();
      const sector = String(row['Setor'] || row['Departamento'] || row['sector'] || '').trim();

      if (!name) errors.push('Nome do colaborador obrigatório ausente.');
      if (!email) {
        errors.push('E-mail obrigatório ausente.');
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push(`Formato de e-mail inválido: "${email}".`);
      }
      if (!role) errors.push('Cargo/função obrigatório ausente.');
      if (!sector) warnings.push('Setor não informado (padrão: Geral).');

      return { errors, warnings };
    },
    transform: (row) => ({
      name: String(row['Nome'] || row['name'] || '').trim(),
      email: String(row['Email'] || row['email'] || '').trim().toLowerCase(),
      role: String(row['Cargo'] || row['role'] || 'Analista').trim(),
      sector: String(row['Setor'] || row['Departamento'] || row['sector'] || 'Geral').trim(),
      branch: String(row['Filial'] || row['Local'] || row['branch'] || 'Matriz').trim(),
      status: String(row['Status'] || row['status'] || 'Ativo').trim(),
      createdAt: serverTimestamp()
    })
  },
  projects: {
    label: 'Projetos',
    icon: FolderGit2,
    badgeColor: 'border-purple-500/40 text-purple-400 bg-purple-500/10',
    description: 'Importe projetos estratégicos de TI, migrações de infraestrutura ou fluxos do Jira.',
    collection: 'projects',
    requiredCols: ['Nome', 'Status'],
    colAliases: {
      Nome: ['nome', 'name', 'projeto'],
      Status: ['status'],
    },
    optionalCols: ['Descricao', 'Prioridade', 'Lider', 'DataInicio'],
    sampleData: [
      { Nome: 'Migração ERP SAP S/4HANA', Descricao: 'Migração dos servidores locais para nuvem privada', Status: 'Em Andamento', Prioridade: 'Alta', Lider: 'carlos.silva@shineray.com.br', DataInicio: '2026-01-15' },
      { Nome: 'Expansão NexusDesk PWA Mobile', Descricao: 'Acesso remoto seguro a 30+ FPS para a equipe técnica', Status: 'Planejamento', Prioridade: 'Crítica', Lider: 'gestor@shineray.com.br', DataInicio: '2026-02-01' }
    ],
    validateRow: (row) => {
      const errors = [];
      const warnings = [];
      if (!row || typeof row !== 'object') return { errors: ['Linha vazia ou ilegível.'], warnings: [] };

      const name = String(row['Nome'] || row['name'] || '').trim();
      const status = String(row['Status'] || row['status'] || '').trim();
      const leader = String(row['Lider'] || row['leader'] || '').trim();

      if (!name) errors.push('Nome do projeto obrigatório ausente.');
      if (!status) warnings.push('Status não informado (padrão: Planejamento).');
      if (!leader) warnings.push('Líder do projeto não definido.');

      return { errors, warnings };
    },
    transform: (row) => ({
      name: String(row['Nome'] || row['name'] || '').trim(),
      description: String(row['Descricao'] || row['description'] || '').trim(),
      status: normalizeStatus(row['Status'] || row['status']),
      priority: normalizePriority(row['Prioridade'] || row['priority']),
      leader: String(row['Lider'] || row['leader'] || '').trim(),
      version: '3.0',
      progress: typeof row.progress === 'number' ? row.progress : 0,
      createdAt: parseSafeDate(row['DataInicio']) || serverTimestamp()
    })
  },
  tasks: {
    label: 'Tarefas',
    icon: Layers,
    badgeColor: 'border-amber-500/40 text-amber-400 bg-amber-500/10',
    description: 'Carga em massa de chamados, auditorias técnicas e tarefas operacionais de Service Desk.',
    collection: 'tasks',
    requiredCols: ['Titulo', 'Status'],
    colAliases: {
      Titulo: ['titulo', 'title', 'tarefa'],
      Status: ['status'],
    },
    optionalCols: ['Descricao', 'Prioridade', 'Categoria'],
    sampleData: [
      { Titulo: 'Atualizar switches de borda da Filial RJ', Descricao: 'Upgrade de firmware e validação de VLANs', Status: 'A Fazer', Prioridade: 'Alta', Categoria: 'Infraestrutura' },
      { Titulo: 'Auditoria de inventário da Diretoria', Descricao: 'Coleta física e conferência de números de série', Status: 'Em Andamento', Prioridade: 'Crítica', Categoria: 'Inventário' }
    ],
    validateRow: (row) => {
      const errors = [];
      const warnings = [];
      if (!row || typeof row !== 'object') return { errors: ['Linha vazia ou ilegível.'], warnings: [] };

      const title = String(row['Titulo'] || row['title'] || '').trim();
      const status = String(row['Status'] || row['status'] || '').trim();

      if (!title) errors.push('Título da tarefa obrigatório ausente.');
      if (!status) warnings.push('Status não informado (padrão: A Fazer).');

      return { errors, warnings };
    },
    transform: (row) => ({
      title: String(row['Titulo'] || row['title'] || '').trim(),
      description: String(row['Descricao'] || row['description'] || '').trim(),
      status: normalizeStatus(row['Status'] || row['status'], 'A Fazer'),
      priority: normalizePriority(row['Prioridade'] || row['priority']),
      category: normalizeCategory(row['Categoria'] || row['category']),
      projectId: String(row.projectId || '').trim(),
      createdAt: serverTimestamp()
    })
  }
};

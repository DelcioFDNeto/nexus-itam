import { describe, it, expect } from 'vitest';
import {
  TASK_COLUMNS,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_CATEGORIES,
  DONE_STATUS,
  EMPTY_FILTERS,
  isDone,
  columnOf,
  offFlowStatus,
  priorityWeight,
  dueState,
  dueLabel,
  checklistOf,
  checklistProgress,
  createChecklistItem,
  initialsOf,
  hasActiveFilters,
  filterTasks,
  sortTasks,
  summarizeTasks,
  statusPatch,
  sanitizeTaskDraft,
} from './tasks';

describe('Constantes do módulo de tarefas', () => {
  it('exporta as colunas, status, prioridades e categorias esperadas', () => {
    expect(TASK_COLUMNS).toHaveLength(4);
    expect(TASK_STATUSES).toEqual(['A Fazer', 'Em Andamento', 'Revisão', 'Concluído']);
    expect(TASK_PRIORITIES).toEqual(['Crítica', 'Alta', 'Média', 'Baixa']);
    expect(TASK_CATEGORIES).toContain('Geral');
    expect(TASK_CATEGORIES).toContain('Suporte');
    expect(TASK_CATEGORIES).toContain('Manutenção');
    expect(TASK_CATEGORIES).toContain('Inventário');
    expect(TASK_CATEGORIES).toContain('Auditoria');
    expect(TASK_CATEGORIES).toContain('Infraestrutura');
    expect(DONE_STATUS).toBe('Concluído');
    expect(EMPTY_FILTERS).toEqual({
      search: '',
      priority: '',
      assignee: '',
      projectId: '',
      onlyOverdue: false,
    });
  });
});

describe('isDone', () => {
  it('retorna true apenas quando status for Concluído', () => {
    expect(isDone({ status: 'Concluído' })).toBe(true);
    expect(isDone({ status: 'A Fazer' })).toBe(false);
    expect(isDone({ status: 'Em Andamento' })).toBe(false);
    expect(isDone({ status: 'Revisão' })).toBe(false);
    expect(isDone({ status: 'Pausado' })).toBe(false);
  });

  it('lida com entradas nulas ou indefinidas com segurança', () => {
    expect(isDone(null)).toBe(false);
    expect(isDone(undefined)).toBe(false);
    expect(isDone({})).toBe(false);
  });
});

describe('columnOf e offFlowStatus', () => {
  it('columnOf mapeia status conhecidos para a própria coluna', () => {
    expect(columnOf('A Fazer')).toBe('A Fazer');
    expect(columnOf('Em Andamento')).toBe('Em Andamento');
    expect(columnOf('Revisão')).toBe('Revisão');
    expect(columnOf('Concluído')).toBe('Concluído');
  });

  it('columnOf direciona status fora do fluxo para "A Fazer"', () => {
    expect(columnOf('Planejamento')).toBe('A Fazer');
    expect(columnOf('Pausado')).toBe('A Fazer');
    expect(columnOf('Desconhecido')).toBe('A Fazer');
    expect(columnOf(null)).toBe('A Fazer');
    expect(columnOf(undefined)).toBe('A Fazer');
  });

  it('offFlowStatus retorna o status apenas quando estiver fora do fluxo e não for Planejamento', () => {
    // Status normais de fluxo
    expect(offFlowStatus('A Fazer')).toBeNull();
    expect(offFlowStatus('Em Andamento')).toBeNull();
    expect(offFlowStatus('Revisão')).toBeNull();
    expect(offFlowStatus('Concluído')).toBeNull();

    // Planejamento é tratado sem etiqueta
    expect(offFlowStatus('Planejamento')).toBeNull();

    // Status fora do fluxo retornam a etiqueta
    expect(offFlowStatus('Pausado')).toBe('Pausado');
    expect(offFlowStatus('Cancelado')).toBe('Cancelado');
    expect(offFlowStatus('Bloqueado')).toBe('Bloqueado');

    // Nulos e vazios
    expect(offFlowStatus(null)).toBeNull();
    expect(offFlowStatus(undefined)).toBeNull();
    expect(offFlowStatus('')).toBeNull();
  });
});

describe('priorityWeight', () => {
  it('atribui pesos corretos por prioridade', () => {
    expect(priorityWeight('Crítica')).toBe(0);
    expect(priorityWeight('Alta')).toBe(1);
    expect(priorityWeight('Média')).toBe(2);
    expect(priorityWeight('Baixa')).toBe(3);
  });

  it('usa Média (2) como fallback para prioridades desconhecidas ou inválidas', () => {
    expect(priorityWeight('Urgente')).toBe(2);
    expect(priorityWeight('')).toBe(2);
    expect(priorityWeight(null)).toBe(2);
    expect(priorityWeight(undefined)).toBe(2);
  });
});

describe('dueState e dueLabel', () => {
  // Data base de referência: 15 de Outubro de 2026, 14:30:00 local
  const baseNow = new Date(2026, 9, 15, 14, 30, 0);

  describe('dueState', () => {
    it('retorna "none" quando dueDate não existir ou for inválido', () => {
      expect(dueState(null, baseNow)).toBe('none');
      expect(dueState({}, baseNow)).toBe('none');
      expect(dueState({ dueDate: '' }, baseNow)).toBe('none');
      expect(dueState({ dueDate: 'data-invalida' }, baseNow)).toBe('none');
    });

    it('retorna "none" quando a tarefa estiver concluída, mesmo com prazo vencido', () => {
      const task = { status: 'Concluído', dueDate: '2026-10-10' };
      expect(dueState(task, baseNow)).toBe('none');
    });

    it('retorna "overdue" quando o prazo estiver no passado', () => {
      const task = { status: 'A Fazer', dueDate: '2026-10-14' };
      expect(dueState(task, baseNow)).toBe('overdue');
    });

    it('retorna "today" quando o prazo for no mesmo dia', () => {
      const task = { status: 'A Fazer', dueDate: '2026-10-15' };
      expect(dueState(task, baseNow)).toBe('today');
    });

    it('retorna "soon" quando o prazo for em 1 ou 2 dias', () => {
      const taskAmanha = { status: 'Em Andamento', dueDate: '2026-10-16' };
      const taskDepois = { status: 'Em Andamento', dueDate: '2026-10-17' };
      expect(dueState(taskAmanha, baseNow)).toBe('soon');
      expect(dueState(taskDepois, baseNow)).toBe('soon');
    });

    it('retorna "later" quando o prazo for a mais de 2 dias no futuro', () => {
      const task = { status: 'A Fazer', dueDate: '2026-10-20' };
      expect(dueState(task, baseNow)).toBe('later');
    });

    it('funciona com o parâmetro now padrão (data atual)', () => {
      const taskNoDue = { status: 'A Fazer' };
      expect(dueState(taskNoDue)).toBe('none');

      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const year = futureDate.getFullYear();
      const month = String(futureDate.getMonth() + 1).padStart(2, '0');
      const day = String(futureDate.getDate()).padStart(2, '0');
      const taskFuture = { status: 'A Fazer', dueDate: `${year}-${month}-${day}` };
      expect(dueState(taskFuture)).toBe('later');
    });
  });

  describe('dueLabel', () => {
    it('retorna string vazia quando dueDate for inválido ou ausente', () => {
      expect(dueLabel(null, baseNow)).toBe('');
      expect(dueLabel({}, baseNow)).toBe('');
      expect(dueLabel({ dueDate: '' }, baseNow)).toBe('');
      expect(dueLabel({ dueDate: 'invalido' }, baseNow)).toBe('');
    });

    it('para tarefas em aberto, exibe "Atrasada Xd", "Hoje", "Amanhã" ou data formatada', () => {
      expect(dueLabel({ status: 'A Fazer', dueDate: '2026-10-12' }, baseNow)).toBe('Atrasada 3d');
      expect(dueLabel({ status: 'A Fazer', dueDate: '2026-10-14' }, baseNow)).toBe('Atrasada 1d');
      expect(dueLabel({ status: 'Em Andamento', dueDate: '2026-10-15' }, baseNow)).toBe('Hoje');
      expect(dueLabel({ status: 'Revisão', dueDate: '2026-10-16' }, baseNow)).toBe('Amanhã');
      expect(dueLabel({ status: 'A Fazer', dueDate: '2026-10-25' }, baseNow)).toBe('25/10');
    });

    it('para tarefas concluídas, exibe a data formatada mesmo se estiver no passado ou hoje', () => {
      expect(dueLabel({ status: 'Concluído', dueDate: '2026-10-10' }, baseNow)).toBe('10/10');
      expect(dueLabel({ status: 'Concluído', dueDate: '2026-10-15' }, baseNow)).toBe('15/10');
      expect(dueLabel({ status: 'Concluído', dueDate: '2026-10-16' }, baseNow)).toBe('16/10');
    });

    it('funciona com o parâmetro now padrão (data atual)', () => {
      expect(dueLabel({ status: 'A Fazer' })).toBe('');
      const todayDate = new Date();
      const year = todayDate.getFullYear();
      const month = String(todayDate.getMonth() + 1).padStart(2, '0');
      const day = String(todayDate.getDate()).padStart(2, '0');
      const taskToday = { status: 'A Fazer', dueDate: `${year}-${month}-${day}` };
      expect(dueLabel(taskToday)).toBe('Hoje');
    });
  });
});

describe('checklistOf e checklistProgress', () => {
  it('checklistOf devolve o array ou array vazio quando ausente/inválido', () => {
    const list = [{ id: '1', text: 'Item 1', done: false }];
    expect(checklistOf({ checklist: list })).toEqual(list);
    expect(checklistOf({})).toEqual([]);
    expect(checklistOf({ checklist: null })).toEqual([]);
    expect(checklistOf({ checklist: 'não é array' })).toEqual([]);
    expect(checklistOf(null)).toEqual([]);
  });

  it('checklistProgress calcula { done, total } com exatidão', () => {
    expect(checklistProgress(null)).toEqual({ done: 0, total: 0 });
    expect(checklistProgress({})).toEqual({ done: 0, total: 0 });

    const task = {
      checklist: [
        { id: '1', text: 'Passo 1', done: true },
        { id: '2', text: 'Passo 2', done: false },
        { id: '3', text: 'Passo 3', done: true },
      ],
    };
    expect(checklistProgress(task)).toEqual({ done: 2, total: 3 });

    const allDone = {
      checklist: [
        { id: '1', text: 'P1', done: true },
        { id: '2', text: 'P2', done: true },
      ],
    };
    expect(checklistProgress(allDone)).toEqual({ done: 2, total: 2 });
  });
});

describe('createChecklistItem', () => {
  it('gera item de checklist com id prefixado por chk-, texto sanitizado e done false', () => {
    const item = createChecklistItem('  Verificar servidores  ');
    expect(item.id).toMatch(/^chk-[a-z0-9]+-[a-z0-9]+$/);
    expect(item.text).toBe('Verificar servidores');
    expect(item.done).toBe(false);
  });

  it('lida com texto vazio ou nulo com segurança', () => {
    const itemEmpty = createChecklistItem('');
    expect(itemEmpty.text).toBe('');
    expect(itemEmpty.done).toBe(false);

    const itemNull = createChecklistItem(null);
    expect(itemNull.text).toBe('');
  });

  it('gera identificadores únicos a cada chamada', () => {
    const item1 = createChecklistItem('Item 1');
    const item2 = createChecklistItem('Item 2');
    expect(item1.id).not.toBe(item2.id);
  });
});

describe('initialsOf', () => {
  it('gera iniciais para nome único ou vazio', () => {
    expect(initialsOf('')).toBe('');
    expect(initialsOf(null)).toBe('');
    expect(initialsOf(undefined)).toBe('');
    expect(initialsOf('   ')).toBe('');
    expect(initialsOf('A')).toBe('A');
    expect(initialsOf('Ana')).toBe('AN');
    expect(initialsOf('carlos')).toBe('CA');
  });

  it('combina a inicial da primeira e da última palavra', () => {
    expect(initialsOf('Carlos Silva')).toBe('CS');
    expect(initialsOf('Maria Silva Sauro')).toBe('MS');
    expect(initialsOf('  João   Pedro  Ferreira  ')).toBe('JF');
    expect(initialsOf('luiz inacio da silva')).toBe('LS');
  });
});

describe('hasActiveFilters', () => {
  it('retorna false para filtros padrão ou vazios', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(
      hasActiveFilters({
        search: '   ',
        priority: '',
        assignee: '',
        projectId: '',
        onlyOverdue: false,
      }),
    ).toBe(false);
  });

  it('retorna true quando houver qualquer critério de filtro preenchido', () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: 'teste' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, priority: 'Alta' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, assignee: 'Carlos' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, assignee: '__none__' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, projectId: 'proj-1' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, onlyOverdue: true })).toBe(true);
  });
});

describe('filterTasks', () => {
  const baseNow = new Date(2026, 9, 15, 12, 0, 0);

  const sampleTasks = [
    {
      id: 't1',
      title: 'Configurar Servidor Web',
      description: 'Instalação do Nginx e certificados SSL',
      priority: 'Crítica',
      category: 'Infraestrutura',
      assignee: 'João Silva',
      projectId: 'proj-infra',
      dueDate: '2026-10-10', // overdue
      status: 'A Fazer',
    },
    {
      id: 't2',
      title: 'Manutenção Elétrica do Rack',
      description: 'Troca de baterias no nobreak',
      priority: 'Alta',
      category: 'Manutenção',
      assignee: 'Maria Souza',
      projectId: 'proj-infra',
      dueDate: '2026-10-20', // later
      status: 'Em Andamento',
    },
    {
      id: 't3',
      title: 'Inventário de Laptops',
      description: 'Auditoria dos equipamentos Dell',
      priority: 'Média',
      category: 'Inventário',
      assignee: '',
      projectId: 'proj-ti',
      dueDate: '2026-10-14', // overdue
      status: 'A Fazer',
    },
    {
      id: 't4',
      title: 'Backup concluído',
      description: 'Rotina de snapshot finalizada',
      priority: 'Baixa',
      category: 'Suporte',
      assignee: 'João Silva',
      projectId: 'proj-ti',
      dueDate: '2026-10-12',
      status: 'Concluído', // done -> dueState 'none'
    },
  ];

  it('retorna todas as tarefas com filtros vazios padrão ou omitidos', () => {
    const resultDefault = filterTasks(sampleTasks);
    expect(resultDefault).toHaveLength(4);

    const resultExplicit = filterTasks(sampleTasks, EMPTY_FILTERS, baseNow);
    expect(resultExplicit).toHaveLength(4);
  });

  describe('busca textual sem acentos e insensível a maiúsculas/minúsculas', () => {
    it('encontra por título ignorando acentos ("eletrica" acha "Elétrica")', () => {
      const result = filterTasks(sampleTasks, { ...EMPTY_FILTERS, search: 'eletrica' }, baseNow);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t2');
    });

    it('encontra por descrição ("certificados" acha t1)', () => {
      const result = filterTasks(sampleTasks, { ...EMPTY_FILTERS, search: 'certificados' }, baseNow);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t1');
    });

    it('encontra por responsável ("joao" acha t1 e t4)', () => {
      const result = filterTasks(sampleTasks, { ...EMPTY_FILTERS, search: 'joao' }, baseNow);
      expect(result.map((t) => t.id)).toEqual(['t1', 't4']);
    });

    it('encontra por categoria ("inventario" acha t3)', () => {
      const result = filterTasks(sampleTasks, { ...EMPTY_FILTERS, search: 'inventario' }, baseNow);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('t3');
    });

    it('retorna vazio se o termo de busca não coincidir com nenhuma tarefa', () => {
      const result = filterTasks(sampleTasks, { ...EMPTY_FILTERS, search: 'inexistente' }, baseNow);
      expect(result).toHaveLength(0);
    });
  });

  describe('filtro por prioridade', () => {
    it('filtra tarefas pela prioridade exata', () => {
      const result = filterTasks(sampleTasks, { ...EMPTY_FILTERS, priority: 'Crítica' }, baseNow);
      expect(result.map((t) => t.id)).toEqual(['t1']);
    });

    it('considera tarefas sem prioridade como "Média"', () => {
      const tasksWithDefaultPriority = [
        { id: 'tx', title: 'Sem prioridade', priority: undefined },
      ];
      const resultMedia = filterTasks(
        tasksWithDefaultPriority,
        { ...EMPTY_FILTERS, priority: 'Média' },
        baseNow,
      );
      expect(resultMedia).toHaveLength(1);

      const resultAlta = filterTasks(
        tasksWithDefaultPriority,
        { ...EMPTY_FILTERS, priority: 'Alta' },
        baseNow,
      );
      expect(resultAlta).toHaveLength(0);
    });
  });

  describe('filtro por responsável (assignee)', () => {
    it('filtra por nome específico de responsável', () => {
      const result = filterTasks(sampleTasks, { ...EMPTY_FILTERS, assignee: 'Maria Souza' }, baseNow);
      expect(result.map((t) => t.id)).toEqual(['t2']);
    });

    it('filtra tarefas sem responsável quando assignee for "__none__"', () => {
      const result = filterTasks(sampleTasks, { ...EMPTY_FILTERS, assignee: '__none__' }, baseNow);
      expect(result.map((t) => t.id)).toEqual(['t3']);
    });
  });

  describe('filtro por projectId', () => {
    it('filtra tarefas associadas ao projeto', () => {
      const result = filterTasks(sampleTasks, { ...EMPTY_FILTERS, projectId: 'proj-infra' }, baseNow);
      expect(result.map((t) => t.id)).toEqual(['t1', 't2']);
    });
  });

  describe('filtro onlyOverdue', () => {
    it('filtra apenas tarefas abertas e atrasadas', () => {
      const result = filterTasks(sampleTasks, { ...EMPTY_FILTERS, onlyOverdue: true }, baseNow);
      expect(result.map((t) => t.id)).toEqual(['t1', 't3']);
    });
  });

  describe('combinação de múltiplos filtros', () => {
    it('combina search, projectId e onlyOverdue simultaneamente', () => {
      const result = filterTasks(
        sampleTasks,
        {
          ...EMPTY_FILTERS,
          projectId: 'proj-infra',
          onlyOverdue: true,
          search: 'servidor',
        },
        baseNow,
      );
      expect(result.map((t) => t.id)).toEqual(['t1']);
    });
  });
});

describe('sortTasks', () => {
  const taskA = {
    id: 'a',
    title: 'Tarefa A',
    priority: 'Baixa',
    dueDate: '2026-10-20',
    createdAt: '2026-10-01',
  };
  const taskB = {
    id: 'b',
    title: 'Tarefa B',
    priority: 'Crítica',
    dueDate: '2026-10-18',
    createdAt: '2026-10-05',
  };
  const taskC = {
    id: 'c',
    title: 'Tarefa C',
    priority: 'Alta',
    dueDate: '2026-10-10',
    createdAt: '2026-10-03',
  };
  const taskD = {
    id: 'd',
    title: 'Tarefa D',
    priority: 'Crítica',
    dueDate: '2026-10-12',
    createdAt: '2026-10-02',
  };

  const tasks = [taskA, taskB, taskC, taskD];

  it('não muta o array original', () => {
    const clone = [...tasks];
    sortTasks(tasks, 'recent');
    expect(tasks).toEqual(clone);
  });

  it('ordena por "recent" (criadas por último primeiro)', () => {
    const sorted = sortTasks(tasks, 'recent');
    // Datas de criação: B (10-05) > C (10-03) > D (10-02) > A (10-01)
    expect(sorted.map((t) => t.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('ordena por "due" (prazo mais próximo primeiro, desempate por criação mais recente)', () => {
    const withNoDue = { id: 'sem-prazo', dueDate: null, createdAt: '2026-10-04' };
    const sameDueRecent = { id: 'same-due-new', dueDate: '2026-10-10', createdAt: '2026-10-09' };
    const sorted = sortTasks([...tasks, withNoDue, sameDueRecent], 'due');

    // same-due-new (10-10, criado 09) antes de C (10-10, criado 03)
    // D (10-12) < B (10-18) < A (10-20) < sem-prazo (Infinity)
    expect(sorted.map((t) => t.id)).toEqual(['same-due-new', 'c', 'd', 'b', 'a', 'sem-prazo']);
  });

  it('ordena por "smart" (prioridade, depois prazo, depois mais recente)', () => {
    // Crítica: B (10-18) e D (10-12) -> D primeiro pelo prazo
    // Alta: C (10-10)
    // Baixa: A (10-20)
    const sorted = sortTasks(tasks, 'smart');
    expect(sorted.map((t) => t.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('em "smart", desempata tarefas com mesma prioridade e mesmo prazo pela data de criação', () => {
    const critical1 = { id: 'crit-old', priority: 'Crítica', dueDate: '2026-10-12', createdAt: '2026-10-01' };
    const critical2 = { id: 'crit-new', priority: 'Crítica', dueDate: '2026-10-12', createdAt: '2026-10-05' };
    const sorted = sortTasks([critical1, critical2], 'smart');
    expect(sorted.map((t) => t.id)).toEqual(['crit-new', 'crit-old']);
  });

  it('usa "smart" como ordenação padrão se não especificada', () => {
    const sorted = sortTasks(tasks);
    expect(sorted.map((t) => t.id)).toEqual(['d', 'b', 'c', 'a']);
  });
});

describe('summarizeTasks', () => {
  const baseNow = new Date(2026, 9, 15, 12, 0, 0);

  it('calcula métricas de tarefas vazias', () => {
    expect(summarizeTasks([], baseNow)).toEqual({
      open: 0,
      inProgress: 0,
      overdue: 0,
      dueToday: 0,
      done: 0,
    });
  });

  it('computa open, inProgress, overdue, dueToday e done corretamente', () => {
    const tasks = [
      // Concluídas (não contam como abertas, atrasadas nem hoje)
      { id: '1', status: 'Concluído', dueDate: '2026-10-10' },
      { id: '2', status: 'Concluído', dueDate: '2026-10-15' },

      // Abertas em andamento / revisão
      { id: '3', status: 'Em Andamento', dueDate: '2026-10-14' }, // overdue
      { id: '4', status: 'Revisão', dueDate: '2026-10-15' }, // due today
      { id: '5', status: 'Em Andamento', dueDate: '2026-10-25' }, // later

      // Abertas a fazer
      { id: '6', status: 'A Fazer', dueDate: '2026-10-12' }, // overdue
      { id: '7', status: 'A Fazer', dueDate: null }, // no due
    ];

    const summary = summarizeTasks(tasks, baseNow);
    expect(summary).toEqual({
      done: 2,
      open: 5, // tarefas 3, 4, 5, 6, 7
      inProgress: 3, // tarefas 3, 4, 5 (Em Andamento ou Revisão)
      overdue: 2, // tarefas 3 e 6
      dueToday: 1, // tarefa 4
    });
  });

  it('funciona com o parâmetro now omitido (usa data atual)', () => {
    const summary = summarizeTasks([{ id: '1', status: 'A Fazer' }]);
    expect(summary.open).toBe(1);
    expect(summary.done).toBe(0);
  });
});

describe('statusPatch', () => {
  const baseNow = new Date('2026-10-15T10:00:00.000Z');

  it('preenche completedAt com timestamp ISO quando status mudar para Concluído', () => {
    const patch = statusPatch('Concluído', baseNow);
    expect(patch).toEqual({
      status: 'Concluído',
      completedAt: '2026-10-15T10:00:00.000Z',
    });
  });

  it('anula completedAt quando status for diferente de Concluído', () => {
    expect(statusPatch('Em Andamento', baseNow)).toEqual({
      status: 'Em Andamento',
      completedAt: null,
    });
    expect(statusPatch('A Fazer', baseNow)).toEqual({
      status: 'A Fazer',
      completedAt: null,
    });
    expect(statusPatch('Revisão', baseNow)).toEqual({
      status: 'Revisão',
      completedAt: null,
    });
  });

  it('usa data atual se o parâmetro now for omitido ao concluir', () => {
    const patch = statusPatch('Concluído');
    expect(patch.status).toBe('Concluído');
    expect(typeof patch.completedAt).toBe('string');
    expect(Date.parse(patch.completedAt)).not.toBeNaN();
  });
});

describe('sanitizeTaskDraft', () => {
  it('aplica valores padrão para rascunho vazio', () => {
    const sanitized = sanitizeTaskDraft({});
    expect(sanitized).toEqual({
      title: '',
      description: '',
      status: 'A Fazer',
      priority: 'Média',
      category: 'Geral',
      dueDate: '',
      assignee: '',
      projectId: '',
      checklist: [],
    });
  });

  it('trima espaços em branco e valida campos preenchidos', () => {
    const draft = {
      title: '  Título da tarefa  ',
      description: '   Descrição detalhada   ',
      status: 'Em Andamento',
      priority: 'Crítica',
      category: 'Suporte',
      dueDate: '2026-11-01',
      assignee: '   João Paulo   ',
      projectId: 'proj-123',
      checklist: [
        { id: 'c1', text: '  Passo 1  ', done: true },
        { id: 'c2', text: '   ', done: false }, // deve ser filtrado por texto vazio
        { id: 'c3', text: 'Passo 3', done: 0 },
      ],
    };

    const sanitized = sanitizeTaskDraft(draft);
    expect(sanitized).toEqual({
      title: 'Título da tarefa',
      description: 'Descrição detalhada',
      status: 'Em Andamento',
      priority: 'Crítica',
      category: 'Suporte',
      dueDate: '2026-11-01',
      assignee: 'João Paulo',
      projectId: 'proj-123',
      checklist: [
        { id: 'c1', text: 'Passo 1', done: true },
        { id: 'c3', text: 'Passo 3', done: false },
      ],
    });
  });

  it('preserva status fora do fluxo original (ex: Pausado)', () => {
    const draft = { status: 'Pausado' };
    const sanitized = sanitizeTaskDraft(draft);
    expect(sanitized.status).toBe('Pausado');
  });

  it('reverte prioridade inválida para Média', () => {
    const draft = { priority: 'Inexistente' };
    const sanitized = sanitizeTaskDraft(draft);
    expect(sanitized.priority).toBe('Média');
  });

  it('lida com checklist ausente ou inválido', () => {
    const draft = { checklist: null };
    const sanitized = sanitizeTaskDraft(draft);
    expect(sanitized.checklist).toEqual([]);
  });
});

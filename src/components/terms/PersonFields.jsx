// src/components/terms/PersonFields.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { UserRound } from 'lucide-react';
import { getEmployees } from '../../services/employeeService';
import { useAuth } from '../../contexts/AuthContext';
import { fieldClass, labelClass } from './termStyles';

const norm = (value) => String(value ?? '').trim().toLowerCase();

/**
 * Dados de quem assina o termo. Escolher um colaborador do cadastro preenche
 * CPF, cargo, setor e unidade — antes o termo saia com o CPF em branco
 * sempre que o ativo nao tinha o campo preenchido.
 *
 * @param {object}   value     { name, cpf, role, sector, branch, employeeId }
 * @param {Function} onChange
 * @param {string}   [preferBranch] mostra primeiro quem trabalha neste local
 */
const PersonFields = ({ value, onChange, title = 'Colaborador', preferBranch, idPrefix = 'person' }) => {
  const { currentUser } = useAuth();
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    if (!currentUser?.tenantId) return;
    getEmployees(currentUser.tenantId)
      .then(setEmployees)
      .catch((error) => console.error('Falha ao carregar colaboradores:', error));
  }, [currentUser?.tenantId]);

  const ordered = useMemo(() => {
    if (!preferBranch) return employees;
    const local = employees.filter((e) => norm(e.branch) === norm(preferBranch));
    const others = employees.filter((e) => norm(e.branch) !== norm(preferBranch));
    return [...local, ...others];
  }, [employees, preferBranch]);

  const localCount = preferBranch ? employees.filter((e) => norm(e.branch) === norm(preferBranch)).length : 0;

  // Nome vindo de fora (gerente da loja, responsavel gravado no ativo) que bate
  // com um unico colaborador do cadastro: completa CPF, cargo e setor.
  useEffect(() => {
    if (value.employeeId || value.cpf || !norm(value.name)) return;
    const matches = employees.filter((e) => norm(e.name) === norm(value.name));
    if (matches.length !== 1) return;
    const [emp] = matches;
    onChange({
      ...value,
      cpf: emp.cpf || '',
      role: value.role || emp.role || '',
      sector: value.sector || emp.sector || '',
      branch: value.branch || emp.branch || '',
      employeeId: emp.id,
    });
  }, [employees, value, onChange]);

  const pick = (employeeId) => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) {
      onChange({ ...value, employeeId: '' });
      return;
    }
    onChange({
      name: emp.name || '',
      cpf: emp.cpf || '',
      role: emp.role || '',
      sector: emp.sector || '',
      branch: emp.branch || '',
      employeeId: emp.id,
    });
  };

  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value, ...(key === 'name' ? { employeeId: '' } : {}) });

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-employee`} className={labelClass}>
          {title} {preferBranch && localCount > 0 && <span className="normal-case font-bold text-brand">· {localCount} lotado(s) em {preferBranch}</span>}
        </label>
        <div className="relative">
          <UserRound size={15} className="absolute left-3 top-3 text-gray-400 pointer-events-none" />
          <select id={`${idPrefix}-employee`} value={value.employeeId || ''} onChange={(e) => pick(e.target.value)} className={`${fieldClass} pl-9`}>
            <option value="">Escolher do cadastro de colaboradores…</option>
            {ordered.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name || 'Sem nome'}{emp.role ? ` — ${emp.role}` : ''}{emp.branch ? ` (${emp.branch})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor={`${idPrefix}-name`} className={labelClass}>Nome completo *</label>
          <input id={`${idPrefix}-name`} value={value.name} onChange={set('name')} className={fieldClass} placeholder="Nome de quem assina" />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-cpf`} className={labelClass}>CPF</label>
          <input id={`${idPrefix}-cpf`} value={value.cpf} onChange={set('cpf')} className={`${fieldClass} font-mono`} placeholder="000.000.000-00" />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-role`} className={labelClass}>Cargo / função</label>
          <input id={`${idPrefix}-role`} value={value.role} onChange={set('role')} className={fieldClass} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-sector`} className={labelClass}>Setor</label>
          <input id={`${idPrefix}-sector`} value={value.sector} onChange={set('sector')} className={fieldClass} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-branch`} className={labelClass}>Unidade / local</label>
          <input id={`${idPrefix}-branch`} value={value.branch} onChange={set('branch')} className={fieldClass} />
        </div>
      </div>
    </div>
  );
};

export default PersonFields;

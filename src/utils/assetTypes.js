// src/utils/assetTypes.js
// -----------------------------------------------------------------------------
// Catalogo unico de tipos de equipamento.
//
// Antes, a lista vivia duplicada: `AssetForm` tinha o proprio array de tipos e
// `AssetIcon` tinha um `switch` com um mapeamento diferente. O resultado eram
// icones que nao batiam entre o cadastro e a listagem — e `Monitor` e `Servidor`
// caiam num icone generico de rede porque o `switch` nao tinha caso para eles.
//
// `specs` declara quais campos tecnicos a tela deve exibir para cada tipo, no
// lugar dos booleanos `isPC` / `isMobile` / `isPrinter` espalhados pelo form.
// -----------------------------------------------------------------------------
import {
  BatteryCharging,
  Box,
  Camera,
  Computer,
  CreditCard,
  HardDrive,
  Keyboard,
  Laptop,
  Monitor,
  Network,
  Printer,
  Projector,
  Router,
  Scan,
  Server,
  Smartphone,
  Tablet,
} from 'lucide-react';

/** Campos tecnicos disponiveis, por chave usada em `formData.specs`. */
export const SPEC_FIELDS = {
  processor:  { label: 'Processador',          placeholder: 'Ex: i5 1135G7' },
  ram:        { label: 'Memoria RAM',          placeholder: 'Ex: 16GB' },
  storage:    { label: 'Armazenamento',        placeholder: 'Ex: SSD 512GB' },
  ip:         { label: 'Endereco IP',          placeholder: '192.168.0.10', mono: true },
  pageCount:  { label: 'Contador de paginas',  placeholder: 'Ex: 15000', type: 'number' },
  imei1:      { label: 'IMEI 1',               placeholder: 'Ex: 3569...', mono: true, root: true },
  imei2:      { label: 'IMEI 2 (opcional)',    placeholder: '', mono: true, root: true },
  capacity:   { label: 'Potencia (VA)',        placeholder: 'Ex: 1500' },
  ports:      { label: 'Portas',               placeholder: 'Ex: 24', type: 'number' },
  resolution: { label: 'Resolucao',            placeholder: 'Ex: 1920x1080' },
  macAddress: { label: 'Endereco MAC',         placeholder: '00:1A:2B:3C:4D:5E', mono: true },
};

export const ASSET_TYPES = [
  // --- Computacao ---
  { id: 'Computador', label: 'Computador', icon: Computer,        tone: 'text-violet-500',  specs: ['processor', 'ram', 'storage', 'ip', 'macAddress'] },
  { id: 'Notebook',   label: 'Notebook',   icon: Laptop,          tone: 'text-blue-600',    specs: ['processor', 'ram', 'storage', 'ip', 'macAddress'] },
  { id: 'Servidor',   label: 'Servidor',   icon: Server,          tone: 'text-slate-600',   specs: ['processor', 'ram', 'storage', 'ip', 'macAddress'] },
  { id: 'Tablet',     label: 'Tablet',     icon: Tablet,          tone: 'text-sky-600',     specs: ['storage', 'imei1'] },
  { id: 'Monitor',    label: 'Monitor',    icon: Monitor,         tone: 'text-teal-600',    specs: ['resolution'] },

  // --- Mobilidade e campo ---
  { id: 'Celular',    label: 'Celular',    icon: Smartphone,      tone: 'text-blue-500',    specs: ['imei1', 'imei2'] },
  { id: 'PGT',        label: 'PGT',        icon: CreditCard,      tone: 'text-amber-600',   specs: ['imei1', 'imei2'] },

  // --- Impressao e digitalizacao ---
  { id: 'Impressora', label: 'Impressora', icon: Printer,         tone: 'text-orange-500',  specs: ['pageCount', 'ip', 'macAddress'] },
  { id: 'Scanner',    label: 'Scanner',    icon: Scan,            tone: 'text-orange-400',  specs: ['ip'] },

  // --- Infraestrutura ---
  { id: 'Rede',       label: 'Rede',       icon: Network,         tone: 'text-cyan-600',    specs: ['ip', 'macAddress'] },
  { id: 'Switch',     label: 'Switch / AP', icon: Router,         tone: 'text-cyan-500',    specs: ['ip', 'ports', 'macAddress'] },
  { id: 'Storage',    label: 'Storage / NAS', icon: HardDrive,    tone: 'text-indigo-500',  specs: ['ip', 'storage', 'macAddress'] },
  { id: 'Nobreak',    label: 'Nobreak',    icon: BatteryCharging, tone: 'text-emerald-600', specs: ['capacity'] },

  // --- Apoio ---
  { id: 'Projetor',   label: 'Projetor',   icon: Projector,       tone: 'text-purple-500',  specs: ['resolution'] },
  { id: 'Camera',     label: 'Camera / CFTV', icon: Camera,       tone: 'text-rose-500',    specs: ['ip', 'macAddress'] },
  { id: 'Periferico', label: 'Periferico', icon: Keyboard,        tone: 'text-slate-400',   specs: [] },

  { id: 'Outros',     label: 'Outros',     icon: Box,             tone: 'text-slate-500',   specs: [] },
];

const BY_ID = Object.fromEntries(ASSET_TYPES.map((t) => [t.id, t]));

const FALLBACK = { id: 'Outros', label: 'Outros', icon: Box, tone: 'text-slate-500', specs: [] };

/** Resolve um tipo, tolerando valores legados ou vindos do agente. */
export const getAssetType = (id) => BY_ID[id] || FALLBACK;

/** Campos tecnicos que a tela deve exibir para o tipo informado. */
export const specsForType = (id) => getAssetType(id).specs;

/** Campos de `specs` que na verdade moram na raiz do documento (IMEI). */
export const isRootSpec = (field) => Boolean(SPEC_FIELDS[field]?.root);

/**
 * Junta o catalogo base com os tipos criados pela propria empresa em
 * Configuracoes. Tipos do inquilino nao tem icone dedicado — recebem o
 * generico — mas podem declarar quais campos tecnicos exibem.
 *
 * @param {Array<{id:string,label:string,specs?:string[]}>} customTypes
 */
export const buildAssetCatalog = (customTypes = []) => {
  const extras = (Array.isArray(customTypes) ? customTypes : [])
    .filter((t) => t && typeof t.id === 'string' && t.id.trim() && !BY_ID[t.id])
    .map((t) => ({
      id: t.id.trim(),
      label: (t.label || t.id).trim(),
      icon: Box,
      tone: 'text-slate-500',
      specs: Array.isArray(t.specs) ? t.specs.filter((f) => f in SPEC_FIELDS) : [],
      custom: true,
    }));

  // 'Outros' permanece por ultimo, depois dos tipos da empresa.
  const base = ASSET_TYPES.filter((t) => t.id !== 'Outros');
  const outros = ASSET_TYPES.find((t) => t.id === 'Outros');
  return [...base, ...extras, outros];
};

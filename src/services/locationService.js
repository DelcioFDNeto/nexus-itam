// src/services/locationService.js
// -----------------------------------------------------------------------------
// Filiais e locais fisicos, escopados por inquilino.
//
// Antes esta lista estava fixa no codigo, com as filiais da Shineray, e
// duplicada em quatro arquivos (AssetForm, MoveAssetModal, EmployeeManager e
// SettingsPage). Toda empresa nova do SaaS herdava Belem, Ananindeua,
// Castanhal e Fortaleza como opcoes.
// -----------------------------------------------------------------------------
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

// Resolvido sob demanda: no escopo do modulo, o import sozinho ja exigiria
// o SDK do Firestore inicializado, quebrando qualquer teste do consumidor.
const locationsCollection = () => collection(db, 'locations');

/** Lista os locais do inquilino, ordenados por regiao e nome. */
export const getLocations = async (tenantId) => {
  if (!tenantId) return [];
  const q = query(locationsCollection(), where('tenantId', '==', tenantId), orderBy('name', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const addLocation = async ({ name, region, tenantId }) => {
  if (!tenantId) throw new Error('Nao e possivel criar um local sem inquilino.');
  if (!name?.trim()) throw new Error('O local precisa de um nome.');
  return addDoc(locationsCollection(), {
    name: name.trim(),
    region: region?.trim() || 'Geral',
    tenantId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const updateLocation = async (id, { name, region }) =>
  updateDoc(doc(db, 'locations', id), {
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(region !== undefined ? { region: region.trim() || 'Geral' } : {}),
    updatedAt: serverTimestamp(),
  });

export const deleteLocation = async (id) => deleteDoc(doc(db, 'locations', id));

/**
 * Agrupa por regiao para alimentar os <optgroup> do seletor.
 * @returns {Array<{region: string, items: Array}>}
 */
export const groupLocations = (locations = []) => {
  const groups = new Map();
  locations.forEach((loc) => {
    const key = loc.region || 'Geral';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(loc);
  });
  return [...groups.entries()]
    .map(([region, items]) => ({ region, items }))
    .sort((a, b) => a.region.localeCompare(b.region, 'pt-BR'));
};

/**
 * Lista legada que estava fixa no codigo. Mantida apenas para que o inquilino
 * da Shineray recupere as proprias filiais com um clique em Configuracoes —
 * nenhuma empresa nova recebe isto automaticamente.
 */
export const LEGACY_LOCATIONS = [
  { region: 'Para - Regiao Metropolitana', name: 'Matriz - Belem' },
  { region: 'Para - Regiao Metropolitana', name: 'Fabrica / CD - Ananindeua' },
  { region: 'Para - Regiao Metropolitana', name: 'Filial Ananindeua' },
  { region: 'Para - Regiao Metropolitana', name: 'Filial Castanhal' },
  { region: 'Para - Regiao Metropolitana', name: 'Icoaraci' },
  { region: 'Para - Regiao Metropolitana', name: 'Barcarena' },
  { region: 'Para - Interior', name: 'Acara' },
  { region: 'Para - Interior', name: 'Braganca' },
  { region: 'Para - Interior', name: 'Breves' },
  { region: 'Para - Interior', name: 'Cameta' },
  { region: 'Para - Interior', name: 'Capanema' },
  { region: 'Para - Interior', name: 'Capitao Poco' },
  { region: 'Para - Interior', name: 'Concordia' },
  { region: 'Para - Interior', name: 'Curuca' },
  { region: 'Para - Interior', name: 'Moju' },
  { region: 'Para - Interior', name: 'Igarape Mirim' },
  { region: 'Para - Interior', name: 'Sao Miguel' },
  { region: 'Para - Interior', name: 'Soure' },
  { region: 'Para - Interior', name: 'Tailandia' },
  { region: 'Para - Interior', name: 'Tome-Acu' },
  { region: 'Ceara', name: 'Aldeota (CE)' },
  { region: 'Ceara', name: 'Democrito Rocha (CE)' },
  { region: 'Ceara', name: 'Fortaleza (CE)' },
  { region: 'Ceara', name: 'Parangaba (CE)' },
  { region: 'Outros', name: 'Home Office' },
  { region: 'Outros', name: 'Em Transito' },
];

/** Locais genericos sugeridos a qualquer empresa que esteja comecando do zero. */
export const STARTER_LOCATIONS = [
  { region: 'Geral', name: 'Matriz' },
  { region: 'Geral', name: 'Almoxarifado' },
  { region: 'Outros', name: 'Home Office' },
  { region: 'Outros', name: 'Em Transito' },
];

/** Grava um conjunto de locais de uma vez, ignorando nomes que ja existem. */
export const seedLocations = async (tenantId, preset = STARTER_LOCATIONS) => {
  if (!tenantId) throw new Error('Nao e possivel semear locais sem inquilino.');

  const existing = await getLocations(tenantId);
  const known = new Set(existing.map((l) => l.name.toLowerCase()));
  const pending = preset.filter((l) => !known.has(l.name.toLowerCase()));
  if (pending.length === 0) return 0;

  const batch = writeBatch(db);
  pending.forEach((loc) => {
    batch.set(doc(locationsCollection()), {
      name: loc.name,
      region: loc.region,
      tenantId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
  return pending.length;
};

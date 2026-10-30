// scripts/updateProjectsFromAudit.js
import fs from 'fs';

function getGoogleAccessToken() {
  const configPath = 'C:/Users/ShinerayADM/.config/configstore/firebase-tools.json';
  if (!fs.existsSync(configPath)) {
    throw new Error('Arquivo firebase-tools.json não encontrado.');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const token = config.tokens?.access_token;
  if (!token) {
    throw new Error('Token de acesso não encontrado em firebase-tools.json.');
  }
  return token;
}

export async function getProjectDoc(projectId) {
  const token = getGoogleAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/itam-nexus/databases/(default)/documents/projects/${projectId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Erro ao buscar projeto ${projectId}: ${res.statusText}`);
  }
  return await res.json();
}

export async function patchProjectDoc(projectId, updates) {
  const token = getGoogleAccessToken();
  const existing = await getProjectDoc(projectId);
  if (!existing) {
    throw new Error(`Projeto ${projectId} não existe para atualização.`);
  }

  const existingFields = existing.fields || {};
  const currentChangelogs = (existingFields.changelog?.arrayValue?.values || []).map(v => v.stringValue);

  // Se houver novo changelog e ele ainda não estiver presente, anexa
  let newChangelogList = [...currentChangelogs];
  if (updates.newChangelogEntry) {
    const entryPrefix = updates.newChangelogEntry.split(':')[0].trim();
    // Remove se já existia entrada com mesmo prefixo para evitar duplicatas idênticas
    newChangelogList = newChangelogList.filter(entry => !entry.startsWith(entryPrefix + ':'));
    newChangelogList.push(updates.newChangelogEntry);
  }

  const fieldPaths = ['version', 'status', 'progress', 'updatedAt', 'changelog'];
  const fields = {
    ...existingFields,
    version: { stringValue: updates.version || existingFields.version?.stringValue || '1.0.0' },
    status: { stringValue: updates.status || existingFields.status?.stringValue || 'Em Andamento' },
    progress: { stringValue: String(updates.progress ?? existingFields.progress?.stringValue ?? '50') },
    updatedAt: { stringValue: new Date().toISOString() },
    changelog: {
      arrayValue: {
        values: newChangelogList.map(str => ({ stringValue: str }))
      }
    }
  };

  if (updates.description) {
    fieldPaths.push('description');
    fields.description = { stringValue: updates.description };
  }
  if (updates.leader) {
    fieldPaths.push('leader');
    fields.leader = { stringValue: updates.leader };
  }

  const queryParams = fieldPaths.map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&');
  const patchUrl = `https://firestore.googleapis.com/v1/projects/itam-nexus/databases/(default)/documents/projects/${projectId}?${queryParams}`;

  const res = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha no PATCH do projeto ${projectId} (${res.status}): ${errText}`);
  }

  return await res.json();
}

export async function createProjectDoc(projectId, data) {
  const token = getGoogleAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/itam-nexus/databases/(default)/documents/projects?documentId=${projectId}`;

  const changelogValues = (data.changelog || []).map(str => ({ stringValue: str }));
  if (data.newChangelogEntry) {
    changelogValues.push({ stringValue: data.newChangelogEntry });
  }

  const fields = {
    name: { stringValue: data.name },
    description: { stringValue: data.description || '' },
    version: { stringValue: data.version || '1.0.0' },
    status: { stringValue: data.status || 'Em Andamento' },
    progress: { stringValue: String(data.progress || '50') },
    priority: { stringValue: data.priority || 'Média' },
    leader: { stringValue: data.leader || 'Délcio Farias' },
    deadline: { stringValue: data.deadline || '2026-12-31' },
    tenantId: { stringValue: data.tenantId || 'tenant-ap3htf6' },
    createdAt: { stringValue: new Date().toISOString() },
    updatedAt: { stringValue: new Date().toISOString() },
    changelog: { arrayValue: { values: changelogValues } }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao criar projeto ${projectId}: ${errText}`);
  }

  return await res.json();
}

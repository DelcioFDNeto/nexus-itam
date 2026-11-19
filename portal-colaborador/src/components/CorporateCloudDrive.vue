<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PortalIcon from './PortalIcon.vue';
import { getStoredSession, portalApi } from '../services/nexusApi';
import { evaluateCellValue, evaluateSheetFormulas } from '../utils/sheetFormulaEngine.js';

const props = defineProps({
  user: { type: Object, default: () => ({}) },
  userEmail: { type: String, default: '' },
  userDepartment: { type: String, default: '' },
  wsState: { type: String, default: 'disconnected' },
  liveSheetEvent: { type: Object, default: null },
  streamHandle: { type: Object, default: null },
});

const nodes = ref([]);
const loading = ref(false);
const uploadingCount = ref(0);
const errorBanner = ref('');
const statusToast = ref('');
const planUpgradeNotice = ref('');

// Windows Explorer Navigation, Filter & View State
const currentFolderId = ref(null);
const navHistory = ref([null]);
const navIndex = ref(0);
const searchQuery = ref('');
const typeFilter = ref('all'); // 'all' | 'folders' | 'docs' | 'sheets' | 'images'
const viewMode = ref('details'); // 'details' | 'grid'
const sortBy = ref('name'); // 'name' | 'updatedAt' | 'type' | 'size'
const sortDir = ref('asc');
const selectedNodeId = ref(null);

// Inline Create Folder & Inline Rename (F2)
const creatingFolder = ref(false);
const newFolderName = ref('');
const renamingNodeId = ref(null);
const renameDraft = ref('');

// Clipboard (Copy / Cut / Paste) & Drag-Drop
const clipboard = ref(null); // { mode: 'copy' | 'cut', nodeId, name }
const isExternalDragOver = ref(false);
const dragOverFolderId = ref(null);

// Right-Click Context Menu
const contextMenu = ref(null); // { x, y, node }

// Real Inline Preview Lightbox State
const previewNode = ref(null);
const previewContentType = ref('');
const previewObjectUrl = ref(null);
const previewTextContent = ref(null);

// Nexus Sheets Live state (collapsible QoL — auto-expanded when spreadsheet loaded)
const activeSheetNode = ref(null);
const showSheetEditor = ref(false);
const sheetRev = ref(1);
const sheetSaving = ref(false);
const sheetTabs = ref([
  {
    name: 'Planilha1',
    freezeRow: 1,
    columns: ['A', 'B', 'C', 'D', 'E', 'F'],
    cells: {
      A1: { value: '100', formula: null },
      A2: { value: '250', formula: null },
      B1: { value: '350', formula: '=SOMA(A1:A2)' },
    },
  },
]);
const activeSheetTabIdx = ref(0);
const selectedCellRef = ref('A1');
const formulaInput = ref('100');
const sheetPeers = ref([]);
const remoteCursors = ref({});

let ownWsHandle = null;
let toastTimer = null;
const fileInputEl = ref(null);
const newFolderInputEl = ref(null);

const ACCESS_LABELS_PT = {
  full_control: 'Controle Total',
  editor: 'Pode Editar',
  reader: 'Leitura e Download',
  viewer_online: 'Somente Leitura Online',
};

function notifySuccess(msg) {
  statusToast.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    statusToast.value = '';
  }, 3500);
}

const resolvedEmail = computed(() =>
  String(props.userEmail || props.user?.email || getStoredSession()?.user?.email || '')
    .toLowerCase()
    .trim(),
);

const resolvedDepartment = computed(() =>
  String(props.userDepartment || props.user?.department || getStoredSession()?.user?.department || '').trim(),
);

function formatBytes(bytes) {
  const num = Number(bytes || 0);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFriendlyDate(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '—';
  const now = new Date();
  const sameDay = dt.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Hoje ${timeStr}`;
  if (dt.toDateString() === yesterday.toDateString()) return `Ontem ${timeStr}`;
  return dt.toLocaleDateString('pt-BR');
}

function isFolder(node) {
  return (node?.nodeType || node?.node_type || node?.type) === 'folder';
}

function isSpreadsheet(node) {
  return !isFolder(node) && /\.(xlsx|xls|csv|nexusheet)$/i.test(String(node?.name || ''));
}

function isImageFile(node) {
  return !isFolder(node) && /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(String(node?.name || ''));
}

function isDocumentFile(node) {
  return !isFolder(node) && /\.(pdf|docx?|odt|rtf|txt|md|pptx?)$/i.test(String(node?.name || ''));
}

function isArchiveFile(node) {
  return !isFolder(node) && /\.(zip|rar|7z|tar|gz)$/i.test(String(node?.name || ''));
}

function getFileTypeLabel(node) {
  if (isFolder(node)) return 'Pasta';
  const name = String(node?.name || '').toLowerCase();
  if (/\.(xlsx|xls|csv|nexusheet)$/i.test(name)) return 'Planilha';
  if (name.endsWith('.pdf')) return 'PDF';
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name)) return 'Imagem';
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return 'Compactado';
  if (/\.(docx?|odt|rtf)$/i.test(name)) return 'Documento';
  if (/\.(txt|md|json|log|xml)$/i.test(name)) return 'Texto';
  return 'Arquivo';
}

function getAccessLabel(node) {
  const eff = String(node?.effectiveAccess || node?.effective_access || 'reader').toLowerCase();
  return ACCESS_LABELS_PT[eff] || eff;
}

function triggerBrowserDownload(blob, fileName) {
  if (!blob || typeof window === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'arquivo';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function closePreview() {
  if (previewObjectUrl.value && typeof URL?.revokeObjectURL === 'function') {
    URL.revokeObjectURL(previewObjectUrl.value);
  }
  previewObjectUrl.value = null;
  previewTextContent.value = null;
  previewContentType.value = '';
  previewNode.value = null;
}

// Collaborator ACL visibility filter (strictly blocks restricted folders and 'none' nodes)
const accessibleNodes = computed(() =>
  nodes.value.filter((n) => {
    if (!n || n.isTrashed || n.is_trashed) return false;
    const eff = String(n.effectiveAccess || n.effective_access || n.accessLevel || '').toLowerCase();
    if (eff === 'none') return false;
    const vPath = String(n.virtualPath || n.virtual_path || '');
    if (vPath === '/Cofre-TI-Infra' || vPath.startsWith('/Cofre-TI-Infra/')) return false;
    if (vPath === '/Chamados' || vPath.startsWith('/Chamados/')) return false;
    return true;
  }),
);

const accessibleById = computed(() => {
  const m = new Map();
  for (const n of accessibleNodes.value) m.set(n.id, n);
  return m;
});

const rootFolders = computed(() =>
  accessibleNodes.value
    .filter((n) => {
      if (!isFolder(n)) return false;
      const pid = n.parentId || n.parent_id;
      return !pid || !accessibleById.value.has(pid);
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { numeric: true })),
);

const totalFolderCount = computed(() => accessibleNodes.value.filter((n) => isFolder(n)).length);
const totalFileCount = computed(() => accessibleNodes.value.filter((n) => !isFolder(n)).length);

const breadcrumbs = computed(() => {
  const trail = [{ id: null, label: 'Meus Arquivos' }];
  const chain = [];
  let cursor = currentFolderId.value ? accessibleById.value.get(currentFolderId.value) : null;
  const guard = new Set();
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id);
    chain.unshift({ id: cursor.id, label: cursor.name });
    const pid = cursor.parentId || cursor.parent_id;
    cursor = pid ? accessibleById.value.get(pid) : null;
  }
  return [...trail, ...chain];
});

// Folders first, then files (Windows Explorer natural sorting + QoL type filter)
const visibleNodes = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  const list = accessibleNodes.value.filter((n) => {
    if (typeFilter.value === 'folders' && !isFolder(n)) return false;
    if (typeFilter.value === 'docs' && !isDocumentFile(n)) return false;
    if (typeFilter.value === 'sheets' && !isSpreadsheet(n)) return false;
    if (typeFilter.value === 'images' && !isImageFile(n)) return false;

    if (q) {
      return (
        String(n.name || '').toLowerCase().includes(q) ||
        String(n.virtualPath || n.virtual_path || '').toLowerCase().includes(q)
      );
    }
    // When a type filter other than 'all' is active at root, search across all accessible areas
    if (typeFilter.value !== 'all' && !currentFolderId.value) {
      return true;
    }
    const pid = n.parentId || n.parent_id;
    if (currentFolderId.value) {
      return pid === currentFolderId.value;
    }
    return !pid || !accessibleById.value.has(pid);
  });

  const dir = sortDir.value === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const af = isFolder(a);
    const bf = isFolder(b);
    if (af !== bf) return af ? -1 : 1;
    if (sortBy.value === 'updatedAt') {
      const ta = new Date(a.updatedAt || a.updated_at || a.createdAt || a.created_at || 0).getTime();
      const tb = new Date(b.updatedAt || b.updated_at || b.createdAt || b.created_at || 0).getTime();
      return (ta - tb) * dir;
    }
    if (sortBy.value === 'size') {
      return (Number(a.sizeBytes ?? a.size_bytes ?? 0) - Number(b.sizeBytes ?? b.size_bytes ?? 0)) * dir;
    }
    if (sortBy.value === 'type') {
      return getFileTypeLabel(a).localeCompare(getFileTypeLabel(b), 'pt-BR') * dir;
    }
    return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { numeric: true }) * dir;
  });
});

const selectedNode = computed(() =>
  selectedNodeId.value ? visibleNodes.value.find((n) => n.id === selectedNodeId.value) || null : null,
);

const currentFolderNode = computed(() =>
  currentFolderId.value ? accessibleById.value.get(currentFolderId.value) || null : null,
);

const currentFolderAccess = computed(() => {
  if (currentFolderNode.value) {
    return String(
      currentFolderNode.value.effectiveAccess || currentFolderNode.value.effective_access || 'editor',
    ).toLowerCase();
  }
  const writable = accessibleNodes.value.some((n) =>
    ['editor', 'full_control'].includes(String(n.effectiveAccess || n.effective_access || '').toLowerCase()),
  );
  if (writable) return 'editor';
  const onlyOnline =
    accessibleNodes.value.length > 0 &&
    accessibleNodes.value.every(
      (n) => String(n.effectiveAccess || n.effective_access || '').toLowerCase() === 'viewer_online',
    );
  return onlyOnline ? 'viewer_online' : 'reader';
});

const canWriteInCurrentFolder = computed(() =>
  ['editor', 'full_control'].includes(currentFolderAccess.value),
);

const currentPermissionHint = computed(() => {
  if (canWriteInCurrentFolder.value) {
    return {
      tone: 'emerald',
      text: 'Você pode enviar, organizar e editar arquivos nesta pasta',
    };
  }
  if (currentFolderAccess.value === 'viewer_online') {
    return {
      tone: 'amber',
      text: 'Modo leitura protegida — visualização online na tela',
    };
  }
  return {
    tone: 'sky',
    text: 'Pasta somente leitura — visualização e cópia local liberados',
  };
});

function canEditNode(node) {
  const eff = String(node?.effectiveAccess || node?.effective_access || '').toLowerCase();
  return ['editor', 'full_control'].includes(eff);
}

function canDeleteNode(node) {
  const eff = String(node.effectiveAccess || node.effective_access || '').toLowerCase();
  if (eff === 'full_control') return true;
  if (eff === 'editor') {
    const creator = String(node.createdByEmail || node.created_by_email || '').toLowerCase().trim();
    if (!creator || !resolvedEmail.value) return false;
    return creator === resolvedEmail.value;
  }
  return false;
}

function canDownloadNode(node) {
  const eff = String(node.effectiveAccess || node.effective_access || 'reader').toLowerCase();
  return ['reader', 'editor', 'full_control'].includes(eff);
}

const canGoBack = computed(() => navIndex.value > 0);
const canGoUp = computed(() => Boolean(currentFolderId.value));

function navigateTo(folderId, pushHistory = true) {
  contextMenu.value = null;
  renamingNodeId.value = null;
  creatingFolder.value = false;
  selectedNodeId.value = null;
  if (searchQuery.value) searchQuery.value = '';
  currentFolderId.value = folderId || null;

  if (pushHistory) {
    const sliced = navHistory.value.slice(0, navIndex.value + 1);
    if (sliced[sliced.length - 1] !== (folderId || null)) {
      navHistory.value = [...sliced, folderId || null];
      navIndex.value = navHistory.value.length - 1;
    }
  }
}

function goBack() {
  if (!canGoBack.value) return;
  navIndex.value -= 1;
  navigateTo(navHistory.value[navIndex.value], false);
}

function goUp() {
  if (!currentFolderId.value) return;
  const pid = currentFolderNode.value ? currentFolderNode.value.parentId || currentFolderNode.value.parent_id : null;
  navigateTo(pid && accessibleById.value.has(pid) ? pid : null);
}

function openItem(node) {
  if (!node) return;
  if (isFolder(node)) {
    navigateTo(node.id);
    return;
  }
  if (isSpreadsheet(node)) {
    openSheetEditor(node);
    return;
  }
  handlePreviewFile(node);
}

function startCreateFolder() {
  if (!canWriteInCurrentFolder.value) return;
  contextMenu.value = null;
  creatingFolder.value = true;
  newFolderName.value = 'Nova pasta';
  nextTick(() => {
    newFolderInputEl.value?.focus?.();
    newFolderInputEl.value?.select?.();
  });
}

function startRename(node) {
  if (!node || !canEditNode(node)) return;
  contextMenu.value = null;
  renamingNodeId.value = node.id;
  renameDraft.value = node.name || '';
}

async function commitRename(node) {
  const trimmed = renameDraft.value.trim();
  renamingNodeId.value = null;
  if (!trimmed || trimmed === node.name) return;
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    errorBanner.value = 'Nome inválido: não utilize barras ou "..".';
    return;
  }
  errorBanner.value = '';
  try {
    await portalApi.renameStorageNode(node.id, trimmed);
    notifySuccess(`Renomeado para "${trimmed}".`);
    await loadDriveNodes();
  } catch (err) {
    errorBanner.value = err?.message || 'Não foi possível renomear o item.';
  }
}

function setClipboardAction(mode, node) {
  if (!node || !canEditNode(node)) return;
  clipboard.value = { mode, nodeId: node.id, name: node.name };
  contextMenu.value = null;
  notifySuccess(
    mode === 'cut'
      ? `"${node.name}" recortado. Abra a pasta destino e clique em Colar Aqui.`
      : `"${node.name}" copiado. Abra a pasta destino e clique em Colar Aqui.`,
  );
}

async function pasteClipboard() {
  if (!clipboard.value || !canWriteInCurrentFolder.value) return;
  const src = accessibleById.value.get(clipboard.value.nodeId);
  if (!src) {
    clipboard.value = null;
    return;
  }
  errorBanner.value = '';
  try {
    if (clipboard.value.mode === 'cut') {
      if (src.id !== currentFolderId.value && (src.parentId || src.parent_id || null) !== (currentFolderId.value || null)) {
        await portalApi.updateStorageNode(src.id, { parentId: currentFolderId.value || null });
        notifySuccess(`"${src.name}" movido com sucesso.`);
      }
      clipboard.value = null;
    } else {
      await portalApi.copyStorageNode(src.id, { targetParentId: currentFolderId.value || null });
      notifySuccess(`Cópia de "${src.name}" criada nesta pasta.`);
    }
    await loadDriveNodes();
  } catch (err) {
    errorBanner.value = err?.message || 'Não foi possível colar o item nesta pasta.';
  }
}

function openContextMenu(event, node = null) {
  event.preventDefault();
  event.stopPropagation();
  if (node) selectedNodeId.value = node.id;
  const maxW = typeof window !== 'undefined' ? window.innerWidth - 220 : 600;
  const maxH = typeof window !== 'undefined' ? window.innerHeight - 280 : 400;
  contextMenu.value = {
    x: Math.max(12, Math.min(event.clientX, maxW)),
    y: Math.max(12, Math.min(event.clientY, maxH)),
    node,
  };
}

function closeContextMenu() {
  contextMenu.value = null;
}

function handleDragOverPane(event) {
  if (!canWriteInCurrentFolder.value) return;
  const hasFiles = Array.from(event.dataTransfer?.types || []).includes('Files');
  if (hasFiles) {
    event.preventDefault();
    isExternalDragOver.value = true;
  }
}

function handleDragLeavePane(event) {
  if (event.currentTarget?.contains?.(event.relatedTarget)) return;
  isExternalDragOver.value = false;
}

async function handleDropOnPane(event) {
  event.preventDefault();
  isExternalDragOver.value = false;
  dragOverFolderId.value = null;
  if (!canWriteInCurrentFolder.value) return;
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length > 0) {
    await uploadMultipleFiles(files, currentFolderId.value);
  }
}

function handleItemDragStart(event, node) {
  if (!canEditNode(node)) return;
  event.dataTransfer?.setData('application/x-nexus-portal-node', node.id);
}

async function handleDropOnFolder(event, targetFolderId) {
  event.preventDefault();
  event.stopPropagation();
  dragOverFolderId.value = null;
  isExternalDragOver.value = false;
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length > 0) {
    await uploadMultipleFiles(files, targetFolderId);
    return;
  }
  const draggedId = event.dataTransfer?.getData('application/x-nexus-portal-node');
  if (!draggedId || draggedId === targetFolderId) return;
  try {
    await portalApi.updateStorageNode(draggedId, { parentId: targetFolderId || null });
    notifySuccess('Item movido para a pasta.');
    await loadDriveNodes();
  } catch (err) {
    errorBanner.value = err?.message || 'Não foi possível mover este item.';
  }
}

function handleExplorerKeydown(event) {
  const tag = String(event.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (event.key === 'Escape') {
    if (previewNode.value) {
      closePreview();
      return;
    }
    contextMenu.value = null;
    creatingFolder.value = false;
    renamingNodeId.value = null;
    clipboard.value = null;
  } else if (event.key === 'F2' && selectedNode.value && canEditNode(selectedNode.value)) {
    event.preventDefault();
    startRename(selectedNode.value);
  } else if (event.key === 'Enter' && selectedNode.value) {
    event.preventDefault();
    openItem(selectedNode.value);
  } else if (event.key === 'Backspace' && canGoUp.value) {
    event.preventDefault();
    goUp();
  } else if (event.key === 'Delete' && selectedNode.value && canDeleteNode(selectedNode.value)) {
    event.preventDefault();
    handleDeleteFile(selectedNode.value);
  }
}

const evaluatedTabs = computed(() => evaluateSheetFormulas(sheetTabs.value));
const currentTab = computed(() => sheetTabs.value[activeSheetTabIdx.value] || sheetTabs.value[0]);
const evaluatedCurrentTab = computed(
  () => evaluatedTabs.value[activeSheetTabIdx.value] || evaluatedTabs.value[0],
);

async function loadDriveNodes() {
  loading.value = true;
  errorBanner.value = '';
  planUpgradeNotice.value = '';
  try {
    const res = await portalApi.listStorageNodes();
    const list = res?.items || res?.nodes || [];
    nodes.value = list;
    const sheetCandidate = list.find(
      (n) =>
        /\.(xlsx|csv|nexusheet)$/i.test(String(n.name || '')) &&
        String(n.effectiveAccess || n.effective_access || '') !== 'none',
    );
    if (sheetCandidate && !activeSheetNode.value) {
      await openSheetEditor(sheetCandidate);
    }
  } catch (err) {
    if (err?.status === 403 || String(err?.code || '').includes('FEATURE_NOT_IN_PLAN')) {
      planUpgradeNotice.value =
        err?.message ||
        'O módulo Arquivos & Nuvem (Cloud Vault) não está habilitado no plano atual da empresa.';
    } else {
      errorBanner.value = err?.message || 'Não foi possível carregar os arquivos da nuvem corporativa.';
    }
  } finally {
    loading.value = false;
  }
}

async function handleCreateFolder() {
  const name = newFolderName.value.trim();
  if (!name) {
    creatingFolder.value = false;
    return;
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    errorBanner.value = 'Nome de pasta inválido (Path Traversal bloqueado).';
    return;
  }
  errorBanner.value = '';
  try {
    const res = await portalApi.createStorageFolder({
      parentId: currentFolderId.value,
      name,
    });
    const created = res?.node || res?.folder || res;
    if (created?.id) {
      nodes.value = [...nodes.value, created];
    }
    newFolderName.value = '';
    creatingFolder.value = false;
    notifySuccess(`Pasta "${name}" criada com sucesso.`);
  } catch (err) {
    errorBanner.value = err?.message || 'Erro ao criar pasta.';
  }
}

async function handleCreateQuickSheet() {
  if (!canWriteInCurrentFolder.value) return;
  errorBanner.value = '';
  const stamped = `Planilha-${new Date().toISOString().slice(0, 10)}.xlsx`;
  try {
    const res = await portalApi.createSheet({
      parentId: currentFolderId.value,
      name: stamped,
      sheets: sheetTabs.value,
    });
    const created = res?.node || res;
    if (created?.id) {
      nodes.value = [...nodes.value, created];
      await openSheetEditor(created);
      notifySuccess(`Planilha "${stamped}" criada e aberta ao vivo.`);
    }
  } catch (err) {
    errorBanner.value = err?.message || 'Não foi possível criar a planilha nesta pasta.';
  }
}

async function uploadMultipleFiles(files, targetFolderId = currentFolderId.value) {
  if (!files || files.length === 0) return;
  errorBanner.value = '';
  uploadingCount.value = files.length;
  let uploadedCount = 0;
  try {
    for (const file of files) {
      const res = await portalApi.uploadStorageFile(file, {
        parentId: targetFolderId,
        fileName: file.name,
        conflictPolicy: 'version',
      });
      const created = res?.node || res;
      if (created?.id) {
        nodes.value = [...nodes.value.filter((n) => n.id !== created.id), created];
      }
      uploadedCount += 1;
    }
    if (uploadedCount > 0) {
      notifySuccess(
        uploadedCount === 1
          ? `Arquivo "${files[0].name}" enviado para a nuvem.`
          : `${uploadedCount} arquivos enviados para a nuvem.`,
      );
    }
  } catch (err) {
    errorBanner.value = err?.message || 'Falha no upload do arquivo (verifique cota ou bloqueio).';
  } finally {
    uploadingCount.value = 0;
  }
}

async function handleUploadFile(event) {
  const files = Array.from(event?.target?.files || []);
  if (files.length === 0) return;
  await uploadMultipleFiles(files, currentFolderId.value);
  if (event?.target) event.target.value = '';
}

async function handlePreviewFile(node) {
  errorBanner.value = '';
  try {
    const res = await portalApi.previewStorageFile(node.id);
    closePreview();
    const ct = res?.contentType || node.mimeType || node.mime_type || 'application/octet-stream';
    previewContentType.value = ct;
    if (res?.blob) {
      const lower = String(ct).toLowerCase();
      const isText =
        lower.startsWith('text/') ||
        lower.includes('json') ||
        /\.(txt|md|json|csv|log|xml)$/i.test(String(node.name || ''));
      if (isText && typeof res.blob.text === 'function') {
        previewTextContent.value = await res.blob.text();
      } else if (typeof URL?.createObjectURL === 'function') {
        previewObjectUrl.value = URL.createObjectURL(res.blob);
      }
    }
    previewNode.value = node;
  } catch (err) {
    errorBanner.value = err?.message || 'Falha ao abrir preview online.';
  }
}

async function handleDownloadFile(node) {
  if (!canDownloadNode(node)) {
    errorBanner.value = 'Perfil viewer_online permite apenas visualização online.';
    return;
  }
  errorBanner.value = '';
  try {
    const res = await portalApi.downloadStorageFile(node.id);
    if (res?.blob) {
      triggerBrowserDownload(res.blob, node.name);
      notifySuccess(`Download de "${node.name}" iniciado.`);
    }
  } catch (err) {
    errorBanner.value = err?.message || 'Falha ao baixar arquivo.';
  }
}

async function handleDeleteFile(node) {
  if (!canDeleteNode(node)) {
    errorBanner.value = 'Você só pode excluir arquivos enviados por você mesmo.';
    return;
  }
  errorBanner.value = '';
  try {
    await portalApi.deleteStorageNode(node.id);
    nodes.value = nodes.value.filter((n) => n.id !== node.id);
    if (selectedNodeId.value === node.id) selectedNodeId.value = null;
    notifySuccess(`"${node.name}" movido para a lixeira.`);
  } catch (err) {
    errorBanner.value = err?.message || 'Falha ao excluir arquivo.';
  }
}

function getActiveWsHandle() {
  return props.streamHandle || ownWsHandle;
}

async function openSheetEditor(node) {
  activeSheetNode.value = node;
  showSheetEditor.value = true;
  try {
    const res = await portalApi.getSheet(node.id);
    const tabs = res?.sheets || res?.tabs || res?.workbook?.sheets;
    if (Array.isArray(tabs) && tabs.length > 0) {
      sheetTabs.value = evaluateSheetFormulas(tabs);
    }
    if (res?.rev) sheetRev.value = Number(res.rev);
    getActiveWsHandle()?.joinSheet?.(node.id);
  } catch (err) {
    errorBanner.value = err?.message || 'Não foi possível abrir a planilha.';
  }
}

function selectSheetCell(cellRef) {
  selectedCellRef.value = cellRef;
  const cell = currentTab.value?.cells?.[cellRef] || {};
  formulaInput.value =
    cell.formula || (cell.value !== undefined && cell.value !== null ? String(cell.value) : '');
  if (activeSheetNode.value?.id) {
    getActiveWsHandle()?.sendSheetCursor?.({
      fileId: activeSheetNode.value.id,
      tab: currentTab.value.name,
      tabName: currentTab.value.name,
      cell: cellRef,
      cellRef,
    });
  }
}

function applySheetCellInput(cellRef, rawValue) {
  const str = String(rawValue ?? '');
  const isFormula = str.trim().startsWith('=');
  sheetTabs.value = evaluateSheetFormulas(
    sheetTabs.value.map((t, idx) => {
      if (idx !== activeSheetTabIdx.value) return t;
      const nextCells = { ...(t.cells || {}) };
      nextCells[cellRef] = {
        ...(nextCells[cellRef] || {}),
        formula: isFormula ? str.trim() : null,
        value: isFormula ? evaluateCellValue(str.trim(), t.cells || {}, sheetTabs.value) : str,
      };
      return { ...t, cells: nextCells };
    }),
  );

  if (activeSheetNode.value?.id) {
    getActiveWsHandle()?.sendSheetCellPatch?.({
      fileId: activeSheetNode.value.id,
      tab: currentTab.value.name,
      tabName: currentTab.value.name,
      cell: cellRef,
      cellRef,
      value: isFormula ? undefined : str,
      formula: isFormula ? str.trim() : null,
      baseRev: sheetRev.value,
    });
  }
}

async function saveActiveSheet() {
  if (!activeSheetNode.value?.id) return;
  sheetSaving.value = true;
  try {
    const res = await portalApi.saveSheet(activeSheetNode.value.id, {
      expectedRev: sheetRev.value,
      sheets: evaluatedTabs.value,
      tabs: evaluatedTabs.value,
    });
    if (res?.rev) sheetRev.value = Number(res.rev);
    notifySuccess(`Planilha "${activeSheetNode.value.name}" salva na nuvem (rev #${sheetRev.value}).`);
  } catch (err) {
    errorBanner.value = err?.message || 'Erro ao salvar planilha (bloqueada ou conflito de revisão).';
  } finally {
    sheetSaving.value = false;
  }
}

async function exportActiveSheet(format) {
  if (!activeSheetNode.value?.id || !canDownloadNode(activeSheetNode.value)) return;
  try {
    const res = await portalApi.exportSheet(activeSheetNode.value.id, format);
    if (res?.blob) {
      const base = String(activeSheetNode.value.name || 'planilha').replace(/\.[^.]+$/, '');
      triggerBrowserDownload(res.blob, `${base}.${format}`);
      notifySuccess(`Planilha exportada em .${format}.`);
    }
  } catch (err) {
    errorBanner.value = err?.message || 'Não foi possível exportar a planilha.';
  }
}

function handleIncomingSheetFrame(frame) {
  if (!frame) return;
  const evt = String(frame.event || frame.type || '');
  const data = frame.data || frame;
  if (evt === 'sheet.snapshot' && Array.isArray(data.tabs || data.sheets)) {
    sheetTabs.value = evaluateSheetFormulas(data.tabs || data.sheets);
    if (data.rev) sheetRev.value = Number(data.rev);
  } else if (evt === 'sheet.presence' && Array.isArray(data.peers)) {
    sheetPeers.value = data.peers;
  } else if (evt === 'sheet.cursor' && (data.cellRef || data.cell)) {
    const refCell = data.cellRef || data.cell;
    remoteCursors.value = {
      ...remoteCursors.value,
      [data.userEmail || data.email || 'peer']: {
        userEmail: data.userEmail || data.email,
        userName: data.userName || data.name || data.userEmail,
        tabName: data.tabName || data.tab || 'Planilha1',
        cellRef: refCell,
      },
    };
  } else if (evt === 'sheet.cell.patch' && (data.cellRef || data.cell)) {
    const refCell = data.cellRef || data.cell;
    const targetTab = data.tabName || data.tab || sheetTabs.value[0]?.name || 'Planilha1';
    sheetTabs.value = evaluateSheetFormulas(
      sheetTabs.value.map((t) => {
        if (t.name !== targetTab) return t;
        const nextCells = { ...(t.cells || {}) };
        nextCells[refCell] = {
          ...(nextCells[refCell] || {}),
          value: data.value !== undefined ? String(data.value) : nextCells[refCell]?.value,
          formula: data.formula !== undefined ? data.formula : nextCells[refCell]?.formula || null,
        };
        return { ...t, cells: nextCells };
      }),
    );
    if (data.rev) sheetRev.value = Number(data.rev);
  } else if (evt === 'sheet.saved' && data.rev) {
    sheetRev.value = Number(data.rev);
  }
}

watch(
  () => props.liveSheetEvent,
  (ev) => {
    if (ev) handleIncomingSheetFrame(ev);
  },
  { deep: true },
);

onMounted(async () => {
  if (typeof window !== 'undefined') {
    window.addEventListener('click', closeContextMenu);
  }
  if (!props.streamHandle) {
    const stored = getStoredSession();
    if (stored?.token && typeof portalApi.connectRealtimeStream === 'function') {
      ownWsHandle = portalApi.connectRealtimeStream(stored.token, (frame) => {
        if (String(frame?.event || '').startsWith('sheet.')) {
          handleIncomingSheetFrame(frame);
        }
      });
    }
  }
  await loadDriveNodes();
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('click', closeContextMenu);
  }
  if (toastTimer) clearTimeout(toastTimer);
  closePreview();
  if (ownWsHandle) {
    ownWsHandle.disconnect?.();
    ownWsHandle = null;
  }
});
</script>

<template>
  <div class="space-y-4">
    <!-- Plan upgrade / error / success toast banners -->
    <div
      v-if="planUpgradeNotice"
      role="alert"
      data-testid="cloud-plan-notice"
      class="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs font-semibold text-amber-800 dark:text-amber-200"
    >
      {{ planUpgradeNotice }}
    </div>

    <div
      v-if="errorBanner"
      role="alert"
      data-testid="cloud-error-banner"
      class="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs font-semibold text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2"
    >
      <span>{{ errorBanner }}</span>
      <button type="button" class="p-1" aria-label="Fechar aviso" @click="errorBanner = ''">
        <PortalIcon name="x" :size="14" />
      </button>
    </div>

    <div
      v-if="statusToast"
      role="status"
      data-testid="cloud-success-toast"
      class="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2"
    >
      <span class="inline-flex items-center gap-2">
        <PortalIcon name="check-circle" :size="15" />
        <span>{{ statusToast }}</span>
      </span>
      <button type="button" class="p-0.5" aria-label="Fechar notificação" @click="statusToast = ''">
        <PortalIcon name="x" :size="13" />
      </button>
    </div>

    <!-- QoL CONTEXT BAR: Department, Totals, Permission Hint & Quick File Type Filters -->
    <div
      v-if="!planUpgradeNotice"
      class="station-panel px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span class="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-[#fafafa]">
          <PortalIcon name="hard-drive" :size="15" />
          <span>{{ resolvedDepartment ? `Setor ${resolvedDepartment}` : 'Nuvem Corporativa' }}</span>
        </span>
        <span class="text-[11px] text-slate-500 font-medium">
          • {{ totalFolderCount }} pasta(s), {{ totalFileCount }} arquivo(s)
        </span>
        <span
          class="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
          :class="
            currentPermissionHint.tone === 'emerald'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : currentPermissionHint.tone === 'amber'
                ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                : 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
          "
        >
          <PortalIcon name="shield-check" :size="12" />
          <span>{{ currentPermissionHint.text }}</span>
        </span>
      </div>

      <!-- Quick File Type Filter Chips -->
      <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por tipo de arquivo">
        <button
          v-for="chip in [
            { id: 'all', label: 'Todos' },
            { id: 'folders', label: 'Pastas' },
            { id: 'docs', label: 'Documentos' },
            { id: 'sheets', label: 'Planilhas' },
            { id: 'images', label: 'Imagens' },
          ]"
          :key="chip.id"
          type="button"
          class="px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors border"
          :class="
            typeFilter === chip.id
              ? 'bg-brand text-brand-fg border-brand'
              : 'bg-slate-50 dark:bg-zinc-900 border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:border-brand/40'
          "
          @click="typeFilter = chip.id"
        >
          {{ chip.label }}
        </button>
      </div>
    </div>

    <!-- WINDOWS 11 EXPLORER SHELL -->
    <div
      v-if="!planUpgradeNotice"
      tabindex="0"
      class="station-panel overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      @keydown="handleExplorerKeydown"
    >
      <!-- Command Bar (Ribbon estilo Windows) -->
      <div class="px-3.5 py-2.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/80 dark:bg-zinc-900/60 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <template v-if="canWriteInCurrentFolder">
            <button
              type="button"
              class="min-h-[34px] px-3 py-1 rounded-lg bg-brand text-brand-fg text-xs font-bold inline-flex items-center gap-1.5"
              @click="startCreateFolder"
            >
              <PortalIcon name="folder-plus" :size="14" />
              <span>Nova Pasta</span>
            </button>

            <label
              class="min-h-[34px] px-3 py-1 rounded-lg border border-brand/40 bg-brand/10 text-brand-text-light dark:text-brand-text-dark text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <PortalIcon name="upload-cloud" :size="14" />
              <span>{{ uploadingCount > 0 ? `Enviando (${uploadingCount})...` : 'Enviar Arquivos' }}</span>
              <input
                ref="fileInputEl"
                type="file"
                multiple
                aria-label="Enviar arquivo para a nuvem"
                class="hidden"
                @change="handleUploadFile"
              />
            </label>

            <button
              type="button"
              class="min-h-[34px] px-2.5 py-1 rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-bold inline-flex items-center gap-1.5"
              @click="handleCreateQuickSheet"
            >
              <PortalIcon name="file-spreadsheet" :size="14" />
              <span class="hidden sm:inline">Nova Planilha</span>
            </button>

            <template v-if="selectedNode && canEditNode(selectedNode)">
              <span class="h-5 w-px bg-slate-200 dark:bg-zinc-700 mx-0.5 hidden sm:inline-block" />
              <button
                type="button"
                title="Renomear (F2)"
                class="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold inline-flex items-center gap-1"
                @click="startRename(selectedNode)"
              >
                <PortalIcon name="edit" :size="13" />
                <span class="hidden md:inline">Renomear</span>
              </button>

              <button
                type="button"
                title="Recortar (Mover para outra pasta)"
                class="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold inline-flex items-center gap-1"
                @click="setClipboardAction('cut', selectedNode)"
              >
                <PortalIcon name="folder-open" :size="13" />
                <span class="hidden lg:inline">Mover</span>
              </button>

              <button
                type="button"
                title="Copiar item"
                class="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold inline-flex items-center gap-1"
                @click="setClipboardAction('copy', selectedNode)"
              >
                <PortalIcon name="copy" :size="13" />
                <span class="hidden lg:inline">Copiar</span>
              </button>
            </template>

            <button
              v-if="clipboard"
              type="button"
              class="min-h-[34px] px-2.5 py-1 rounded-lg bg-sky-600 text-white text-xs font-bold inline-flex items-center gap-1"
              @click="pasteClipboard"
            >
              <PortalIcon name="plus" :size="13" />
              <span>Colar Aqui</span>
            </button>
          </template>
          <span v-else class="text-xs font-semibold text-slate-500">
            Navegação de arquivos corporativos
          </span>
        </div>

        <div class="flex items-center gap-1.5">
          <select
            aria-label="Ordenar arquivos"
            :value="`${sortBy}:${sortDir}`"
            class="min-h-[34px] px-2 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold"
            @change="
              (e) => {
                const [f, d] = e.target.value.split(':');
                sortBy = f;
                sortDir = d;
              }
            "
          >
            <option value="name:asc">Nome (A–Z)</option>
            <option value="name:desc">Nome (Z–A)</option>
            <option value="updatedAt:desc">Mais recentes</option>
            <option value="size:desc">Maior tamanho</option>
            <option value="type:asc">Tipo</option>
          </select>

          <div class="inline-flex rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-0.5 text-xs">
            <button
              type="button"
              title="Detalhes"
              :class="viewMode === 'details' ? 'bg-brand text-brand-fg' : 'text-slate-600 dark:text-zinc-300'"
              class="px-2 py-1 rounded-md font-bold"
              @click="viewMode = 'details'"
            >
              Lista
            </button>
            <button
              type="button"
              title="Ícones Grandes"
              :class="viewMode === 'grid' ? 'bg-brand text-brand-fg' : 'text-slate-600 dark:text-zinc-300'"
              class="px-2 py-1 rounded-md font-bold"
              @click="viewMode = 'grid'"
            >
              Ícones
            </button>
          </div>

          <button
            type="button"
            title="Atualizar"
            aria-label="Atualizar lista de arquivos"
            class="min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold inline-flex items-center gap-1"
            @click="loadDriveNodes"
          >
            <PortalIcon name="refresh-cw" :size="13" />
          </button>
        </div>
      </div>

      <!-- Clipboard QoL Bar -->
      <div
        v-if="clipboard"
        class="px-4 py-2 bg-sky-500/10 border-b border-sky-500/20 flex flex-wrap items-center justify-between gap-2 text-xs text-sky-800 dark:text-sky-200"
      >
        <span>
          <strong>{{ clipboard.name }}</strong> {{ clipboard.mode === 'cut' ? 'pronto para mover' : 'copiado' }} — abra a pasta destino e clique em <strong>Colar Aqui</strong>.
        </span>
        <div class="flex items-center gap-2">
          <button
            v-if="canWriteInCurrentFolder"
            type="button"
            class="px-2.5 py-1 rounded-md bg-sky-600 text-white font-bold"
            @click="pasteClipboard"
          >
            Colar Aqui
          </button>
          <button
            type="button"
            class="px-2 py-1 rounded-md border border-sky-500/30 font-semibold"
            @click="clipboard = null"
          >
            Cancelar
          </button>
        </div>
      </div>

      <!-- Navigation & Address Bar (← ↑ | Breadcrumbs | Search) -->
      <div class="px-3.5 py-2 border-b border-slate-200 dark:border-zinc-800 flex flex-wrap items-center gap-2">
        <div class="flex items-center gap-1">
          <button
            type="button"
            :disabled="!canGoBack"
            title="Voltar"
            aria-label="Voltar pasta"
            class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30"
            @click="goBack"
          >
            <PortalIcon name="arrow-left" :size="15" />
          </button>
          <button
            type="button"
            :disabled="!canGoUp"
            title="Subir um nível"
            aria-label="Subir um nível"
            class="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30"
            @click="goUp"
          >
            <PortalIcon name="chevron-up" :size="15" />
          </button>
        </div>

        <nav
          aria-label="Caminho atual"
          class="flex-1 min-w-[180px] min-h-[34px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 flex items-center gap-1 overflow-x-auto text-xs"
        >
          <PortalIcon name="folder-open" :size="14" />
          <template v-for="(crumb, idx) in breadcrumbs" :key="`${crumb.id ?? 'root'}-${idx}`">
            <PortalIcon v-if="idx > 0" name="chevron-right" :size="12" />
            <button
              type="button"
              class="px-1.5 py-0.5 rounded hover:bg-slate-200/70 dark:hover:bg-zinc-800 whitespace-nowrap"
              :class="idx === breadcrumbs.length - 1 ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-zinc-300'"
              @click="navigateTo(crumb.id)"
            >
              {{ crumb.label }}
            </button>
          </template>
        </nav>

        <div class="relative w-full sm:w-56">
          <span class="absolute left-2.5 top-2.5 text-slate-400">
            <PortalIcon name="search" :size="14" />
          </span>
          <input
            v-model="searchQuery"
            type="search"
            aria-label="Pesquisar arquivos"
            placeholder="Pesquisar arquivos..."
            class="w-full min-h-[34px] pl-8 pr-3 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 text-xs"
          />
        </div>
      </div>

      <!-- 2-Pane Windows Explorer Body -->
      <div class="flex flex-col md:flex-row min-h-[360px]">
        <!-- Left Quick Access Folders -->
        <aside
          v-if="rootFolders.length > 0"
          class="md:w-52 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/30 p-2.5 space-y-1"
        >
          <p class="px-2 pt-0.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Pastas Liberadas
          </p>
          <button
            type="button"
            class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left"
            :class="!currentFolderId && typeFilter === 'all' ? 'bg-brand/15 font-bold text-brand-text-light dark:text-brand-text-dark' : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800'"
            @click="
              typeFilter = 'all';
              navigateTo(null);
            "
          >
            <PortalIcon name="hard-drive" :size="14" />
            <span>Início (Todas)</span>
          </button>

          <button
            v-for="folder in rootFolders"
            :key="`tree-${folder.id}`"
            type="button"
            class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left truncate"
            :class="
              dragOverFolderId === folder.id
                ? 'bg-brand/25 ring-1 ring-brand font-bold'
                : currentFolderId === folder.id
                  ? 'bg-brand/15 font-bold text-brand-text-light dark:text-brand-text-dark'
                  : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-200/70 dark:hover:bg-zinc-800'
            "
            @click="
              typeFilter = 'all';
              navigateTo(folder.id);
            "
            @dragover.prevent="dragOverFolderId = folder.id"
            @dragleave="dragOverFolderId = null"
            @drop="handleDropOnFolder($event, folder.id)"
          >
            <PortalIcon name="folder" :size="14" />
            <span class="truncate">{{ folder.name }}</span>
          </button>
        </aside>

        <!-- Center Content Area (OS Drag-Drop Upload + Context Menu) -->
        <div
          class="relative flex-1 min-w-0 overflow-auto"
          @dragover="handleDragOverPane"
          @dragleave="handleDragLeavePane"
          @drop="handleDropOnPane"
          @contextmenu="openContextMenu($event, null)"
        >
          <div
            v-if="isExternalDragOver"
            class="absolute inset-2 z-20 rounded-xl border-2 border-dashed border-brand bg-brand/10 flex flex-col items-center justify-center gap-2 pointer-events-none"
          >
            <PortalIcon name="upload-cloud" :size="32" />
            <p class="text-xs font-bold">Solte os arquivos aqui para enviar para esta pasta</p>
          </div>

          <!-- Inline Create Folder Row -->
          <form
            v-if="creatingFolder && canWriteInCurrentFolder"
            class="mx-3 mt-3 mb-1 px-3 py-2 rounded-xl border border-brand/40 bg-brand/5 flex items-center gap-2"
            @submit.prevent="handleCreateFolder"
          >
            <PortalIcon name="folder" :size="16" />
            <input
              ref="newFolderInputEl"
              v-model="newFolderName"
              type="text"
              aria-label="Nova pasta"
              placeholder="Nome da nova pasta..."
              class="flex-1 min-h-[32px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-semibold"
              @keydown.esc.stop="creatingFolder = false"
            />
            <button
              type="submit"
              class="px-3 py-1.5 rounded-lg bg-brand text-brand-fg text-xs font-bold inline-flex items-center gap-1"
            >
              <PortalIcon name="check" :size="13" />
              <span>Criar</span>
            </button>
            <button type="button" class="p-1.5 text-slate-500" @click="creatingFolder = false">
              <PortalIcon name="x" :size="14" />
            </button>
          </form>

          <div v-if="loading && visibleNodes.length === 0" class="p-10 text-center text-xs text-slate-500">
            Carregando arquivos da nuvem corporativa…
          </div>
          <div v-else-if="visibleNodes.length === 0" class="p-10 text-center space-y-2">
            <p class="text-xs font-bold text-slate-600 dark:text-zinc-300">
              {{
                searchQuery
                  ? `Nenhum item encontrado para "${searchQuery}".`
                  : typeFilter !== 'all'
                    ? 'Nenhum arquivo deste tipo encontrado nesta área.'
                    : 'Esta pasta está vazia.'
              }}
            </p>
            <p v-if="canWriteInCurrentFolder && !searchQuery && typeFilter === 'all'" class="text-[11px] text-slate-500">
              Arraste arquivos do computador para cá ou clique em Enviar Arquivos / Nova Pasta.
            </p>
            <button
              v-if="typeFilter !== 'all' || searchQuery"
              type="button"
              class="px-3 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs font-bold"
              @click="
                typeFilter = 'all';
                searchQuery = '';
              "
            >
              Limpar filtros
            </button>
          </div>

          <!-- DETAILS TABLE VIEW -->
          <table v-else-if="viewMode === 'details'" class="w-full text-left border-collapse text-xs">
            <thead class="sticky top-0 bg-slate-50 dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 text-[11px] text-slate-500 font-bold">
              <tr>
                <th class="py-2 pl-3.5 pr-2">Nome</th>
                <th class="py-2 px-2 hidden md:table-cell w-28">Modificado</th>
                <th class="py-2 px-2 hidden sm:table-cell w-24">Tipo</th>
                <th class="py-2 px-2 hidden sm:table-cell w-20 text-right">Tamanho</th>
                <th class="py-2 px-2 hidden xl:table-cell w-36">Permissão</th>
                <th class="py-2 pl-2 pr-3.5 text-right">Ações</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-zinc-800/70">
              <tr
                v-for="node in visibleNodes"
                :key="node.id"
                :data-testid="`portal-node-${node.name}`"
                :draggable="canEditNode(node)"
                class="select-none transition-colors"
                :class="[
                  clipboard?.mode === 'cut' && clipboard.nodeId === node.id ? 'opacity-50' : '',
                  dragOverFolderId === node.id
                    ? 'bg-brand/20'
                    : selectedNodeId === node.id
                      ? 'bg-brand/10'
                      : 'hover:bg-slate-50/80 dark:hover:bg-zinc-900/50',
                ]"
                @click="selectedNodeId = node.id"
                @dblclick="openItem(node)"
                @contextmenu="openContextMenu($event, node)"
                @dragstart="handleItemDragStart($event, node)"
                @dragover="isFolder(node) && canEditNode(node) ? ($event.preventDefault(), (dragOverFolderId = node.id)) : null"
                @dragleave="dragOverFolderId === node.id ? (dragOverFolderId = null) : null"
                @drop="isFolder(node) ? handleDropOnFolder($event, node.id) : null"
              >
                <td class="py-2.5 pl-3.5 pr-2">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <span class="w-7 h-7 rounded-lg bg-slate-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                      <PortalIcon v-if="isFolder(node)" name="folder" :size="16" class="text-amber-500" />
                      <PortalIcon v-else-if="isSpreadsheet(node)" name="file-spreadsheet" :size="16" class="text-emerald-600" />
                      <PortalIcon v-else-if="isImageFile(node)" name="image" :size="16" class="text-violet-500" />
                      <PortalIcon v-else-if="isArchiveFile(node)" name="archive" :size="16" class="text-amber-600" />
                      <PortalIcon v-else name="file-text" :size="16" class="text-sky-500" />
                    </span>

                    <div class="min-w-0">
                      <input
                        v-if="renamingNodeId === node.id"
                        v-model="renameDraft"
                        type="text"
                        aria-label="Novo nome"
                        class="px-2 py-0.5 rounded border border-brand bg-white dark:bg-zinc-900 text-xs font-bold"
                        @blur="commitRename(node)"
                        @keydown.enter.stop="commitRename(node)"
                        @keydown.esc.stop="renamingNodeId = null"
                      />
                      <button
                        v-else
                        type="button"
                        class="font-bold text-slate-900 dark:text-[#fafafa] hover:underline truncate block text-left"
                        @click.stop="openItem(node)"
                      >
                        {{ node.name }}
                      </button>

                      <span
                        v-if="node.lockedByEmail || node.locked_by_email"
                        :data-testid="`portal-lock-${node.id}`"
                        class="mt-0.5 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 text-[10px] font-bold inline-flex items-center gap-1"
                      >
                        <PortalIcon name="lock" :size="10" />
                        <span>Em edição por {{ node.lockedByEmail || node.locked_by_email }}</span>
                      </span>
                    </div>
                  </div>
                </td>

                <td class="py-2.5 px-2 text-[11px] text-slate-500 hidden md:table-cell whitespace-nowrap">
                  {{ formatFriendlyDate(node.updatedAt || node.updated_at || node.createdAt || node.created_at) }}
                </td>

                <td class="py-2.5 px-2 text-[11px] text-slate-500 hidden sm:table-cell">
                  {{ getFileTypeLabel(node) }}
                </td>

                <td class="py-2.5 px-2 text-[11px] font-mono text-slate-500 hidden sm:table-cell text-right">
                  {{ isFolder(node) ? '' : formatBytes(node.sizeBytes || node.size_bytes) }}
                </td>

                <td class="py-2.5 px-2 text-[11px] text-slate-500 hidden xl:table-cell">
                  {{ getAccessLabel(node) }}
                </td>

                <td class="py-2.5 pl-2 pr-3.5 text-right whitespace-nowrap">
                  <div class="inline-flex items-center gap-1">
                    <template v-if="!isFolder(node)">
                      <button
                        type="button"
                        class="px-2 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 text-[11px] font-semibold inline-flex items-center gap-1"
                        @click.stop="handlePreviewFile(node)"
                      >
                        <PortalIcon name="eye" :size="12" />
                        <span>Visualizar</span>
                      </button>

                      <button
                        v-if="isSpreadsheet(node)"
                        type="button"
                        class="px-2 py-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold inline-flex items-center gap-1"
                        @click.stop="openSheetEditor(node)"
                      >
                        <PortalIcon name="file-spreadsheet" :size="12" />
                        <span>Planilha</span>
                      </button>

                      <button
                        v-if="canDownloadNode(node)"
                        type="button"
                        :data-testid="`portal-download-${node.id}`"
                        class="px-2 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 text-[11px] font-semibold inline-flex items-center gap-1"
                        @click.stop="handleDownloadFile(node)"
                      >
                        <PortalIcon name="download" :size="12" />
                        <span>Baixar</span>
                      </button>
                    </template>

                    <button
                      v-if="canDeleteNode(node)"
                      type="button"
                      :data-testid="`portal-delete-${node.id}`"
                      class="px-2 py-1 rounded-lg border border-rose-500/30 text-rose-600 dark:text-rose-400 text-[11px] font-semibold inline-flex items-center gap-1"
                      @click.stop="handleDeleteFile(node)"
                    >
                      <PortalIcon name="trash-2" :size="12" />
                      <span>Excluir</span>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- LARGE ICONS GRID VIEW -->
          <div v-else class="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div
              v-for="node in visibleNodes"
              :key="`grid-${node.id}`"
              :data-testid="`portal-node-${node.name}`"
              class="rounded-xl border p-3 flex flex-col items-center text-center gap-2 select-none transition-all"
              :class="
                selectedNodeId === node.id
                  ? 'border-brand/50 bg-brand/10'
                  : 'border-slate-200/70 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-900/50'
              "
              @click="selectedNodeId = node.id"
              @dblclick="openItem(node)"
              @contextmenu="openContextMenu($event, node)"
            >
              <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-zinc-800 flex items-center justify-center">
                <PortalIcon v-if="isFolder(node)" name="folder" :size="28" class="text-amber-500" />
                <PortalIcon v-else-if="isSpreadsheet(node)" name="file-spreadsheet" :size="28" class="text-emerald-600" />
                <PortalIcon v-else-if="isImageFile(node)" name="image" :size="28" class="text-violet-500" />
                <PortalIcon v-else-if="isArchiveFile(node)" name="archive" :size="28" class="text-amber-600" />
                <PortalIcon v-else name="file-text" :size="28" class="text-sky-500" />
              </div>

              <button
                type="button"
                class="text-xs font-bold text-slate-900 dark:text-[#fafafa] hover:underline break-all"
                @click.stop="openItem(node)"
              >
                {{ node.name }}
              </button>

              <span class="text-[10px] font-mono text-slate-500">
                {{ isFolder(node) ? 'Pasta' : formatBytes(node.sizeBytes || node.size_bytes) }}
              </span>

              <div v-if="!isFolder(node)" class="flex flex-wrap justify-center gap-1 pt-1">
                <button
                  type="button"
                  class="px-2 py-0.5 rounded-md border border-slate-200 dark:border-zinc-700 text-[10px] font-semibold"
                  @click.stop="handlePreviewFile(node)"
                >
                  Visualizar
                </button>
                <button
                  v-if="canDownloadNode(node)"
                  type="button"
                  :data-testid="`portal-download-${node.id}`"
                  class="px-2 py-0.5 rounded-md border border-slate-200 dark:border-zinc-700 text-[10px] font-semibold"
                  @click.stop="handleDownloadFile(node)"
                >
                  Baixar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Windows Status Bar -->
      <div class="px-3.5 py-2 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span>
          {{ visibleNodes.length }} {{ visibleNodes.length === 1 ? 'item' : 'itens' }}
          <template v-if="selectedNode"> • Selecionado: {{ selectedNode.name }}</template>
        </span>
        <span class="hidden sm:inline text-[10px]">
          Duplo clique: Abrir • Botão direito: Mais ações • Arraste arquivos para enviar
        </span>
      </div>
    </div>

    <!-- Floating Context Menu -->
    <div
      v-if="contextMenu"
      role="menu"
      :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
      class="fixed z-50 w-52 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl py-1.5 text-xs"
      @click.stop
    >
      <template v-if="contextMenu.node">
        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 font-bold flex items-center gap-2"
          @click="
            openItem(contextMenu.node);
            closeContextMenu();
          "
        >
          <PortalIcon name="eye" :size="13" />
          <span>{{ isFolder(contextMenu.node) ? 'Abrir pasta' : 'Visualizar / Abrir' }}</span>
        </button>

        <button
          v-if="!isFolder(contextMenu.node) && canDownloadNode(contextMenu.node)"
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2"
          @click="
            handleDownloadFile(contextMenu.node);
            closeContextMenu();
          "
        >
          <PortalIcon name="download" :size="13" />
          <span>Baixar</span>
        </button>

        <button
          v-if="canEditNode(contextMenu.node)"
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2"
          @click="startRename(contextMenu.node)"
        >
          <PortalIcon name="edit" :size="13" />
          <span>Renomear (F2)</span>
        </button>

        <button
          v-if="canEditNode(contextMenu.node)"
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2"
          @click="setClipboardAction('cut', contextMenu.node)"
        >
          <PortalIcon name="folder-open" :size="13" />
          <span>Recortar (Mover)</span>
        </button>

        <button
          v-if="canEditNode(contextMenu.node)"
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2"
          @click="setClipboardAction('copy', contextMenu.node)"
        >
          <PortalIcon name="copy" :size="13" />
          <span>Copiar</span>
        </button>

        <button
          v-if="canDeleteNode(contextMenu.node)"
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-2"
          @click="
            handleDeleteFile(contextMenu.node);
            closeContextMenu();
          "
        >
          <PortalIcon name="trash-2" :size="13" />
          <span>Excluir</span>
        </button>
      </template>

      <template v-else>
        <button
          v-if="canWriteInCurrentFolder"
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 font-semibold flex items-center gap-2"
          @click="startCreateFolder"
        >
          <PortalIcon name="folder-plus" :size="13" />
          <span>Nova Pasta</span>
        </button>
        <button
          v-if="canWriteInCurrentFolder && clipboard"
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 font-semibold text-sky-600 flex items-center gap-2"
          @click="
            pasteClipboard();
            closeContextMenu();
          "
        >
          <PortalIcon name="plus" :size="13" />
          <span>Colar aqui</span>
        </button>
        <button
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2"
          @click="
            loadDriveNodes();
            closeContextMenu();
          "
        >
          <PortalIcon name="refresh-cw" :size="13" />
          <span>Atualizar</span>
        </button>
      </template>
    </div>

    <!-- Centered Lightbox Preview Modal -->
    <div
      v-if="previewNode"
      data-testid="portal-preview-panel"
      class="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      @click="closePreview"
    >
      <div
        class="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] shadow-2xl overflow-hidden flex flex-col"
        @click.stop
      >
        <div class="px-4 py-3 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between gap-2 bg-slate-50 dark:bg-zinc-900">
          <div class="min-w-0">
            <span class="text-xs font-bold truncate block">Visualização Online — {{ previewNode.name }}</span>
            <span class="text-[11px] font-mono text-slate-500">
              {{ formatBytes(previewNode.sizeBytes || previewNode.size_bytes) }} • {{ getAccessLabel(previewNode) }}
            </span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <button
              v-if="canDownloadNode(previewNode)"
              type="button"
              class="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs font-semibold inline-flex items-center gap-1"
              @click="handleDownloadFile(previewNode)"
            >
              <PortalIcon name="download" :size="13" />
              <span>Baixar</span>
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 text-xs font-bold"
              @click="closePreview"
            >
              Fechar
            </button>
          </div>
        </div>
        <div class="p-4 flex-1 overflow-auto bg-slate-100/70 dark:bg-zinc-950 flex justify-center items-center min-h-[260px]">
          <img
            v-if="previewObjectUrl && previewContentType.startsWith('image/')"
            :src="previewObjectUrl"
            :alt="previewNode.name"
            class="max-w-full max-h-[70vh] rounded-lg object-contain shadow"
          />
          <iframe
            v-else-if="previewObjectUrl && previewContentType.includes('pdf')"
            :src="previewObjectUrl"
            :title="previewNode.name"
            class="w-full h-[70vh] rounded-lg bg-white"
          />
          <pre
            v-else-if="previewTextContent !== null"
            class="w-full max-h-[65vh] overflow-auto rounded-lg bg-white dark:bg-zinc-900 p-4 text-xs font-mono whitespace-pre-wrap"
          >{{ previewTextContent }}</pre>
          <p v-else class="text-xs text-slate-500 py-6">
            Arquivo carregado em visualização segura ({{ previewContentType || 'arquivo' }}).
          </p>
        </div>
      </div>
    </div>

    <!-- Collapsible Embedded Nexus Sheets Live Co-Editor -->
    <div v-if="!planUpgradeNotice" class="station-panel overflow-hidden">
      <div class="px-4 py-3 bg-slate-50/70 dark:bg-zinc-900/50 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <PortalIcon name="file-spreadsheet" :size="17" class="text-emerald-600" />
          <h3 class="text-xs sm:text-sm font-bold text-slate-900 dark:text-[#fafafa]">
            Nexus Sheets Live — {{ activeSheetNode?.name || 'Planilhas Colaborativas' }}
          </h3>
          <span v-if="activeSheetNode" class="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold">
            rev #{{ sheetRev }}
          </span>
          <span
            v-if="sheetPeers.length > 0"
            class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300 inline-flex items-center gap-1"
          >
            <PortalIcon name="users" :size="11" />
            <span>{{ sheetPeers.length }} online</span>
          </span>
        </div>

        <div class="flex items-center gap-1.5">
          <button
            v-if="showSheetEditor && activeSheetNode && canDownloadNode(activeSheetNode)"
            type="button"
            class="min-h-[32px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 text-xs font-semibold"
            @click="exportActiveSheet('xlsx')"
          >
            Exportar .xlsx
          </button>
          <button
            v-if="showSheetEditor && activeSheetNode"
            type="button"
            :disabled="sheetSaving"
            class="min-h-[32px] px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
            @click="saveActiveSheet"
          >
            <PortalIcon name="save" :size="13" />
            <span>{{ sheetSaving ? 'Salvando...' : 'Salvar Planilha' }}</span>
          </button>
          <button
            type="button"
            class="min-h-[32px] px-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold inline-flex items-center gap-1"
            @click="showSheetEditor = !showSheetEditor"
          >
            <PortalIcon v-if="showSheetEditor" name="chevron-up" :size="13" />
            <PortalIcon v-else name="chevron-down" :size="13" />
            <span>{{ showSheetEditor ? 'Recolher' : 'Abrir Editor' }}</span>
          </button>
        </div>
      </div>

      <div v-if="showSheetEditor" class="p-4 border-t border-slate-200 dark:border-zinc-800 space-y-3">
        <!-- Formula Bar -->
        <div class="flex items-center gap-2 bg-slate-50 dark:bg-zinc-900 p-2 rounded-xl border border-slate-200 dark:border-zinc-800">
          <span class="px-2.5 py-1 rounded bg-white dark:bg-zinc-800 font-mono text-xs font-bold border border-slate-200 dark:border-zinc-700">
            {{ selectedCellRef }}
          </span>
          <span class="font-mono text-xs font-bold text-slate-400">fx</span>
          <input
            v-model="formulaInput"
            type="text"
            aria-label="Barra de Fórmulas da Planilha"
            data-testid="portal-formula-input"
            placeholder="Valor ou fórmula (=SOMA(A1:A2))"
            class="flex-1 min-h-[36px] px-3 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 font-mono text-xs"
            @input="applySheetCellInput(selectedCellRef, formulaInput)"
          />
        </div>

        <!-- Grid -->
        <div class="overflow-x-auto border border-slate-200 dark:border-zinc-800 rounded-xl">
          <table class="w-full border-collapse text-xs font-mono">
            <thead>
              <tr class="bg-slate-100 dark:bg-zinc-900">
                <th class="w-10 border border-slate-200 dark:border-zinc-800 py-1 text-center">#</th>
                <th
                  v-for="col in ['A', 'B', 'C', 'D']"
                  :key="col"
                  class="min-w-[110px] border border-slate-200 dark:border-zinc-800 py-1 px-2 text-center font-bold"
                >
                  {{ col }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="rowNum in [1, 2, 3, 4, 5]" :key="rowNum">
                <td class="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-center font-bold text-slate-500">
                  {{ rowNum }}
                </td>
                <td
                  v-for="col in ['A', 'B', 'C', 'D']"
                  :key="`${col}${rowNum}`"
                  :data-testid="`portal-cell-${col}${rowNum}`"
                  class="border border-slate-200 dark:border-zinc-800 p-0 relative"
                  @click="selectSheetCell(`${col}${rowNum}`)"
                >
                  <input
                    type="text"
                    :aria-label="`Célula ${col}${rowNum}`"
                    :value="
                      selectedCellRef === `${col}${rowNum}`
                        ? formulaInput
                        : evaluatedCurrentTab?.cells?.[`${col}${rowNum}`]?.value ?? ''
                    "
                    class="w-full h-8 px-2 bg-transparent focus:outline-none text-xs font-mono"
                    @focus="selectSheetCell(`${col}${rowNum}`)"
                    @input="
                      (e) => {
                        formulaInput = e.target.value;
                        applySheetCellInput(`${col}${rowNum}`, e.target.value);
                      }
                    "
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

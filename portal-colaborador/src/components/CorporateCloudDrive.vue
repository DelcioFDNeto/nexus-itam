<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PortalIcon from './PortalIcon.vue';
import { GATEWAY_BASE_URL, getStoredSession, portalApi } from '../services/nexusApi';
import { evaluateCellValue, evaluateSheetFormulas } from '../utils/sheetFormulaEngine.js';
import {
  collectEntriesFromDataTransfer,
  collectFilesFromInputList,
  uploadFolderTreeToVault,
} from '../utils/folderUpload.js';
import {
  classifyPreviewKind,
  columnIndexToLetters,
  openPdfPreviewDocument,
  parseExcelPreview,
  parseWordPreview,
} from '../utils/documentPreview.js';

const props = defineProps({
  user: { type: Object, default: () => ({}) },
  userEmail: { type: String, default: '' },
  userDepartment: { type: String, default: '' },
  assets: { type: Array, default: () => [] },
  wsState: { type: String, default: 'disconnected' },
  liveSheetEvent: { type: Object, default: null },
  streamHandle: { type: Object, default: null },
});

const nodes = ref([]);
const loading = ref(false);
const uploadingCount = ref(0);
const uploadProgress = ref(null);
const errorBanner = ref('');
const statusToast = ref('');
const planUpgradeNotice = ref('');

// Archive Extraction Modal (.zip / .rar / .tar / .tar.gz / .tgz)
const extractModalNode = ref(null);
const extractMode = ref('subfolder');
const extractFolderName = ref('');
const extractConflictPolicy = ref('rename');
const extractPassword = ref('');
const extractingNodeId = ref(null);

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

// Real Inline Preview Lightbox State (PDF Canvas, Word HTML, Excel Multi-Aba, Imagem e Texto)
const previewNode = ref(null);
const previewKind = ref('unknown'); // 'pdf' | 'excel' | 'word' | 'image' | 'text' | 'unknown'
const previewLoading = ref(false);
const previewError = ref('');
const previewContentType = ref('');
const previewObjectUrl = ref(null);
const previewTextContent = ref(null);
const previewZoom = ref(1);

// PDF Canvas Preview State
const previewPdfPages = ref([]);
const previewPdfTotalPages = ref(0);
const previewPdfTruncated = ref(false);
const previewPdfFallbackIframe = ref(false);
let activePdfHandle = null;
const pdfCanvasMap = new Map();
let pdfRenderSeq = 0;

// Word Preview State
const previewWordHtml = ref('');
const previewWordNote = ref('');

// Excel Preview State
const previewExcelSheets = ref([]);
const previewExcelTabIdx = ref(0);
const previewExcelSearch = ref('');

// Desktop Auto-Sync via Agente Windows (`nexusvault://`) + Guia do Colaborador
const AGENT_VERSION_LABEL = '3.5.0';
const AGENT_DOWNLOAD_URL = 'https://itam-nexus.web.app/downloads/NexusAgent.zip';
const desktopSyncSession = ref(null);
const desktopSyncBusy = ref(false);
const desktopAgentSlowHint = ref(false);
const showAgentGuide = ref(false);
const downloadingAgentPkg = ref(false);
const selectedAgentAssetId = ref('');
let desktopPollTimer = null;
let desktopHintTimer = null;

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
const folderInputEl = ref(null);
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
  return !isFolder(node) && /\.(zip|rar|7z|tar|gz|tgz)$/i.test(String(node?.name || ''));
}

function isExtractableArchive(node) {
  return !isFolder(node) && /\.(zip|rar|tar|tgz|tar\.gz)$/i.test(String(node?.name || '').trim());
}

function stripArchiveExtensionLabel(fileName) {
  const clean = String(fileName || '').trim();
  const stripped = clean.replace(/(\.tar\.gz|\.tgz|\.zip|\.rar|\.tar)$/i, '').trim();
  return stripped || 'Extraido';
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

const custodyComputerAssets = computed(() => {
  const list = Array.isArray(props.assets) ? props.assets : [];
  const computers = list.filter((a) =>
    /note|laptop|comp|desk|serv|workstation|all-in-one|pc/i.test(String(a?.type || '')),
  );
  return computers.length > 0 ? computers : list;
});

const activeAgentAsset = computed(() => {
  const list = custodyComputerAssets.value;
  if (!list.length) return null;
  if (selectedAgentAssetId.value) {
    const found = list.find((a) => String(a.id || a.internal_id || a.internalId) === selectedAgentAssetId.value);
    if (found) return found;
  }
  return list[0];
});

const activeAgentPatrimony = computed(() =>
  String(activeAgentAsset.value?.internal_id || activeAgentAsset.value?.internalId || '').trim(),
);

const activeExcelPreviewSheet = computed(
  () => previewExcelSheets.value[previewExcelTabIdx.value] || previewExcelSheets.value[0] || null,
);

const filteredExcelPreviewRows = computed(() => {
  const sheet = activeExcelPreviewSheet.value;
  if (!sheet) return [];
  const q = previewExcelSearch.value.trim().toLowerCase();
  if (!q) return sheet.rows || [];
  return (sheet.rows || []).filter((r) =>
    (r.cells || []).some((c) => String(c || '').toLowerCase().includes(q)),
  );
});

const dynamicSheetColumns = computed(() => {
  const cells = currentTab.value?.cells || {};
  let maxColIdx = 7; // mínimo A..H (8 colunas)
  for (const key of Object.keys(cells)) {
    const match = /^([A-Z]+)(\d+)$/i.exec(key);
    if (!match) continue;
    const letters = match[1].toUpperCase();
    let idx = 0;
    for (let i = 0; i < letters.length; i += 1) {
      idx = idx * 26 + (letters.charCodeAt(i) - 64);
    }
    if (idx - 1 > maxColIdx) maxColIdx = Math.min(idx - 1, 25);
  }
  const cols = [];
  for (let c = 0; c <= maxColIdx; c += 1) cols.push(columnIndexToLetters(c));
  return cols;
});

const dynamicSheetRows = computed(() => {
  const cells = currentTab.value?.cells || {};
  let maxRow = 12; // mínimo 12 linhas
  for (const key of Object.keys(cells)) {
    const match = /^[A-Z]+(\d+)$/i.exec(key);
    if (!match) continue;
    const r = Number(match[1]);
    if (r > maxRow) maxRow = Math.min(r, 100);
  }
  return Array.from({ length: maxRow }, (_, i) => i + 1);
});

function setPdfCanvasRef(pageNum, el) {
  if (el) {
    pdfCanvasMap.set(pageNum, el);
  } else {
    pdfCanvasMap.delete(pageNum);
  }
}

async function renderPdfPagesNow() {
  if (!activePdfHandle || previewPdfPages.value.length === 0) return;
  const seq = ++pdfRenderSeq;
  await nextTick();
  const scale = Math.max(0.65, Math.min(2.2, Number(previewZoom.value || 1) * 1.15));
  for (const pageNum of previewPdfPages.value) {
    if (seq !== pdfRenderSeq || !activePdfHandle) return;
    const canvas = pdfCanvasMap.get(pageNum);
    if (!canvas) continue;
    try {
      await activePdfHandle.renderPage(pageNum, canvas, scale);
    } catch {
      /* ignore individual page render error */
    }
  }
}

function adjustPreviewZoom(delta) {
  const next = Math.max(0.75, Math.min(2, Number((previewZoom.value + delta).toFixed(2))));
  if (next === previewZoom.value) return;
  previewZoom.value = next;
  if (previewKind.value === 'pdf' && activePdfHandle && !previewPdfFallbackIframe.value) {
    renderPdfPagesNow();
  }
}

function resetPreviewZoom() {
  previewZoom.value = 1;
  if (previewKind.value === 'pdf' && activePdfHandle && !previewPdfFallbackIframe.value) {
    renderPdfPagesNow();
  }
}

function closePreview() {
  pdfRenderSeq += 1;
  if (activePdfHandle) {
    activePdfHandle.destroy();
    activePdfHandle = null;
  }
  pdfCanvasMap.clear();
  if (previewObjectUrl.value && typeof URL?.revokeObjectURL === 'function') {
    URL.revokeObjectURL(previewObjectUrl.value);
  }
  previewObjectUrl.value = null;
  previewTextContent.value = null;
  previewContentType.value = '';
  previewKind.value = 'unknown';
  previewLoading.value = false;
  previewError.value = '';
  previewZoom.value = 1;
  previewPdfPages.value = [];
  previewPdfTotalPages.value = 0;
  previewPdfTruncated.value = false;
  previewPdfFallbackIframe.value = false;
  previewWordHtml.value = '';
  previewWordNote.value = '';
  previewExcelSheets.value = [];
  previewExcelTabIdx.value = 0;
  previewExcelSearch.value = '';
  previewNode.value = null;
}

function parseFilenameFromDisposition(disposition, fallback) {
  const m = /filename\*?=(?:UTF-8''|")?([^";\r\n"]+)/i.exec(String(disposition || ''));
  if (m && m[1]) {
    try {
      return decodeURIComponent(m[1].trim());
    } catch {
      return m[1].trim();
    }
  }
  return fallback;
}

async function handleDownloadConfiguredAgent() {
  downloadingAgentPkg.value = true;
  errorBanner.value = '';
  const target = activeAgentAsset.value;
  const assetId = target?.id ? String(target.id) : '';
  const patrimony = activeAgentPatrimony.value;
  try {
    const res = await portalApi.downloadAgentPackage({ assetId, patrimony });
    if (res?.blob) {
      const fallbackName = patrimony ? `NexusAgent-${patrimony}.zip` : 'NexusAgent-Configurado.zip';
      const fileName = parseFilenameFromDisposition(res.contentDisposition, fallbackName);
      triggerBrowserDownload(res.blob, fileName);
      const tagNote = res.agentPatrimony || patrimony;
      notifySuccess(
        tagNote
          ? `Pacote ${fileName} (v${res.agentVersion || AGENT_VERSION_LABEL}) baixado com a configuração da empresa e do ativo ${tagNote}! Extraia a pasta e abra o NexusAgent.exe.`
          : `Pacote ${fileName} (v${res.agentVersion || AGENT_VERSION_LABEL}) baixado com a configuração da empresa! Extraia a pasta e abra o NexusAgent.exe.`,
      );
      return;
    }
  } catch (err) {
    errorBanner.value =
      err?.message || 'Não foi possível gerar o pacote personalizado agora. Usando pacote padrão.';
    if (typeof window !== 'undefined') {
      window.open(AGENT_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
    }
  } finally {
    downloadingAgentPkg.value = false;
  }
}

function stopDesktopSyncPolling() {
  if (desktopPollTimer) {
    clearInterval(desktopPollTimer);
    desktopPollTimer = null;
  }
  if (desktopHintTimer) {
    clearTimeout(desktopHintTimer);
    desktopHintTimer = null;
  }
}

function buildVaultProtocolUrl(sessionToken) {
  const apiBase = String(GATEWAY_BASE_URL || 'https://itam-api-164-152-195-199.sslip.io').replace(/\/$/, '');
  return `nexusvault://edit?api=${encodeURIComponent(apiBase)}&token=${encodeURIComponent(sessionToken)}`;
}

function launchVaultProtocol(protocolUrl) {
  if (typeof document === 'undefined' || !protocolUrl) return;
  const link = document.createElement('a');
  link.href = protocolUrl;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 300);
}

async function pollDesktopSessionOnce() {
  const cur = desktopSyncSession.value;
  if (!cur?.sessionToken) return;
  try {
    const st = await portalApi.getStorageDesktopSessionStatus(cur.sessionToken);
    if (!desktopSyncSession.value || desktopSyncSession.value.sessionToken !== cur.sessionToken) return;
    const prevSyncCount = Number(desktopSyncSession.value.syncCount || 0);
    desktopSyncSession.value = {
      ...desktopSyncSession.value,
      status: st.status || desktopSyncSession.value.status,
      syncCount: Number(st.syncCount ?? prevSyncCount),
      currentVersion: Number(st.currentVersion ?? st.lastVersion ?? desktopSyncSession.value.currentVersion),
      lastSyncedAt: st.lastSyncedAt || desktopSyncSession.value.lastSyncedAt,
      openedAt: st.openedAt || desktopSyncSession.value.openedAt,
      closedAt: st.closedAt || null,
    };
    if (st.status === 'opened') {
      desktopAgentSlowHint.value = false;
    }
    if (Number(st.syncCount || 0) > prevSyncCount) {
      notifySuccess(`"${cur.fileName}" sincronizado automaticamente na VPS (v${st.currentVersion || st.lastVersion}).`);
      await loadDriveNodes();
    }
    if (st.status === 'closed' || st.status === 'expired') {
      stopDesktopSyncPolling();
      await loadDriveNodes();
    }
  } catch {
    /* keep polling until user closes */
  }
}

async function handleEditOnDesktop(node) {
  if (!node || isFolder(node) || !canEditNode(node)) return;
  errorBanner.value = '';
  desktopSyncBusy.value = true;
  desktopAgentSlowHint.value = false;
  stopDesktopSyncPolling();
  try {
    const created = await portalApi.createStorageDesktopSession(node.id);
    const protocolUrl = buildVaultProtocolUrl(created.sessionToken);
    desktopSyncSession.value = {
      sessionId: created.sessionId,
      sessionToken: created.sessionToken,
      nodeId: node.id,
      fileName: created.fileName || node.name,
      currentVersion: Number(created.currentVersion || node.currentVersion || 1),
      status: 'pending',
      syncCount: 0,
      lastSyncedAt: null,
      openedAt: null,
      protocolUrl,
    };
    launchVaultProtocol(protocolUrl);
    desktopHintTimer = setTimeout(() => {
      if (desktopSyncSession.value?.status === 'pending') {
        desktopAgentSlowHint.value = true;
      }
    }, 6500);
    desktopPollTimer = setInterval(pollDesktopSessionOnce, 2500);
    await loadDriveNodes();
  } catch (err) {
    if (err?.status === 423) {
      errorBanner.value = err?.message || 'Este arquivo está sendo editado por outro colega no momento.';
    } else {
      errorBanner.value = err?.message || 'Não foi possível iniciar a edição sincronizada no computador.';
    }
  } finally {
    desktopSyncBusy.value = false;
  }
}

async function handleCloseDesktopSession() {
  const cur = desktopSyncSession.value;
  if (!cur?.sessionToken) {
    desktopSyncSession.value = null;
    stopDesktopSyncPolling();
    return;
  }
  desktopSyncBusy.value = true;
  try {
    await portalApi.closeStorageDesktopSession(cur.sessionToken);
    stopDesktopSyncPolling();
    desktopSyncSession.value = null;
    desktopAgentSlowHint.value = false;
    notifySuccess(`Sessão de "${cur.fileName}" encerrada e arquivo desbloqueado.`);
    await loadDriveNodes();
  } catch (err) {
    errorBanner.value = err?.message || 'Não foi possível encerrar a sessão.';
  } finally {
    desktopSyncBusy.value = false;
  }
}

function dismissDesktopSessionModal() {
  stopDesktopSyncPolling();
  desktopSyncSession.value = null;
  desktopAgentSlowHint.value = false;
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
  if (String(node.name || '').toLowerCase().endsWith('.nexusheet')) {
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

  const collected = await collectEntriesFromDataTransfer(event.dataTransfer);
  if (collected.hasDirectories || collected.folderPaths.length > 0) {
    await uploadFolderTree(collected, currentFolderId.value);
    return;
  }
  if (collected.files.length > 0) {
    await uploadMultipleFiles(
      collected.files.map((item) => item.file),
      currentFolderId.value,
    );
    return;
  }
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

  const draggedId = event.dataTransfer?.getData('application/x-nexus-portal-node');
  if (draggedId) {
    if (draggedId === targetFolderId) return;
    try {
      await portalApi.updateStorageNode(draggedId, { parentId: targetFolderId || null });
      notifySuccess('Item movido para a pasta.');
      await loadDriveNodes();
    } catch (err) {
      errorBanner.value = err?.message || 'Não foi possível mover este item.';
    }
    return;
  }

  const collected = await collectEntriesFromDataTransfer(event.dataTransfer);
  if (collected.hasDirectories || collected.folderPaths.length > 0) {
    await uploadFolderTree(collected, targetFolderId);
    return;
  }
  if (collected.files.length > 0) {
    await uploadMultipleFiles(
      collected.files.map((item) => item.file),
      targetFolderId,
    );
    return;
  }
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length > 0) {
    await uploadMultipleFiles(files, targetFolderId);
  }
}

function handleExplorerKeydown(event) {
  const tag = String(event.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (event.key === 'Escape') {
    if (extractModalNode.value && extractingNodeId.value !== extractModalNode.value.id) {
      extractModalNode.value = null;
      return;
    }
    if (showAgentGuide.value) {
      showAgentGuide.value = false;
      return;
    }
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

async function uploadFolderTree(collected, targetFolderId = currentFolderId.value) {
  const files = collected?.files || [];
  const folderPaths = collected?.folderPaths || [];
  if (files.length === 0 && folderPaths.length === 0) return;

  errorBanner.value = '';
  uploadingCount.value = files.length || folderPaths.length;
  uploadProgress.value = {
    phase: folderPaths.length > 0 ? 'folders' : 'files',
    current: 0,
    total: folderPaths.length || files.length,
    currentName: folderPaths[0] || files[0]?.relativePath || '',
    filesDone: 0,
    filesTotal: files.length,
  };

  try {
    const summary = await uploadFolderTreeToVault({
      files,
      folderPaths,
      targetParentId: targetFolderId || null,
      existingNodes: nodes.value,
      createFolderFn: (payload) => portalApi.createStorageFolder(payload),
      uploadFileFn: (file, opts) => portalApi.uploadStorageFile(file, opts),
      onProgress: (p) => {
        uploadProgress.value = p;
      },
    });

    if (summary.filesUploaded > 0 || summary.foldersCreated > 0) {
      await loadDriveNodes();
      notifySuccess(
        `Pasta enviada: ${summary.filesUploaded} arquivo(s) em ${summary.totalFolders || 1} pasta(s).`,
      );
    }
    if (summary.errors.length > 0) {
      const firstErr = summary.errors[0];
      errorBanner.value = `${summary.errors.length} item(ns) falharam no envio (ex.: ${firstErr.path}: ${firstErr.message}).`;
    }
  } catch (err) {
    errorBanner.value = err?.message || 'Falha ao enviar pasta para a nuvem.';
  } finally {
    uploadProgress.value = null;
    uploadingCount.value = 0;
  }
}

async function handleUploadFolder(event) {
  const collected = collectFilesFromInputList(event?.target?.files || []);
  if (collected.files.length > 0 || collected.folderPaths.length > 0) {
    await uploadFolderTree(collected, currentFolderId.value);
  }
  if (event?.target) event.target.value = '';
}

function openExtractModal(node) {
  if (!node || !isExtractableArchive(node) || !canEditNode(node) || !canDownloadNode(node)) return;
  contextMenu.value = null;
  extractModalNode.value = node;
  extractMode.value = 'subfolder';
  extractFolderName.value = stripArchiveExtensionLabel(node.name);
  extractConflictPolicy.value = 'rename';
  extractPassword.value = '';
}

async function handleSubmitExtract() {
  const node = extractModalNode.value;
  if (!node?.id) return;
  const cleanName = extractFolderName.value.trim();
  if (
    extractMode.value === 'subfolder' &&
    (!cleanName || cleanName.includes('..') || cleanName.includes('/') || cleanName.includes('\\'))
  ) {
    errorBanner.value = 'Informe um nome de pasta válido (sem barras ou "..").';
    return;
  }

  errorBanner.value = '';
  extractingNodeId.value = node.id;
  try {
    const res = await portalApi.extractStorageArchive(node.id, {
      mode: extractMode.value,
      folderName: extractMode.value === 'subfolder' ? cleanName : undefined,
      conflictPolicy: extractConflictPolicy.value,
      password: extractPassword.value || undefined,
    });
    extractModalNode.value = null;
    extractPassword.value = '';
    await loadDriveNodes();

    const filesCount = Number(res?.filesExtracted || 0);
    const foldersCount = Number(res?.foldersCreated || 0);
    const blockedCount = Array.isArray(res?.blockedExecutables) ? res.blockedExecutables.length : 0;
    notifySuccess(
      `"${node.name}" descompactado: ${filesCount} arquivo(s) e ${foldersCount} pasta(s)${
        blockedCount > 0 ? ` (${blockedCount} executável bloqueado por segurança)` : ''
      }.`,
    );

    if (extractMode.value === 'subfolder' && res?.destinationFolder?.id) {
      navigateTo(res.destinationFolder.id);
    }
  } catch (err) {
    errorBanner.value = err?.message || 'Não foi possível descompactar este arquivo.';
  } finally {
    extractingNodeId.value = null;
  }
}

async function handlePreviewFile(node) {
  errorBanner.value = '';
  closePreview();
  previewNode.value = node;
  previewLoading.value = true;
  previewError.value = '';

  try {
    const res = await portalApi.previewStorageFile(node.id);
    if (!previewNode.value || previewNode.value.id !== node.id) return;

    const ct = res?.contentType || node.mimeType || node.mime_type || 'application/octet-stream';
    previewContentType.value = ct;
    const kind = classifyPreviewKind(node.name, ct);
    previewKind.value = kind;

    const rawBuf =
      res?.arrayBuffer ||
      (res?.blob && typeof res.blob.arrayBuffer === 'function' ? await res.blob.arrayBuffer() : null);

    if (kind === 'pdf') {
      if (res?.blob && typeof URL?.createObjectURL === 'function') {
        previewObjectUrl.value = URL.createObjectURL(res.blob);
      }
      if (rawBuf && rawBuf.byteLength > 0) {
        try {
          const handle = await openPdfPreviewDocument(rawBuf);
          if (!previewNode.value || previewNode.value.id !== node.id) {
            handle.destroy();
            return;
          }
          activePdfHandle = handle;
          previewPdfTotalPages.value = handle.numPages;
          previewPdfTruncated.value = handle.truncated;
          previewPdfPages.value = Array.from({ length: handle.renderablePages }, (_, i) => i + 1);
          previewPdfFallbackIframe.value = false;
          previewLoading.value = false;
          await renderPdfPagesNow();
          return;
        } catch {
          // Fallback limpo (ex.: ambiente sem canvas 2D ou PDF protegido)
          previewPdfFallbackIframe.value = true;
        }
      } else {
        previewPdfFallbackIframe.value = true;
      }
    } else if (kind === 'excel') {
      if (rawBuf && rawBuf.byteLength > 0) {
        const parsed = await parseExcelPreview(rawBuf, node.name);
        if (!previewNode.value || previewNode.value.id !== node.id) return;
        previewExcelSheets.value = parsed.sheets || [];
        previewExcelTabIdx.value = 0;
        previewExcelSearch.value = '';
      } else {
        previewError.value = 'Planilha vazia ou sem conteúdo legível.';
      }
    } else if (kind === 'word') {
      if (rawBuf && rawBuf.byteLength > 0) {
        const parsed = await parseWordPreview(rawBuf, node.name);
        if (!previewNode.value || previewNode.value.id !== node.id) return;
        previewWordHtml.value = parsed.html || '';
        previewWordNote.value = parsed.note || '';
      } else {
        previewError.value = 'Documento Word vazio ou sem conteúdo legível.';
      }
    } else if (kind === 'image') {
      if (res?.blob && typeof URL?.createObjectURL === 'function') {
        previewObjectUrl.value = URL.createObjectURL(res.blob);
      }
    } else if (kind === 'text') {
      if (res?.blob && typeof res.blob.text === 'function') {
        previewTextContent.value = await res.blob.text();
      } else if (rawBuf) {
        previewTextContent.value = new TextDecoder('utf-8', { fatal: false }).decode(rawBuf);
      }
    } else if (res?.blob && typeof URL?.createObjectURL === 'function') {
      previewObjectUrl.value = URL.createObjectURL(res.blob);
    }
  } catch (err) {
    previewError.value = err?.message || 'Falha ao abrir visualização online deste arquivo.';
    errorBanner.value = previewError.value;
  } finally {
    previewLoading.value = false;
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
        } else if (frame?.event === 'storage.node.synced') {
          loadDriveNodes();
          pollDesktopSessionOnce();
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
  stopDesktopSyncPolling();
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

        <button
          type="button"
          data-testid="portal-open-agent-guide"
          class="px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 inline-flex items-center gap-1"
          @click="showAgentGuide = true"
        >
          <PortalIcon name="monitor" :size="12" />
          <span>Como editar no Excel</span>
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

            <label
              title="Enviar uma pasta inteira mantendo todas as subpastas (sem precisar compactar em ZIP ou RAR)"
              class="min-h-[34px] px-3 py-1 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <PortalIcon name="folder-up" :size="14" />
              <span>Enviar Pasta</span>
              <input
                ref="folderInputEl"
                type="file"
                webkitdirectory
                directory
                multiple
                aria-label="Enviar pasta inteira para a nuvem"
                class="hidden"
                @change="handleUploadFolder"
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
                v-if="!isFolder(selectedNode)"
                type="button"
                :disabled="desktopSyncBusy"
                title="Abrir no Excel/programa do computador com salvamento automático na VPS"
                class="min-h-[34px] px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
                @click="handleEditOnDesktop(selectedNode)"
              >
                <PortalIcon name="monitor" :size="13" />
                <span>Editar no PC</span>
              </button>

              <button
                v-if="!isFolder(selectedNode) && isExtractableArchive(selectedNode) && canDownloadNode(selectedNode)"
                type="button"
                :disabled="extractingNodeId === selectedNode.id"
                title="Descompactar arquivo .ZIP, .RAR ou .TAR diretamente na nuvem"
                class="min-h-[34px] px-2.5 py-1 rounded-lg bg-amber-600 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
                @click="openExtractModal(selectedNode)"
              >
                <PortalIcon name="package-open" :size="13" />
                <span>{{ extractingNodeId === selectedNode.id ? 'Extraindo...' : 'Descompactar' }}</span>
              </button>

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

      <!-- Folder Upload Progress Bar -->
      <div
        v-if="uploadProgress"
        data-testid="portal-folder-upload-progress"
        class="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/25 space-y-1.5 text-xs text-amber-900 dark:text-amber-200"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="font-bold inline-flex items-center gap-1.5 min-w-0">
            <PortalIcon name="folder-up" :size="14" />
            <span class="truncate">
              {{
                uploadProgress.phase === 'folders'
                  ? `Criando subpastas (${uploadProgress.current}/${uploadProgress.total}): ${uploadProgress.currentName}`
                  : `Enviando arquivo ${uploadProgress.current}/${uploadProgress.total}: ${uploadProgress.currentName}`
              }}
            </span>
          </span>
          <span class="font-mono text-[11px] font-bold">
            {{ uploadProgress.total > 0 ? Math.min(100, Math.round((uploadProgress.current / uploadProgress.total) * 100)) : 0 }}%
          </span>
        </div>
        <div class="w-full h-1.5 rounded-full bg-amber-500/20 overflow-hidden">
          <div
            class="h-full rounded-full bg-amber-600 transition-all duration-150"
            :style="{
              width: `${uploadProgress.total > 0 ? Math.min(100, Math.round((uploadProgress.current / uploadProgress.total) * 100)) : 5}%`,
            }"
          />
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
            <p class="text-xs font-bold">Solte arquivos ou pastas inteiras aqui para enviar</p>
            <p class="text-[11px] text-slate-600 dark:text-zinc-300">Subpastas são criadas automaticamente na nuvem</p>
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
              Arraste arquivos ou pastas inteiras do computador para cá ou clique em Enviar Arquivos, Enviar Pasta ou Nova Pasta.
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
                        v-if="canEditNode(node)"
                        type="button"
                        :data-testid="`portal-desktop-edit-${node.id}`"
                        :disabled="desktopSyncBusy"
                        title="Abrir no Excel, Word ou programa padrão do PC — cada Ctrl+S salva automaticamente na VPS"
                        class="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold inline-flex items-center gap-1 hover:opacity-95 disabled:opacity-50"
                        @click.stop="handleEditOnDesktop(node)"
                      >
                        <PortalIcon name="monitor" :size="12" />
                        <span>Editar no PC</span>
                      </button>

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
                        title="Editor rápido na web (para edição completa com fórmulas e macros, use Editar no PC)"
                        class="px-2 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 text-[11px] font-semibold inline-flex items-center gap-1"
                        @click.stop="openSheetEditor(node)"
                      >
                        <PortalIcon name="file-spreadsheet" :size="12" />
                        <span>Web</span>
                      </button>

                      <button
                        v-if="canEditNode(node) && canDownloadNode(node) && isExtractableArchive(node)"
                        type="button"
                        :data-testid="`portal-extract-${node.id}`"
                        :disabled="extractingNodeId === node.id"
                        title="Descompactar arquivo diretamente na nuvem"
                        class="px-2 py-1 rounded-lg bg-amber-600 text-white text-[11px] font-bold inline-flex items-center gap-1 hover:opacity-95 disabled:opacity-50"
                        @click.stop="openExtractModal(node)"
                      >
                        <PortalIcon name="package-open" :size="12" />
                        <span>Descompactar</span>
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
                  v-if="canEditNode(node)"
                  type="button"
                  class="px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-bold"
                  @click.stop="handleEditOnDesktop(node)"
                >
                  Editar no PC
                </button>
                <button
                  type="button"
                  class="px-2 py-0.5 rounded-md border border-slate-200 dark:border-zinc-700 text-[10px] font-semibold"
                  @click.stop="handlePreviewFile(node)"
                >
                  Visualizar
                </button>
                <button
                  v-if="canEditNode(node) && canDownloadNode(node) && isExtractableArchive(node)"
                  type="button"
                  class="px-2 py-0.5 rounded-md bg-amber-600 text-white text-[10px] font-bold"
                  @click.stop="openExtractModal(node)"
                >
                  Descompactar
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
          v-if="!isFolder(contextMenu.node) && canEditNode(contextMenu.node)"
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-bold flex items-center gap-2"
          @click="
            handleEditOnDesktop(contextMenu.node);
            closeContextMenu();
          "
        >
          <PortalIcon name="monitor" :size="13" />
          <span>Editar no PC (Auto-Sync)</span>
        </button>

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
          v-if="!isFolder(contextMenu.node) && canEditNode(contextMenu.node) && canDownloadNode(contextMenu.node) && isExtractableArchive(contextMenu.node)"
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-amber-500/10 text-amber-700 dark:text-amber-300 font-bold flex items-center gap-2"
          @click="openExtractModal(contextMenu.node)"
        >
          <PortalIcon name="package-open" :size="13" />
          <span>Descompactar...</span>
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
          v-if="canWriteInCurrentFolder"
          type="button"
          class="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-zinc-800 flex items-center gap-2"
          @click="
            closeContextMenu();
            folderInputEl?.click?.();
          "
        >
          <PortalIcon name="folder-up" :size="13" />
          <span>Enviar Pasta...</span>
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

    <!-- Centered Lightbox Preview Modal (PDF Canvas, Word A4, Excel Multi-Aba, Imagem e Texto) -->
    <div
      v-if="previewNode"
      data-testid="portal-preview-panel"
      class="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4"
      @click="closePreview"
    >
      <div
        class="w-full max-w-6xl h-[92vh] rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] shadow-2xl overflow-hidden flex flex-col"
        @click.stop
      >
        <!-- Header Toolbar -->
        <div class="px-4 py-3 border-b border-slate-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-zinc-900">
          <div class="min-w-0 flex items-center gap-2.5">
            <span class="w-8 h-8 rounded-lg bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 flex items-center justify-center shrink-0">
              <PortalIcon v-if="previewKind === 'excel'" name="file-spreadsheet" :size="16" class="text-emerald-600" />
              <PortalIcon v-else-if="previewKind === 'image'" name="image" :size="16" class="text-violet-500" />
              <PortalIcon v-else name="file-text" :size="16" class="text-sky-600" />
            </span>
            <div class="min-w-0">
              <span class="text-xs sm:text-sm font-bold truncate block text-slate-900 dark:text-[#fafafa]">
                Visualização Online — {{ previewNode.name }}
              </span>
              <span class="text-[11px] font-mono text-slate-500 flex flex-wrap items-center gap-1.5">
                <span>{{ formatBytes(previewNode.sizeBytes || previewNode.size_bytes) }}</span>
                <span>•</span>
                <span>{{ getAccessLabel(previewNode) }}</span>
                <span v-if="previewKind === 'pdf' && previewPdfTotalPages > 0">
                  • {{ previewPdfTotalPages }} {{ previewPdfTotalPages === 1 ? 'página' : 'páginas' }}
                </span>
                <span v-if="previewKind === 'excel' && previewExcelSheets.length > 0">
                  • {{ previewExcelSheets.length }} {{ previewExcelSheets.length === 1 ? 'aba' : 'abas' }}
                </span>
              </span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1.5 shrink-0">
            <!-- Controles de Zoom para PDF e Word -->
            <div
              v-if="(previewKind === 'pdf' && !previewPdfFallbackIframe) || previewKind === 'word'"
              class="inline-flex items-center rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 overflow-hidden"
            >
              <button
                type="button"
                class="px-2 py-1.5 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800"
                title="Diminuir zoom"
                aria-label="Diminuir zoom"
                @click="adjustPreviewZoom(-0.2)"
              >
                <PortalIcon name="zoom-out" :size="13" />
              </button>
              <button
                type="button"
                class="px-2 py-1.5 text-[11px] font-mono font-bold text-slate-700 dark:text-zinc-200 border-x border-slate-200 dark:border-zinc-700"
                title="Restaurar zoom 100%"
                @click="resetPreviewZoom"
              >
                {{ Math.round(previewZoom * 100) }}%
              </button>
              <button
                type="button"
                class="px-2 py-1.5 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800"
                title="Aumentar zoom"
                aria-label="Aumentar zoom"
                @click="adjustPreviewZoom(0.2)"
              >
                <PortalIcon name="zoom-in" :size="13" />
              </button>
            </div>

            <!-- Atalhos de Edição (quando usuário possui permissão editor/full_control) -->
            <button
              v-if="canEditNode(previewNode)"
              type="button"
              class="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1 hover:opacity-95"
              @click="
                () => {
                  const target = previewNode;
                  closePreview();
                  handleEditOnDesktop(target);
                }
              "
            >
              <PortalIcon name="monitor" :size="13" />
              <span>Editar no PC</span>
            </button>

            <button
              v-if="previewKind === 'excel' && canEditNode(previewNode)"
              type="button"
              class="px-2.5 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-bold inline-flex items-center gap-1"
              @click="
                () => {
                  const target = previewNode;
                  closePreview();
                  openSheetEditor(target);
                }
              "
            >
              <PortalIcon name="file-spreadsheet" :size="13" />
              <span>Coeditar Web</span>
            </button>

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

        <!-- Barra de Abas & Busca para Excel -->
        <div
          v-if="previewKind === 'excel' && !previewLoading && previewExcelSheets.length > 0"
          class="px-4 py-2 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/70 flex flex-wrap items-center justify-between gap-2"
        >
          <div class="flex items-center gap-1 overflow-x-auto">
            <button
              v-for="(sheet, idx) in previewExcelSheets"
              :key="`excel-tab-${sheet.name}-${idx}`"
              type="button"
              class="px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-colors"
              :class="
                idx === previewExcelTabIdx
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700'
              "
              @click="previewExcelTabIdx = idx"
            >
              {{ sheet.name }}
            </button>
          </div>

          <div class="flex items-center gap-2">
            <span v-if="activeExcelPreviewSheet" class="text-[11px] font-mono text-slate-500">
              {{ activeExcelPreviewSheet.totalRows }} linhas × {{ activeExcelPreviewSheet.totalCols }} colunas
            </span>
            <div class="relative">
              <PortalIcon name="search" :size="12" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                v-model="previewExcelSearch"
                type="search"
                aria-label="Filtrar linhas na planilha"
                placeholder="Filtrar célula..."
                class="pl-7 pr-2.5 py-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-950 text-xs w-44"
              />
            </div>
          </div>
        </div>

        <!-- Body Viewport -->
        <div
          class="flex-1 overflow-auto bg-slate-200/70 dark:bg-zinc-950 p-4"
          :class="previewKind === 'excel' ? 'p-0' : 'flex flex-col items-center'"
          @contextmenu="canDownloadNode(previewNode) ? null : $event.preventDefault()"
        >
          <!-- Loading -->
          <div v-if="previewLoading" class="flex-1 w-full flex flex-col items-center justify-center gap-2 py-16 text-slate-500">
            <PortalIcon name="refresh-cw" :size="24" class="animate-spin text-brand" />
            <p class="text-xs font-semibold">Preparando visualização segura de {{ previewNode.name }}…</p>
          </div>

          <!-- Error -->
          <div
            v-else-if="previewError"
            class="my-auto max-w-md rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-center space-y-2"
          >
            <PortalIcon name="alert-triangle" :size="22" class="mx-auto text-rose-500" />
            <p class="text-xs font-bold text-rose-700 dark:text-rose-300">{{ previewError }}</p>
            <button
              v-if="canDownloadNode(previewNode)"
              type="button"
              class="px-3 py-1.5 rounded-lg bg-brand text-brand-fg text-xs font-bold inline-flex items-center gap-1"
              @click="handleDownloadFile(previewNode)"
            >
              <PortalIcon name="download" :size="13" />
              <span>Baixar arquivo</span>
            </button>
          </div>

          <!-- 1. PDF Nativo em Canvas (Zero bloqueio de CSP/Iframe) -->
          <div
            v-else-if="previewKind === 'pdf' && !previewPdfFallbackIframe && previewPdfPages.length > 0"
            data-testid="portal-pdf-canvas-viewer"
            class="w-full flex flex-col items-center gap-4 pb-6"
          >
            <div
              v-for="pageNum in previewPdfPages"
              :key="`pdf-page-${pageNum}`"
              class="bg-white rounded-lg shadow-md border border-slate-200/90 overflow-hidden"
            >
              <canvas
                :ref="(el) => setPdfCanvasRef(pageNum, el)"
                class="block max-w-full h-auto"
              />
              <div class="px-3 py-1 bg-slate-50 border-t border-slate-100 text-[10px] font-mono text-slate-400 text-right">
                Página {{ pageNum }} de {{ previewPdfTotalPages }}
              </div>
            </div>
            <p
              v-if="previewPdfTruncated"
              class="text-xs text-amber-800 dark:text-amber-200 bg-amber-500/15 border border-amber-500/30 rounded-xl px-4 py-2"
            >
              Exibindo as primeiras {{ previewPdfPages.length }} páginas de {{ previewPdfTotalPages }}.
              {{ canDownloadNode(previewNode) ? 'Clique em "Baixar" para ler o documento completo.' : '' }}
            </p>
          </div>

          <!-- 1b. PDF Fallback Iframe -->
          <iframe
            v-else-if="previewKind === 'pdf' && previewObjectUrl"
            :src="previewObjectUrl"
            :title="previewNode.name"
            class="w-full h-full min-h-[70vh] rounded-lg bg-white border border-slate-200"
          />

          <!-- 2. Excel (.xlsx / .xls / .csv / .ods) Multi-Aba -->
          <div
            v-else-if="previewKind === 'excel' && activeExcelPreviewSheet"
            data-testid="portal-excel-viewer"
            class="w-full h-full flex flex-col bg-white dark:bg-[#111113]"
          >
            <div
              v-if="activeExcelPreviewSheet.truncated"
              class="px-4 py-2 bg-amber-500/10 border-b border-amber-500/25 text-[11px] text-amber-800 dark:text-amber-200 font-semibold"
            >
              Visualização rápida limitada a 500 linhas × 40 colunas por aba.
              {{ canEditNode(previewNode) ? 'Use "Editar no PC" para abrir a planilha completa no Excel.' : '' }}
            </div>
            <div class="flex-1 overflow-auto">
              <table class="w-full border-collapse text-xs">
                <thead class="sticky top-0 z-10 bg-slate-100 dark:bg-zinc-900">
                  <tr>
                    <th class="sticky left-0 z-20 w-12 bg-slate-200/90 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 py-1.5 px-2 text-center font-mono text-[11px] text-slate-600 dark:text-zinc-300">
                      #
                    </th>
                    <th
                      v-for="col in activeExcelPreviewSheet.colHeaders"
                      :key="`h-${col}`"
                      class="min-w-[110px] max-w-[320px] border border-slate-300 dark:border-zinc-700 py-1.5 px-2.5 text-center font-mono text-[11px] font-bold text-slate-700 dark:text-zinc-200"
                    >
                      {{ col }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in filteredExcelPreviewRows"
                    :key="`r-${row.rowNumber}`"
                    class="even:bg-slate-50/70 dark:even:bg-zinc-900/40 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/25"
                  >
                    <td class="sticky left-0 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 py-1 px-2 text-center font-mono text-[11px] font-bold text-slate-500">
                      {{ row.rowNumber }}
                    </td>
                    <td
                      v-for="(cellVal, cIdx) in row.cells"
                      :key="`c-${row.rowNumber}-${cIdx}`"
                      class="border border-slate-200 dark:border-zinc-800 py-1 px-2.5 text-slate-800 dark:text-zinc-100 whitespace-pre-wrap break-words max-w-[340px]"
                      :class="row.rowNumber === 1 ? 'font-bold bg-slate-100/80 dark:bg-zinc-800/70' : ''"
                    >
                      {{ cellVal }}
                    </td>
                  </tr>
                  <tr v-if="filteredExcelPreviewRows.length === 0">
                    <td
                      :colspan="(activeExcelPreviewSheet.colHeaders?.length || 1) + 1"
                      class="py-10 text-center text-xs text-slate-500"
                    >
                      {{ previewExcelSearch ? 'Nenhuma célula encontrada para o filtro informado.' : 'Esta aba está vazia.' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 3. Word (.docx / .doc) Folha A4 Sanitizada -->
          <div
            v-else-if="previewKind === 'word'"
            data-testid="portal-word-viewer"
            class="w-full max-w-4xl space-y-3 pb-6"
          >
            <div
              v-if="previewWordNote"
              class="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200"
            >
              {{ previewWordNote }}
            </div>
            <article
              class="bg-white text-slate-900 rounded-xl shadow-md border border-slate-200 px-6 sm:px-12 py-8 sm:py-10 leading-relaxed nexus-word-sheet origin-top transition-transform"
              :style="{ fontSize: `${Math.round(14 * previewZoom)}px` }"
              v-html="previewWordHtml"
            />
          </div>

          <!-- 4. Imagem -->
          <img
            v-else-if="previewObjectUrl && previewKind === 'image'"
            :src="previewObjectUrl"
            :alt="previewNode.name"
            class="my-auto max-w-full max-h-[78vh] rounded-lg object-contain shadow"
          />

          <!-- 5. Texto / Código / JSON -->
          <pre
            v-else-if="previewTextContent !== null"
            class="w-full max-w-5xl rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-5 text-xs font-mono whitespace-pre-wrap text-slate-800 dark:text-zinc-100 shadow-sm"
          >{{ previewTextContent }}</pre>

          <!-- 6. Fallback Genérico -->
          <p v-else class="my-auto text-xs text-slate-500 py-6">
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
            v-if="activeSheetNode && canEditNode(activeSheetNode)"
            type="button"
            class="min-h-[32px] px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1"
            @click="handleEditOnDesktop(activeSheetNode)"
          >
            <PortalIcon name="monitor" :size="13" />
            <span>Abrir no Excel (Auto-Sync)</span>
          </button>
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

        <!-- Sheet Tabs (quando planilha possui múltiplas abas) -->
        <div v-if="sheetTabs.length > 1" class="flex items-center gap-1 overflow-x-auto">
          <button
            v-for="(tab, idx) in sheetTabs"
            :key="`live-tab-${tab.name}-${idx}`"
            type="button"
            class="px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap"
            :class="
              idx === activeSheetTabIdx
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
            "
            @click="activeSheetTabIdx = idx"
          >
            {{ tab.name }}
          </button>
        </div>

        <!-- Grid -->
        <div class="overflow-auto max-h-[420px] border border-slate-200 dark:border-zinc-800 rounded-xl">
          <table class="w-full border-collapse text-xs font-mono">
            <thead class="sticky top-0 z-10">
              <tr class="bg-slate-100 dark:bg-zinc-900">
                <th class="w-10 border border-slate-200 dark:border-zinc-800 py-1 text-center">#</th>
                <th
                  v-for="col in dynamicSheetColumns"
                  :key="col"
                  class="min-w-[110px] border border-slate-200 dark:border-zinc-800 py-1 px-2 text-center font-bold"
                >
                  {{ col }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="rowNum in dynamicSheetRows" :key="rowNum">
                <td class="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-center font-bold text-slate-500">
                  {{ rowNum }}
                </td>
                <td
                  v-for="col in dynamicSheetColumns"
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

    <!-- LIVE DESKTOP AUTO-SYNC MODAL (`nexusvault://` via Agente Windows) -->
    <div
      v-if="desktopSyncSession"
      data-testid="portal-desktop-sync-modal"
      class="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        class="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] shadow-2xl overflow-hidden"
      >
        <div class="px-5 py-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <PortalIcon name="monitor" :size="18" />
            </span>
            <div class="min-w-0">
              <h4 class="text-sm font-black text-slate-900 dark:text-white truncate">
                Edição Sincronizada no PC
              </h4>
              <p class="text-[11px] text-slate-500 truncate">
                {{ desktopSyncSession.fileName }}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Minimizar acompanhamento"
            class="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
            @click="dismissDesktopSessionModal"
          >
            <PortalIcon name="x" :size="16" />
          </button>
        </div>

        <div class="p-5 space-y-4 text-xs">
          <!-- Status Dinâmico em Tempo Real -->
          <div
            v-if="desktopSyncSession.status === 'pending'"
            class="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4 space-y-2"
          >
            <div class="flex items-center gap-2 font-bold text-sky-800 dark:text-sky-200">
              <PortalIcon name="refresh-cw" :size="15" />
              <span>Chamando o Agente Nexus no seu computador...</span>
            </div>
            <p class="text-[11px] text-sky-700 dark:text-sky-300 leading-relaxed">
              Se o navegador mostrar um aviso perguntando se deseja abrir o <strong>NexusAgent</strong>, marque
              <strong>"Sempre permitir"</strong> e clique em <strong>Abrir</strong>.
            </p>
          </div>

          <div
            v-else-if="desktopSyncSession.status === 'opened'"
            class="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 space-y-2"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="inline-flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-200">
                <PortalIcon name="check-circle" :size="16" />
                <span>Arquivo aberto no PC — Auto-Sync Ativo!</span>
              </span>
              <span class="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-mono text-[10px] font-bold">
                v{{ desktopSyncSession.currentVersion }}
              </span>
            </div>
            <p class="text-[11px] text-emerald-700 dark:text-emerald-300 leading-relaxed">
              Edite normalmente no Excel, Word ou programa padrão. A cada <strong>Ctrl+S</strong>, o Agente salva uma nova versão direto na VPS.
              Quando você fechar o programa, o cadeado será liberado automaticamente.
            </p>
            <div class="pt-1 flex flex-wrap items-center gap-3 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200">
              <span>Salvamentos sincronizados: <strong>{{ desktopSyncSession.syncCount }}</strong></span>
              <span v-if="desktopSyncSession.lastSyncedAt">
                • Último envio: <strong>{{ formatFriendlyDate(desktopSyncSession.lastSyncedAt) }}</strong>
              </span>
            </div>
          </div>

          <div
            v-else
            class="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 space-y-1.5"
          >
            <div class="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-200">
              <PortalIcon name="check-circle" :size="16" />
              <span>Edição finalizada e sincronizada na VPS!</span>
            </div>
            <p class="text-[11px] text-emerald-700 dark:text-emerald-300">
              Versão final: <strong>v{{ desktopSyncSession.currentVersion }}</strong> ({{ desktopSyncSession.syncCount }} salvamento(s)).
              O arquivo já foi desbloqueado para a sua equipe.
            </p>
          </div>

          <!-- Aviso útil se o agente demorar > 6.5s para responder -->
          <div
            v-if="desktopAgentSlowHint && desktopSyncSession.status === 'pending'"
            class="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-2.5"
          >
            <div class="flex items-start gap-2 text-amber-800 dark:text-amber-200">
              <PortalIcon name="alert-triangle" :size="16" class="mt-0.5 shrink-0" />
              <div class="space-y-1">
                <p class="font-bold">O arquivo não abriu no seu PC?</p>
                <p class="text-[11px] leading-relaxed">
                  Verifique se o ícone <strong>NX (Agente Nexus v{{ AGENT_VERSION_LABEL }})</strong> está ativo perto do relógio do Windows.
                  Se ainda não instalou ou estiver em versão antiga, obtenha o pacote já configurado para o seu equipamento.
                </p>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-bold inline-flex items-center gap-1"
                @click="showAgentGuide = true"
              >
                <PortalIcon name="info" :size="13" />
                <span>Ver Passo a Passo do Colaborador</span>
              </button>
              <button
                type="button"
                :disabled="downloadingAgentPkg"
                class="px-3 py-1.5 rounded-lg border border-amber-600/40 text-amber-800 dark:text-amber-200 text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-50"
                @click="handleDownloadConfiguredAgent"
              >
                <PortalIcon name="external-link" :size="13" />
                <span>
                  {{
                    downloadingAgentPkg
                      ? 'Preparando pacote…'
                      : activeAgentPatrimony
                        ? `Obter Agente v${AGENT_VERSION_LABEL} (${activeAgentPatrimony})`
                        : `Obter Agente Windows v${AGENT_VERSION_LABEL}`
                  }}
                </span>
              </button>
            </div>
          </div>

          <!-- Rodapé de ações -->
          <div class="pt-2 border-t border-slate-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <button
                v-if="desktopSyncSession.status !== 'closed'"
                type="button"
                class="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 font-bold text-slate-700 dark:text-zinc-200 inline-flex items-center gap-1"
                @click="launchVaultProtocol(desktopSyncSession.protocolUrl)"
              >
                <PortalIcon name="external-link" :size="13" />
                <span>Abrir novamente</span>
              </button>
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-700 font-semibold text-slate-600 dark:text-zinc-300 inline-flex items-center gap-1"
                @click="showAgentGuide = true"
              >
                <PortalIcon name="info" :size="13" />
                <span>Passo a passo</span>
              </button>
            </div>

            <button
              v-if="desktopSyncSession.status !== 'closed'"
              type="button"
              :disabled="desktopSyncBusy"
              class="px-3.5 py-1.5 rounded-lg bg-rose-600 text-white font-bold inline-flex items-center gap-1 disabled:opacity-50"
              @click="handleCloseDesktopSession"
            >
              <PortalIcon name="unlock" :size="13" />
              <span>Encerrar e Desbloquear</span>
            </button>
            <button
              v-else
              type="button"
              class="px-4 py-1.5 rounded-lg bg-brand text-brand-fg font-bold"
              @click="dismissDesktopSessionModal"
            >
              Concluir
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- PASSO A PASSO DO COLABORADOR: EDITAR NO EXCEL & PROGRAMAS NATIVOS -->
    <div
      v-if="showAgentGuide"
      data-testid="portal-agent-guide-modal"
      class="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
      @click="showAgentGuide = false"
    >
      <div
        class="w-full max-w-2xl max-h-[90vh] rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] shadow-2xl overflow-hidden flex flex-col"
        @click.stop
      >
        <div class="px-5 py-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <span class="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <PortalIcon name="laptop" :size="18" />
            </span>
            <div>
              <h4 class="text-sm font-black text-slate-900 dark:text-white">
                Como editar planilhas no Excel com salvamento automático na VPS
              </h4>
              <p class="text-[11px] text-slate-500">
                Passo a passo rápido para colaboradores — funciona com Excel, Word, PowerPoint, PDF e qualquer programa do Windows
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Fechar guia"
            class="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200/70 dark:hover:bg-zinc-800"
            @click="showAgentGuide = false"
          >
            <PortalIcon name="x" :size="16" />
          </button>
        </div>

        <div class="p-5 overflow-y-auto space-y-4 text-xs">
          <div class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-emerald-900 dark:text-emerald-100 leading-relaxed">
            Com o <strong>Agente Nexus ITAM (v3.4+)</strong> rodando no seu computador, você não precisa ficar baixando e subindo
            planilhas manualmente: basta clicar em <strong>"Editar no PC"</strong> e usar o <strong>Microsoft Excel real</strong>
            com todas as suas fórmulas, macros, tabelas dinâmicas e formatações. Cada <strong>Ctrl+S</strong> atualiza automaticamente o arquivo na empresa.
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="rounded-xl border border-slate-200 dark:border-zinc-800 p-3.5 space-y-1.5 bg-slate-50/70 dark:bg-zinc-900/50">
              <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand text-brand-fg font-black text-[11px]">1</span>
              <h5 class="font-bold text-slate-900 dark:text-white">Confirme o ícone "NX" perto do relógio</h5>
              <p class="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed">
                Veja no canto inferior direito do Windows se o ícone <strong>NX (Nexus ITAM v3.4+)</strong> está ativo.
                Se o computador ainda não tem o agente (ou se está trabalhando de casa), clique no botão abaixo para obter o
                <strong>NexusAgent.zip</strong>, extraia a pasta e abra o <strong>NexusAgent.exe</strong> uma única vez.
              </p>
            </div>

            <div class="rounded-xl border border-slate-200 dark:border-zinc-800 p-3.5 space-y-1.5 bg-slate-50/70 dark:bg-zinc-900/50">
              <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand text-brand-fg font-black text-[11px]">2</span>
              <h5 class="font-bold text-slate-900 dark:text-white">Clique em "Editar no PC" no arquivo</h5>
              <p class="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed">
                Aqui no Portal, clique no botão verde <strong>Editar no PC</strong> na linha da planilha ou documento.
                Na primeira vez, o navegador exibirá uma janelinha de confirmação: marque <strong>"Sempre permitir"</strong> e clique em <strong>Abrir NexusAgent</strong>.
              </p>
            </div>

            <div class="rounded-xl border border-slate-200 dark:border-zinc-800 p-3.5 space-y-1.5 bg-slate-50/70 dark:bg-zinc-900/50">
              <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand text-brand-fg font-black text-[11px]">3</span>
              <h5 class="font-bold text-slate-900 dark:text-white">Edite no Excel e aperte Ctrl+S</h5>
              <p class="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed">
                O Excel (ou programa padrão do Windows) abrirá o arquivo automaticamente.
                A cada <strong>Ctrl+S</strong>, o Agente detecta sua alteração, grava uma nova versão na VPS em segundos e mostra um aviso discreto perto do relógio.
              </p>
            </div>

            <div class="rounded-xl border border-slate-200 dark:border-zinc-800 p-3.5 space-y-1.5 bg-slate-50/70 dark:bg-zinc-900/50">
              <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand text-brand-fg font-black text-[11px]">4</span>
              <h5 class="font-bold text-slate-900 dark:text-white">Feche o programa para destravar</h5>
              <p class="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed">
                Enquanto você edita, o arquivo mostra um <strong>cadeado</strong> para impedir que outro colega sobrescreva seu trabalho.
                Ao fechar o Excel, o Agente confirma o último envio e libera o arquivo automaticamente.
              </p>
            </div>
          </div>

          <div class="rounded-xl border border-slate-200 dark:border-zinc-800 p-3.5 space-y-2">
            <h5 class="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <PortalIcon name="shield-check" :size="14" class="text-emerald-600" />
              <span>Dúvidas frequentes e segurança</span>
            </h5>
            <ul class="space-y-1.5 text-[11px] text-slate-600 dark:text-zinc-400 list-disc pl-4">
              <li><strong>E se a internet oscilar?</strong> O Agente tenta reenviar automaticamente e mantém sua cópia salva no Excel sem perda de dados.</li>
              <li><strong>Posso recuperar uma versão antiga?</strong> Sim! Cada <strong>Ctrl+S</strong> cria uma versão numerada (v2, v3, v4...) com histórico auditado.</li>
              <li><strong>Privacidade garantida:</strong> O Agente só acessa o arquivo exato que você clicou em "Editar no PC" — nunca lê suas pastas pessoais.</li>
              <li><strong>Computador da empresa já tem o Agente antigo?</strong> Peça à equipe de TI para clicar em <em>Atualizar Frota (OTA)</em> no painel para atualizar para a v3.4 sem precisar reinstalar.</li>
            </ul>
          </div>
        </div>

        <div class="px-5 py-3.5 border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <select
              v-if="custodyComputerAssets.length > 1"
              v-model="selectedAgentAssetId"
              aria-label="Selecionar equipamento para configurar o agente"
              class="px-2.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-mono font-bold"
            >
              <option
                v-for="asset in custodyComputerAssets"
                :key="asset.id || asset.internal_id"
                :value="String(asset.id || asset.internal_id || asset.internalId)"
              >
                {{ asset.internal_id || asset.internalId }} — {{ asset.model || asset.type }}
              </option>
            </select>
            <button
              type="button"
              :disabled="downloadingAgentPkg"
              class="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-50"
              @click="handleDownloadConfiguredAgent"
            >
              <PortalIcon name="external-link" :size="14" />
              <span>
                {{
                  downloadingAgentPkg
                    ? 'Gerando pacote configurado…'
                    : activeAgentPatrimony
                      ? `Obter Agente v${AGENT_VERSION_LABEL} (${activeAgentPatrimony} + config)`
                      : `Obter Agente Windows v${AGENT_VERSION_LABEL} (com config)`
                }}
              </span>
            </button>
          </div>
          <button
            type="button"
            class="px-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold"
            @click="showAgentGuide = false"
          >
            Entendi, fechar guia
          </button>
        </div>
      </div>
    </div>

    <!-- ARCHIVE EXTRACTION MODAL (.ZIP / .RAR / .TAR / .TAR.GZ / .TGZ) -->
    <div
      v-if="extractModalNode"
      data-testid="portal-archive-extract-modal"
      class="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      @click="extractingNodeId !== extractModalNode.id ? (extractModalNode = null) : null"
    >
      <div
        class="w-full max-w-md rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4 shadow-2xl"
        @click.stop
      >
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-sm font-black flex items-center gap-2 text-slate-900 dark:text-white">
            <PortalIcon name="package-open" :size="17" class="text-amber-600" />
            <span>Descompactar Arquivo na Nuvem</span>
          </h4>
          <button
            type="button"
            :disabled="extractingNodeId === extractModalNode.id"
            aria-label="Fechar janela de descompactação"
            class="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
            @click="extractModalNode = null"
          >
            <PortalIcon name="x" :size="15" />
          </button>
        </div>

        <div class="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 px-3 py-2 text-xs">
          <p class="font-bold text-slate-900 dark:text-white truncate">{{ extractModalNode.name }}</p>
          <p class="text-[11px] font-mono text-slate-500">
            {{ formatBytes(extractModalNode.sizeBytes || extractModalNode.size_bytes) }} • Extração direta na VPS
          </p>
        </div>

        <form class="space-y-3 text-xs" @submit.prevent="handleSubmitExtract">
          <div class="space-y-2">
            <span class="block font-bold text-slate-700 dark:text-zinc-300">Onde deseja extrair?</span>
            <label
              class="flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer"
              :class="
                extractMode === 'subfolder'
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50'
              "
            >
              <input v-model="extractMode" type="radio" value="subfolder" class="mt-0.5" />
              <div class="flex-1 min-w-0 space-y-1.5">
                <span class="font-bold text-slate-900 dark:text-white block">
                  Extrair em uma nova pasta (recomendado)
                </span>
                <input
                  v-if="extractMode === 'subfolder'"
                  v-model="extractFolderName"
                  type="text"
                  aria-label="Nome da pasta de destino"
                  placeholder="Nome da pasta de destino"
                  class="w-full min-h-[34px] px-2.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs font-semibold"
                />
              </div>
            </label>

            <label
              class="flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer"
              :class="
                extractMode === 'here'
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/50'
              "
            >
              <input v-model="extractMode" type="radio" value="here" class="mt-0.5" />
              <div class="min-w-0">
                <span class="font-bold text-slate-900 dark:text-white block">Extrair nesta pasta atual</span>
                <span class="text-[11px] text-slate-500">Extrai diretamente ao lado do arquivo compactado.</span>
              </div>
            </label>
          </div>

          <div>
            <label class="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
              Se já existir arquivo com o mesmo nome
            </label>
            <select
              v-model="extractConflictPolicy"
              class="w-full min-h-[38px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 text-xs font-semibold"
            >
              <option value="rename">Renomear cópias automaticamente (seguro)</option>
              <option value="version">Criar nova versão no arquivo existente</option>
              <option value="skip">Ignorar arquivos que já existem</option>
            </select>
          </div>

          <div v-if="/\.rar$/i.test(String(extractModalNode.name || ''))">
            <label class="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
              Senha do arquivo .RAR (opcional)
            </label>
            <input
              v-model="extractPassword"
              type="password"
              placeholder="Deixe vazio se não houver senha"
              class="w-full min-h-[38px] rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900 px-3 text-xs"
            />
          </div>

          <div class="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              :disabled="extractingNodeId === extractModalNode.id"
              class="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs font-bold"
              @click="extractModalNode = null"
            >
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="extractingNodeId === extractModalNode.id"
              class="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-50"
            >
              <PortalIcon name="package-open" :size="14" />
              <span>{{ extractingNodeId === extractModalNode.id ? 'Descompactando...' : 'Descompactar Agora' }}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

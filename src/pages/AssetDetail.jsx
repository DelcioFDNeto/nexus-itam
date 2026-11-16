// src/pages/AssetDetail.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { db } from "../services/firebase";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  getDoc,
  limit,
} from "firebase/firestore";
import {
  getAssetById,
  getAssetHistory,
  moveAsset,
  registerMaintenance,
  updateAsset,
  deleteAsset,
  writeOffAsset,
  reactivateAsset,
} from "../services/assetService";
import MoveAssetModal from "../components/MoveAssetModal";
import MaintenanceModal from "../components/MaintenanceModal";
import WriteOffModal from "../components/WriteOffModal";
import StatusBadge from "../components/StatusBadge";
import { isRetired, lifecycleBlocker, warrantyStatus, WARRANTY_BADGE, WARRANTY_LABEL } from "../utils/assetStatus";
import { useAuth } from "../contexts/AuthContext";
import { useConfirm } from "../components/ConfirmDialog";
import { safeLinkUrl } from "../utils/sanitize";
import { can } from "../utils/permissions";
import { toLocalDate, formatDateBR } from "../utils/dates";
import { parseMoney } from "../utils/terms";
import { buildLabelsDocument, printHtml, resolvePrintBranding } from "../utils/printTemplates";
import TermIssueModal from "../components/terms/TermIssueModal";
import TransferModal from "../components/terms/TransferModal";
import AssetTermsCard from "../components/terms/AssetTermsCard";
import AgentInventoryCard from "../components/assets/AgentInventoryCard";
import { toast } from "sonner";
import {
  Archive,
  RotateCcw,
  ShieldCheck,
  ArrowLeft,
  MapPin,
  User,
  Tag,
  Monitor,
  History,
  Building2,
  ArrowRightLeft,
  Wrench,
  StickyNote,
  Save,
  Plus,
  Printer,
  FileText,
  Trash2,
  Link as LinkIcon,
  X,
  Edit3,
  Plug,
  Clock,
  Copy,
  Truck,
  Undo2,
  FileSignature,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

import AssetIcon from "../components/AssetIcon";

const INPUT_7STATE =
  "bg-white hover:border-slate-300 active:border-slate-400 focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:opacity-50 disabled:cursor-not-allowed aria-[invalid=true]:border-rose-500 aria-[invalid=true]:focus-visible:ring-rose-500/25 dark:bg-[#111113] dark:border-zinc-800 dark:hover:border-zinc-700 dark:text-[#fafafa] dark:placeholder:text-zinc-500 transition-colors";

const stableTimestampPart = (ts, fallback) =>
  ts?.toMillis?.() ?? ts?.seconds ?? (ts instanceof Date ? ts.getTime() : ts ?? fallback);

const copyToClipboard = async (value, successMessage) => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("Não foi possível copiar para a área de transferência.");
  }
};

const AssetDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser } = useAuth();
  const confirm = useConfirm();

  const tenantId = currentUser?.tenantId;

  // Estados principais da página
  const [asset, setAsset] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReactivating, setIsReactivating] = useState(false);
  const [notes, setNotes] = useState("");
  const notesLoadedRef = React.useRef(false);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [cpfInput, setCpfInput] = useState("");
  const [savingCpf, setSavingCpf] = useState(false);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [isMaintModalOpen, setIsMaintModalOpen] = useState(false);
  const [isWriteOffOpen, setIsWriteOffOpen] = useState(false);
  const [writingOff, setWritingOff] = useState(false);

  const activeTab = searchParams.get("aba") === "history" ? "history" : "details"; // 'details' | 'history' (Mobile)
  const setActiveTab = (tab) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "details") next.delete("aba");
        else next.set("aba", tab);
        return next;
      },
      { replace: true },
    );
  };

  // Controle do formulário de links e anexos
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkName, setNewLinkName] = useState("");
  const [isAddingLink, setIsAddingLink] = useState(false);

  // Controle do formulário de novos periféricos
  const [newPeripheral, setNewPeripheral] = useState("");
  const [isAddingPeripheral, setIsAddingPeripheral] = useState(false);

  // Configurações da empresa para impressão de termos e etiquetas.
  const [config, setConfig] = useState({});
  const canWrite = can(currentUser, "assets:write");
  const canRetire = can(currentUser, "assets:delete");
  const canIssueTerms = can(currentUser, "terms:issue");
  // Modais de termo: { kind: 'responsabilidade' | 'devolucao' | 'transferencia' }
  const [termModal, setTermModal] = useState(null);
  const [termsVersion, setTermsVersion] = useState(0);

  useEffect(() => {
    if (!tenantId) return;
    if (currentUser?.authSource === 'gateway') {
      setConfig({
        companyName: currentUser?.companyName || 'Nexus Indústria & Tecnologia S.A.',
        assetPrefix: currentUser?.assetPrefix || 'NEX',
      });
      return;
    }
    const loadConfig = async () => {
      try {
        const snap = await getDoc(doc(db, "settings", tenantId));
        if (snap.exists()) setConfig(snap.data());
      } catch (err) {
        console.error(err);
      }
    };
    loadConfig();
  }, [tenantId, currentUser?.authSource, currentUser?.companyName, currentUser?.assetPrefix]);

  // Impressos com a identidade da empresa e todos os campos escapados
  const openPrint = (html) => {
    if (!printHtml(html)) toast.error('Popup bloqueado! Permita popups para imprimir.');
  };

  const printBranding = () => resolvePrintBranding(config, currentUser);

  const handlePrintLabel = () => {
    if (!asset) return;
    openPrint(
      buildLabelsDocument([{ code: asset.internalId, subtitle: asset.model }], printBranding(), {
        title: `Etiqueta_${asset.internalId || id}`,
        grid: false,
      }),
    );
  };

  const handlePrintPeripheral = (item) => {
    if (!asset) return;
    openPrint(
      buildLabelsDocument([{ code: asset.internalId, subtitle: item.name || 'Acessório' }], printBranding(), {
        variant: 'peripheral',
        title: `Acessorio_${asset.internalId || id}`,
        grid: false,
      }),
    );
  };

  // Busca de dados no banco (Firestore / PostgreSQL 16)
  const fetchHistory = async (historyTenantId) => {
    if (!historyTenantId) return;
    try {
      if (currentUser?.authSource === 'gateway') {
        const hItems = await getAssetHistory(id, historyTenantId, 50);
        setHistory(hItems);
        return;
      }
      const q = query(
        collection(db, "history"),
        where("tenantId", "==", historyTenantId),
        where("assetId", "==", id),
        orderBy("date", "desc"),
        limit(50),
      );
      const snapshot = await getDocs(q);
      setHistory(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("Falha ao carregar a timeline do ativo:", err);
    }
  };

  useEffect(() => {
    notesLoadedRef.current = false;

    if (currentUser?.authSource === 'gateway') {
      let active = true;
      getAssetById(id, tenantId)
        .then((data) => {
          if (!active) return;
          setLoadError("");
          if (data) {
            setAsset(data);
            if (!notesLoadedRef.current) {
              setNotes(data.notes || "");
              setCpfInput(data.clientCpf || "");
              notesLoadedRef.current = true;
            }
            fetchHistory(data.tenantId || tenantId);
          } else {
            navigate("/assets");
          }
        })
        .catch((err) => {
          console.error(err);
          if (active) {
            setLoadError("Não foi possível carregar os dados deste ativo. Verifique sua conexão e tente novamente.");
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }

    const assetRef = doc(db, "assets", id);
    const unsubscribe = onSnapshot(
      assetRef,
      (docSnap) => {
        setLoadError("");
        if (docSnap.exists()) {
          const data = { id: docSnap.id, ...docSnap.data() };
          setAsset(data);
          if (!notesLoadedRef.current) {
            setNotes(data.notes || "");
            setCpfInput(data.clientCpf || "");
            notesLoadedRef.current = true;
          }
          fetchHistory(data.tenantId || currentUser?.tenantId);
        } else {
          navigate("/assets");
        }
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoadError("Não foi possível carregar os dados deste ativo. Verifique sua conexão e tente novamente.");
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [id, navigate, currentUser?.authSource, tenantId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    setLoading(true);
    setLoadError("");
    setReloadKey((k) => k + 1);
  };

  // Ações de usuário e eventos de interface (Movimentação, Manutenção, Anexos...)

  const handleMoveConfirm = async (moveData) => {
    const userEmail = currentUser?.email || "Usuário Desconhecido";
    const tenantId = asset?.tenantId || currentUser?.tenantId;
    try {
      await moveAsset(id, { ...asset, tenantId }, moveData, userEmail);
      toast.success(`Ativo movido para ${moveData.newLocation}.`);
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Erro ao movimentar o ativo.");
      throw err;
    }
  };

  const handleMaintenanceConfirm = async (maintData) => {
    const userEmail = currentUser?.email || "Usuário Desconhecido";
    const tenantId = asset?.tenantId || currentUser?.tenantId;
    await registerMaintenance(id, { ...maintData, tenantId, asset }, userEmail);
  };

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    const userEmail = currentUser?.email || "Usuário Desconhecido";
    const tenantId = asset?.tenantId || currentUser?.tenantId;
    try {
      await updateAsset(
        id,
        { notes: notes, tenantId },
        {
          action: "Nota Técnica",
          details: "Observações técnicas atualizadas.",
          type: "update",
          user: userEmail,
          tenantId,
        },
      );
      toast.success("Notas atualizadas!");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao salvar as notas.");
    } finally {
      // Antes, uma falha deixava o botão travado em "salvando" para sempre.
      setIsSavingNotes(false);
    }
  };

  const handleAddLink = async () => {
    const trimmedName = newLinkName.trim();
    const trimmedUrl = newLinkUrl.trim();
    if (!trimmedUrl || !trimmedName)
      return toast.warning("Preencha o nome e o link!");
    const validatedUrl = safeLinkUrl(trimmedUrl);
    if (!validatedUrl)
      return toast.error("Link inválido ou protocolo não permitido.");
    setIsAddingLink(true);
    const userEmail = currentUser?.email || "Usuário Desconhecido";
    const tenantId = asset?.tenantId || currentUser?.tenantId;
    try {
      const currentLinks = asset.attachments || [];
      const newLink = {
        name: trimmedName,
        url: validatedUrl,
        type: "link",
        addedAt: new Date(),
      };
      await updateAsset(
        id,
        { attachments: [...currentLinks, newLink], tenantId },
        {
          action: "Novo Anexo",
          details: `Adicionado link/documento: ${trimmedName}`,
          user: userEmail,
          tenantId,
        },
      );
      setNewLinkUrl("");
      setNewLinkName("");
      toast.success("Link anexado com sucesso!");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao salvar link.");
    } finally {
      setIsAddingLink(false);
    }
  };

  const handleDeleteLink = async (indexToDelete) => {
    const linkToDelete = asset.attachments?.[indexToDelete];
    if (!linkToDelete) return;
    const ok = await confirm({
      title: "Remover Anexo/Link",
      message: `Remover o link ou anexo "${linkToDelete.name || 'documento'}"?`,
      danger: true,
      confirmLabel: "Remover",
    });
    if (!ok) return;
    const userEmail = currentUser?.email || "Usuário Desconhecido";
    const tenantId = asset?.tenantId || currentUser?.tenantId;
    try {
      const currentLinks = asset.attachments || [];
      const newLinks = currentLinks.filter((_, idx) => idx !== indexToDelete);
      await updateAsset(
        id,
        { attachments: newLinks, tenantId },
        {
          action: "Anexo Removido",
          details: `Removido link/documento: ${linkToDelete.name}`,
          user: userEmail,
          tenantId,
        },
      );
      toast.success("Link removido.");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao remover link.");
    }
  };

  const handleAddPeripheral = async () => {
    if (!newPeripheral)
      return toast.warning("Digite o nome do periférico (ex: Carregador)");
    setIsAddingPeripheral(true);
    const userEmail = currentUser?.email || "Usuário Desconhecido";
    const tenantId = asset?.tenantId || currentUser?.tenantId;
    try {
      const currentPeripherals = asset.peripherals || [];
      const newItem = { name: newPeripheral, addedAt: new Date() };
      await updateAsset(
        id,
        { peripherals: [...currentPeripherals, newItem], tenantId },
        {
          action: "Periférico Vinculado",
          details: `Acessório adicionado: ${newPeripheral}`,
          user: userEmail,
          tenantId,
        },
      );
      setNewPeripheral("");
      toast.success("Acessório vinculado.");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao salvar acessório.");
    } finally {
      setIsAddingPeripheral(false);
    }
  };

  const handleDeletePeripheral = async (indexToDelete) => {
    const itemToDelete = asset.peripherals?.[indexToDelete];
    if (!itemToDelete) return;
    const ok = await confirm({
      title: "Remover Acessório",
      message: `Remover o acessório "${itemToDelete.name}"?`,
      danger: true,
      confirmLabel: "Remover",
    });
    if (!ok) return;
    const userEmail = currentUser?.email || "Usuário Desconhecido";
    const tenantId = asset?.tenantId || currentUser?.tenantId;
    try {
      const currentPeripherals = asset.peripherals || [];
      const newPeripherals = currentPeripherals.filter((_, idx) => idx !== indexToDelete);
      await updateAsset(
        id,
        { peripherals: newPeripherals, tenantId },
        {
          action: "Periférico Removido",
          details: `Acessório desvinculado: ${itemToDelete.name}`,
          user: userEmail,
          tenantId,
        },
      );
      toast.success("Acessório removido.");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao remover acessório.");
    }
  };

  const handleWriteOff = async (form) => {
    setWritingOff(true);
    try {
      await writeOffAsset(id, asset, form, currentUser?.email || "Sistema");
      setIsWriteOffOpen(false);
      toast.success("Baixa registrada. O histórico do ativo foi preservado.");
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Erro ao registrar a baixa.");
    } finally {
      setWritingOff(false);
    }
  };

  const handleReactivate = async () => {
    const ok = await confirm({
      title: "Reativar Ativo",
      message: "Devolver este ativo ao inventário como Disponível?",
      confirmLabel: "Reativar",
    });
    if (!ok) return;
    setIsReactivating(true);
    try {
      await reactivateAsset(id, asset, currentUser?.email || "Sistema");
      toast.success("Ativo reativado.");
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Erro ao reativar.");
    } finally {
      setIsReactivating(false);
    }
  };

  const handleDelete = async () => {
    if (!isRetired(asset?.status)) {
      toast.error('Dê baixa no ativo antes de excluir — a exclusão apaga todo o histórico.');
      return;
    }
    const ok = await confirm({
      title: "Excluir Ativo",
      message: "TEM CERTEZA? A exclusão é irreversível e remove o registro patrimonial.",
      danger: true,
      confirmLabel: "Excluir definitivamente",
    });
    if (!ok) return;
    setIsDeleting(true);
    try {
      await deleteAsset(id, asset?.tenantId || currentUser?.tenantId, currentUser?.email || "Sistema");
      toast.success("Ativo excluído.");
      navigate("/assets");
    } catch (err) {
      console.error(err);
      toast.error(err?.code === "permission-denied" ? "Seu perfil não pode excluir ativos." : "Erro ao excluir o ativo.");
      setIsDeleting(false);
    }
  };

  const handleSaveCpf = async () => {
    if (!canWrite) return;
    setSavingCpf(true);
    const userEmail = currentUser?.email || "Usuário Desconhecido";
    const tenantId = asset?.tenantId || currentUser?.tenantId;
    try {
      const cpfValue = cpfInput.trim();
      await updateAsset(
        id,
        { clientCpf: cpfValue, tenantId },
        {
          action: "CPF Atualizado",
          details: `CPF do responsável ${cpfValue ? "definido como: " + cpfValue : "removido"}.`,
          type: "update",
          user: userEmail,
          tenantId,
        },
      );
      toast.success("CPF atualizado!");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao salvar CPF.");
    } finally {
      setSavingCpf(false);
    }
  };

  if (loading)
    return (
      <div
        role="status"
        aria-label="Carregando detalhes do ativo"
        className="flex min-h-[60vh] items-center justify-center"
      >
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-brand" aria-hidden="true" />
        <span className="sr-only">Carregando detalhes do ativo…</span>
      </div>
    );

  if (loadError && !asset)
    return (
      <div className="max-w-xl mx-auto mt-12 p-8 bg-white dark:bg-[#111113] rounded-2xl border border-rose-200 dark:border-rose-900/60 shadow-sm text-center" role="alert">
        <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
          <AlertTriangle size={24} aria-hidden="true" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-[#fafafa] mb-2">
          Erro ao carregar ativo
        </h2>
        <p className="text-sm text-slate-600 dark:text-zinc-400 mb-6">{loadError}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark text-brand-fg font-semibold text-sm active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <RefreshCw size={16} aria-hidden="true" /> Tentar novamente
          </button>
          <button
            type="button"
            onClick={() => navigate("/assets")}
            className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-[#111113] text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 font-semibold text-sm active:scale-[0.98] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Voltar para Lista
          </button>
        </div>
      </div>
    );

  if (!asset) return null;

  const responsibleName =
    asset.assignedTo || asset.clientName || "__________________________";
  const derivedSector = asset.sector || "Adm/Op.";
  const showImei = asset.type === "Celular" || asset.type === "PGT";
  const showPrinterInfo = asset.type === "Impressora";
  const showIp =
    (asset.type === "Computador" ||
      asset.type === "Notebook" ||
      asset.type === "Rede" ||
      showPrinterInfo) &&
    asset.specs?.ip;
  const expandLocation = (loc) => loc || "Local não definido";
  const formatDate = (d) => {
    if (!d) return "N/A";
    const local = toLocalDate(d);
    return local ? formatDateBR(local) : "N/A";
  };
  const garantia = warrantyStatus(asset.warrantyEnd);


  return (
    <div className="max-w-[1920px] mx-auto pb-24 animate-fade-in relative min-h-screen">
      {/* Barra superior de navegação com botões de ação e exportação */}
      <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <button
          type="button"
          onClick={() => navigate("/assets")}
          className="group inline-flex items-center min-h-[44px] pr-3 rounded-xl text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-[#fafafa] transition-colors font-semibold text-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="w-10 h-10 inline-flex items-center justify-center rounded-full group-hover:bg-slate-100 dark:group-hover:bg-zinc-800 transition-colors mr-1.5">
            <ArrowLeft size={20} aria-hidden="true" />
          </span>
          Voltar para Lista
        </button>

        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 no-scrollbar">
          {/* Ações de escrita só para quem pode gravar: o visualizador via os
              botões, clicava e recebia erro de permissão do banco. */}
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => navigate(`/assets/edit/${id}`)}
                className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg rounded-xl font-semibold text-xs shadow-sm transition-colors active:scale-[0.98] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Edit3 size={15} aria-hidden="true" />{" "}
                <span className="hidden sm:inline">Editar Ativo</span>
              </button>
              <button
                type="button"
                onClick={() => setIsMoveModalOpen(true)}
                disabled={Boolean(lifecycleBlocker(asset, "movimentar"))}
                title={lifecycleBlocker(asset, "movimentar") || "Movimentar"}
                aria-label="Movimentar ativo"
                className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[44px] min-w-[44px] justify-center bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 rounded-xl font-semibold text-xs hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] whitespace-nowrap disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <ArrowRightLeft size={15} aria-hidden="true" />{" "}
                <span className="hidden sm:inline">Movimentar</span>
              </button>
              <button
                type="button"
                onClick={() => setIsMaintModalOpen(true)}
                disabled={Boolean(lifecycleBlocker(asset, "enviar para manutenção"))}
                title={lifecycleBlocker(asset, "enviar para manutenção") || "Manutenção"}
                aria-label="Registrar manutenção"
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] min-w-[44px] justify-center bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 rounded-xl font-semibold text-xs hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] whitespace-nowrap disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Wrench size={16} aria-hidden="true" />{" "}
                <span className="hidden sm:inline">Manutenção</span>
              </button>
            </>
          )}
          {canIssueTerms && !isRetired(asset?.status) && (
            <>
              <button
                type="button"
                onClick={() => setTermModal({ kind: "responsabilidade" })}
                disabled={Boolean(asset?.transit)}
                title="Termo de responsabilidade (entrega)"
                aria-label="Emitir termo de responsabilidade"
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] min-w-[44px] justify-center bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 rounded-xl font-semibold text-xs hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] whitespace-nowrap disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <FileSignature size={16} aria-hidden="true" />{" "}
                <span className="hidden sm:inline">Termo</span>
              </button>
              {asset?.assignedTo && (
                <button
                  type="button"
                  onClick={() => setTermModal({ kind: "devolucao" })}
                  disabled={Boolean(asset?.transit)}
                  title="Termo de devolução"
                  aria-label="Emitir termo de devolução"
                  className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] min-w-[44px] justify-center bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 rounded-xl font-semibold text-xs hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] whitespace-nowrap disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Undo2 size={16} aria-hidden="true" />{" "}
                  <span className="hidden sm:inline">Devolução</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setTermModal({ kind: "transferencia" })}
                disabled={Boolean(asset?.transit)}
                title="Transferir para uma loja com termo de transferência e recebimento"
                aria-label="Enviar para loja com termo de transferência"
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] min-w-[44px] justify-center bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 rounded-xl font-semibold text-xs hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] whitespace-nowrap disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Truck size={16} aria-hidden="true" />{" "}
                <span className="hidden sm:inline">Enviar p/ loja</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handlePrintLabel}
            aria-label="Imprimir etiqueta do ativo"
            className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] min-w-[44px] justify-center bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 rounded-xl font-semibold text-xs hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Printer size={16} aria-hidden="true" />{" "}
            <span className="hidden sm:inline">Etiqueta</span>
          </button>
          {canRetire && (
            isRetired(asset?.status) ? (
              <button
                type="button"
                onClick={handleReactivate}
                disabled={isReactivating}
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] min-w-[44px] justify-center bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-400 rounded-xl font-semibold text-xs hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors active:scale-[0.98] whitespace-nowrap disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <RotateCcw size={16} aria-hidden="true" />{" "}
                <span className="hidden sm:inline">{isReactivating ? "Reativando…" : "Reativar"}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsWriteOffOpen(true)}
                disabled={Boolean(asset?.transit)}
                title={asset?.transit ? lifecycleBlocker(asset, "dar baixa") : "Dar baixa"}
                aria-label="Dar baixa no ativo"
                className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] min-w-[44px] justify-center bg-white dark:bg-[#111113] border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 rounded-xl font-semibold text-xs hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] whitespace-nowrap disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Archive size={16} aria-hidden="true" />{" "}
                <span className="hidden sm:inline">Dar baixa</span>
              </button>
            )
          )}
          {canRetire && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              title="Excluir ativo"
              aria-label="Excluir ativo"
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60 rounded-xl font-semibold text-xs hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors active:scale-[0.98] ml-auto disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Ativo em transito: so muda de local quando o termo assinado pela loja for anexado */}
      {asset.transit && (
        <div className={`mb-6 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border px-4 py-3 text-xs ${asset.transit.missing ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300" : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200"}`}>
          <Truck size={20} className="shrink-0" aria-hidden="true" />
          <p className="text-sm font-bold flex-1 tabular-nums">
            {asset.transit.missing
              ? `Não recebido em ${asset.transit.to}: a loja registrou a falta deste item na conferência (${asset.transit.number}).`
              : `Em trânsito de ${asset.transit.from} para ${asset.transit.to}${asset.transit.since ? ` desde ${new Date(asset.transit.since).toLocaleDateString("pt-BR")}` : ""}. O local muda quando o termo assinado pela loja for anexado.`}
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => navigate(`/termos/${asset.transit.termId}`)}
              className="min-h-[44px] rounded-xl bg-white/80 dark:bg-[#111113] border border-slate-200/80 dark:border-zinc-800 px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-white dark:hover:bg-zinc-800 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Abrir {asset.transit.number}
            </button>
            {canIssueTerms && !asset.transit.missing && (
              <button
                type="button"
                onClick={() => navigate(`/termos/${asset.transit.termId}?anexar=1`)}
                className="min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark text-brand-fg px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Anexar assinado
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quadro de destaque no topo, exibindo a visão geral principal do equipamento */}
      <div className="bg-white dark:bg-[#111113] rounded-xl p-6 md:p-10 shadow-sm border border-slate-200/80 dark:border-zinc-800 relative overflow-hidden mb-8 group">
        <div
          className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-zinc-800/30 dark:to-zinc-800/10 rounded-bl-full -mr-16 -mt-16 opacity-50 pointer-events-none transition-transform duration-700 group-hover:scale-110"
          aria-hidden="true"
        />

        <div className="flex flex-col md:flex-row gap-8 relative z-10">
          <div className="shrink-0">
            <div className="w-24 h-24 md:w-32 md:h-32 bg-slate-50 dark:bg-zinc-900 rounded-xl flex items-center justify-center text-slate-900 dark:text-[#fafafa] shadow-inner border border-slate-200/80 dark:border-zinc-800">
              <AssetIcon
                type={asset.type}
                category={asset.category}
                model={asset.model}
                internalId={asset.internalId}
                size={48}
              />
            </div>
          </div>

          <div className="flex-grow pt-2">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <StatusBadge status={asset.status} />

              {/* Garantia: o dado so vale se estiver visivel onde se decide
                  abrir chamado ou trocar o equipamento. */}
              {garantia && (
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-wide tabular-nums ${WARRANTY_BADGE[garantia.state]}`}>
                  <ShieldCheck size={13} aria-hidden="true" />
                  {WARRANTY_LABEL[garantia.state]}
                  {garantia.state === 'expirando' && ` · ${garantia.days}d`}
                </span>
              )}

              <span className="text-sm font-mono text-slate-500 dark:text-zinc-400 font-bold">
                {asset.category}
              </span>
            </div>

            <h1 className="text-3xl md:text-5xl font-black text-slate-900 dark:text-[#fafafa] tracking-tight mb-2 leading-tight">
              {asset.model}
            </h1>

            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm font-medium text-slate-600 dark:text-zinc-400">
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-zinc-900 px-3 py-1 rounded-lg border border-slate-200/80 dark:border-zinc-800 group">
                <Tag size={16} className="text-slate-900 dark:text-[#fafafa]" aria-hidden="true" />
                <span className="font-mono font-bold text-slate-900 dark:text-[#fafafa] tabular-nums">
                  {asset.internalId}
                </span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(asset.internalId, "Patrimônio copiado!")}
                  className="-my-1.5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-[#fafafa] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  title="Copiar Patrimônio"
                  aria-label="Copiar Patrimônio"
                >
                  <Copy size={14} aria-hidden="true" />
                </button>
              </div>
              {asset.serialNumber && (
                <div className="flex items-center gap-2 px-2 py-1 group">
                  <BarcodeIcon className="text-slate-400 dark:text-zinc-500" />
                  <span className="font-mono tabular-nums">SN: {asset.serialNumber}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(asset.serialNumber, "Serial copiado!")}
                    className="-my-1.5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-[#fafafa] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    title="Copiar Serial"
                    aria-label="Copiar Serial"
                  >
                    <Copy size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 px-2 py-1.5 tabular-nums">
                <Clock size={16} className="text-slate-400 dark:text-zinc-500" aria-hidden="true" />
                <span>Atualizado: {formatDate(asset.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sistema de abas presente apenas na visão mobile para poupar espaço vertical na tela */}
      <div className="md:hidden flex mb-6 bg-slate-100 dark:bg-zinc-900 p-1 rounded-xl border border-slate-200/80 dark:border-zinc-800" role="tablist" aria-label="Seções do ativo">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "details"}
          onClick={() => setActiveTab("details")}
          className={`flex-1 min-h-[44px] py-2 rounded-lg text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${activeTab === "details" ? "bg-white dark:bg-[#111113] shadow-sm text-slate-900 dark:text-[#fafafa]" : "text-slate-500 dark:text-zinc-400"}`}
        >
          Detalhes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "history"}
          onClick={() => setActiveTab("history")}
          className={`flex-1 min-h-[44px] py-2 rounded-lg text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${activeTab === "history" ? "bg-white dark:bg-[#111113] shadow-sm text-slate-900 dark:text-[#fafafa]" : "text-slate-500 dark:text-zinc-400"}`}
        >
          Histórico
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Coluna principal contendo todos os formulários e campos detalhados do equipamento */}
        <div
          className={`lg:col-span-2 space-y-8 ${activeTab === "history" ? "hidden lg:block" : ""}`}
        >
          {/* Card com os dados do usuário atual em posse da máquina e sua localização física */}
          <div className="bg-white dark:bg-[#111113] rounded-xl p-6 md:p-8 border border-slate-200/80 dark:border-zinc-800 shadow-sm relative overflow-hidden">
            <h3 className="text-lg font-bold text-slate-900 dark:text-[#fafafa] mb-6 flex items-center gap-2">
              <User size={20} aria-hidden="true" /> Responsabilidade e Localização
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-50 dark:bg-zinc-900 p-5 rounded-xl border border-slate-200/80 dark:border-zinc-800">
                <p className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase mb-1">
                  Responsável Atual
                </p>
                <p className="font-bold text-slate-900 dark:text-[#fafafa] text-lg">
                  {responsibleName}
                </p>
                <div className="flex items-center gap-2 mt-2 text-xs font-medium text-slate-500 dark:text-zinc-400">
                  <Building2 size={13} aria-hidden="true" /> {derivedSector}
                </div>
                {asset.clientCpf && (
                  <div className="flex items-center gap-2 mt-2 text-xs font-mono font-medium text-slate-500 dark:text-zinc-400 tabular-nums">
                    <FileText size={13} aria-hidden="true" /> CPF: {asset.clientCpf}
                  </div>
                )}
              </div>
              <div className="bg-slate-50 dark:bg-zinc-900 p-5 rounded-xl border border-slate-200/80 dark:border-zinc-800">
                <p className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase mb-1">
                  Localização Física
                </p>
                <p className="font-bold text-slate-900 dark:text-[#fafafa] text-lg">
                  {expandLocation(asset.location)}
                </p>
                <div className="flex items-center gap-2 mt-2 text-xs font-medium text-slate-500 dark:text-zinc-400">
                  <MapPin size={13} aria-hidden="true" />{" "}
                  {asset.locationDetails || "Sem detalhes de sala/mesa"}
                </div>
              </div>
            </div>

            {/* Campo editável para adicionar ou alterar o CPF do responsável pelo ativo */}
            {canWrite && (
              <div className="mt-6 bg-slate-50 dark:bg-zinc-900 p-4 rounded-xl border border-slate-200/80 dark:border-zinc-800">
                <label htmlFor="cpf-input" className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase mb-2 block">
                  CPF do Responsável
                </label>
                <div className="flex gap-2">
                  <input
                    id="cpf-input"
                    name="clientCpf"
                    type="text"
                    placeholder="000.000.000-00"
                    value={cpfInput}
                    onChange={(e) => setCpfInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSaveCpf();
                      }
                    }}
                    className={`flex-1 px-4 py-2.5 min-h-[44px] border border-slate-200 rounded-xl font-mono font-bold text-sm text-slate-800 tabular-nums ${INPUT_7STATE}`}
                  />
                  <button
                    type="button"
                    onClick={handleSaveCpf}
                    disabled={savingCpf}
                    className="px-4 py-2.5 min-h-[44px] bg-brand hover:bg-brand-dark text-brand-fg rounded-xl font-bold text-sm transition-colors active:scale-[0.98] flex items-center gap-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Save size={14} aria-hidden="true" /> {savingCpf ? "Salvando…" : "Salvar"}
                  </button>
                </div>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-2">Este CPF será usado automaticamente no Termo de Responsabilidade.</p>
              </div>
            )}
          </div>

          {/* Card listando todas as chaves técnicas do hardware como identificadores e valores de componentes */}
          <div className="bg-white dark:bg-[#111113] rounded-xl p-6 md:p-8 border border-slate-200/80 dark:border-zinc-800 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                <Monitor size={20} aria-hidden="true" /> Especificações
              </h3>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-6 gap-x-4">
              <SpecItem label="Tipo" value={asset.type} />
              <SpecItem label="Marca" value={asset.brand || "Genérico"} />
              <SpecItem label="Modelo" value={asset.model} />

              {asset.specs?.processor && (
                <SpecItem label="Processador" value={asset.specs.processor} />
              )}
              {asset.specs?.ram && (
                <SpecItem label="Memória RAM" value={asset.specs.ram} />
              )}
              {asset.specs?.storage && (
                <SpecItem label="Armazenamento" value={asset.specs.storage} />
              )}

              {showImei && (
                <>
                  <SpecItem
                    label="IMEI 1"
                    value={asset.imei1 || "-"}
                    copyable
                  />
                  <SpecItem
                    label="IMEI 2"
                    value={asset.imei2 || "-"}
                    copyable
                  />
                </>
              )}

              {showIp && (
                <SpecItem
                  label="Endereço IP"
                  value={asset.specs.ip}
                  fontMono
                  copyable
                />
              )}
              {asset.macAddress && (
                <SpecItem
                  label="MAC Address"
                  value={asset.macAddress}
                  fontMono
                  copyable
                />
              )}

              <SpecItem
                label="Data de Aquisição"
                value={formatDate(asset.purchaseDate || asset.acquisitionDate)}
              />
              <SpecItem
                label="Valor Estimado"
                value={(() => {
                  const val = parseMoney(asset.valor ?? asset.value);
                  return val > 0 ? val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "-";
                })()}
              />
              {asset.invoiceNumber && (
                <SpecItem label="Nota Fiscal" value={asset.invoiceNumber} />
              )}

              {/* Campos Customizados Dinâmicos */}
              {config.customFields && config.customFields.map(cf => {
                  const val = asset.customData ? asset.customData[cf.id] : null;
                  if (!val) return null;
                  return (
                      <SpecItem 
                          key={cf.id} 
                          label={cf.label} 
                          value={cf.type === 'date' ? formatDate(val) : val} 
                      />
                  );
              })}
            </div>
          </div>

          {/* Lista gerenciável de pequenos acessórios extras fornecidos em conjunto com o equipamento */}
          <div className="bg-white dark:bg-[#111113] rounded-xl p-6 md:p-8 border border-slate-200/80 dark:border-zinc-800 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900 dark:text-[#fafafa] mb-6 flex items-center gap-2">
              <Plug size={20} aria-hidden="true" /> Periféricos & Acessórios
            </h3>

            <div className="flex flex-wrap gap-2 mb-6">
              {asset.peripherals && asset.peripherals.length > 0 ? (
                asset.peripherals.map((item, idx) => (
                  <div
                    key={item.id || `${item.name}-${stableTimestampPart(item.addedAt, idx)}`}
                    className="group flex items-center gap-2 bg-slate-50 dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 pl-3 pr-1.5 py-1 rounded-xl transition-colors hover:border-slate-300 dark:hover:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800/80"
                  >
                    <span className="text-sm font-medium text-slate-700 dark:text-zinc-200">
                      {item.name}
                    </span>
                    <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity ml-1">
                      <button
                        type="button"
                        onClick={() => handlePrintPeripheral(item)}
                        aria-label={`Imprimir etiqueta de ${item.name}`}
                        title="Imprimir etiqueta do acessório"
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center hover:bg-sky-50 dark:hover:bg-sky-950/40 text-sky-600 dark:text-sky-400 rounded-lg transition-colors focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <Printer size={14} aria-hidden="true" />
                      </button>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => handleDeletePeripheral(idx)}
                          aria-label={`Remover acessório ${item.name}`}
                          title="Remover acessório"
                          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-lg transition-colors focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <span className="text-sm text-slate-500 dark:text-zinc-400 italic">
                  Nenhum periférico vinculado.
                </span>
              )}
            </div>

            {canWrite && (
              <div className="flex gap-2 items-center">
                <label htmlFor="new-peripheral-input" className="sr-only">
                  Adicionar periférico ou acessório
                </label>
                <input
                  id="new-peripheral-input"
                  name="newPeripheral"
                  type="text"
                  placeholder="Adicionar (ex: Mouse Logitech, Base Dell…)"
                  className={`flex-1 min-h-[44px] border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-400 ${INPUT_7STATE}`}
                  value={newPeripheral}
                  onChange={(e) => setNewPeripheral(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddPeripheral()}
                />
                <button
                  type="button"
                  onClick={handleAddPeripheral}
                  disabled={isAddingPeripheral}
                  aria-label="Adicionar periférico"
                  className="bg-brand hover:bg-brand-dark text-brand-fg min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl disabled:opacity-50 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Plus size={18} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {/* Agrupamento final para notas detalhadas e armazenamento de links e arquivos digitais */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white dark:bg-[#111113] rounded-xl p-6 md:p-8 border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <label htmlFor="asset-notes-textarea" className="text-lg font-bold text-slate-900 dark:text-[#fafafa] flex items-center gap-2">
                  <StickyNote size={20} aria-hidden="true" /> Notas
                </label>
                {canWrite && (
                  <button
                    type="button"
                    onClick={handleSaveNotes}
                    disabled={isSavingNotes}
                    className="min-h-[44px] text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 px-3.5 py-2 rounded-xl transition-colors active:scale-[0.98] flex items-center gap-1.5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {isSavingNotes ? (
                      "Salvando…"
                    ) : (
                      <>
                        <Save size={14} aria-hidden="true" /> Salvar
                      </>
                    )}
                  </button>
                )}
              </div>
              <textarea
                id="asset-notes-textarea"
                name="notes"
                className={`w-full flex-1 border border-slate-200 rounded-xl p-4 text-sm text-slate-700 leading-relaxed resize-none min-h-[150px] read-only:opacity-80 ${INPUT_7STATE}`}
                placeholder={canWrite ? "Digite observações importantes sobre o ativo…" : "Nenhuma observação registrada."}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                readOnly={!canWrite}
              ></textarea>
            </div>

            <div className="bg-white dark:bg-[#111113] rounded-xl p-6 md:p-8 border border-slate-200/80 dark:border-zinc-800 shadow-sm flex flex-col">
              <h3 className="text-lg font-bold text-slate-900 dark:text-[#fafafa] mb-4 flex items-center gap-2">
                <LinkIcon size={20} aria-hidden="true" /> Anexos & Links
              </h3>

              <div className="flex-1 space-y-2 mb-4 overflow-y-auto max-h-[180px] custom-scrollbar">
                {asset.attachments?.map((link, i) => {
                  const href = safeLinkUrl(link.url);
                  return (
                    <div
                      key={link.id || `${link.url || link.name}-${stableTimestampPart(link.addedAt, i)}`}
                      className="[content-visibility:auto] [contain-intrinsic-size:auto_56px] flex justify-between items-center p-2.5 pl-3.5 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200/80 dark:border-zinc-800 hover:border-brand/40 dark:hover:border-zinc-700 transition-colors group"
                    >
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 text-sm font-medium text-brand-aa hover:underline truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
                        >
                          <FileText size={14} className="text-slate-400 dark:text-zinc-500 shrink-0" aria-hidden="true" />{" "}
                          {link.name}
                        </a>
                      ) : (
                        <span
                          title="Endereço bloqueado por segurança"
                          className="flex items-center gap-3 text-sm font-medium text-slate-400 dark:text-zinc-500 line-through truncate"
                        >
                          <FileText size={14} aria-hidden="true" />{" "}
                          {link.name}
                        </span>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => handleDeleteLink(i)}
                          aria-label={`Remover anexo ${link.name}`}
                          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 transition-colors ml-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {(!asset.attachments || asset.attachments.length === 0) && (
                  <p className="text-sm text-slate-500 dark:text-zinc-400 italic text-center py-4">
                    Nenhum link adicionado.
                  </p>
                )}
              </div>

              {canWrite && (
                <div className="flex flex-col gap-2 bg-slate-50 dark:bg-zinc-900 p-3 rounded-xl border border-slate-200/80 dark:border-zinc-800">
                  <label htmlFor="new-link-name" className="sr-only">
                    Nome do anexo ou link
                  </label>
                  <input
                    id="new-link-name"
                    name="newLinkName"
                    type="text"
                    placeholder="Nome (ex: Manual PDF)"
                    className={`border border-slate-200 rounded-lg px-3 py-2 min-h-[44px] text-xs font-bold text-slate-900 ${INPUT_7STATE}`}
                    value={newLinkName}
                    onChange={(e) => setNewLinkName(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <label htmlFor="new-link-url" className="sr-only">
                      URL do anexo ou link
                    </label>
                    <input
                      id="new-link-url"
                      name="newLinkUrl"
                      type="url"
                      placeholder="https://…"
                      className={`flex-1 border border-slate-200 rounded-lg px-3 py-2 min-h-[44px] text-xs text-slate-900 ${INPUT_7STATE}`}
                      value={newLinkUrl}
                      onChange={(e) => setNewLinkUrl(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={handleAddLink}
                      disabled={isAddingLink}
                      aria-label="Adicionar link ou anexo"
                      className="bg-brand hover:bg-brand-dark text-brand-fg min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg disabled:opacity-50 transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <Plus size={18} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {(asset.agent || ["Computador", "Notebook", "Servidor", "Desktop", "All-in-One"].includes(asset.type)) && (
            <AgentInventoryCard asset={{ ...asset, id }} />
          )}
        </div>

        {/* Coluna secundária reservada exclusivamente para a linha do tempo e registro do que aconteceu no sistema */}
        <div
          className={`lg:col-span-1 space-y-6 ${activeTab === "details" ? "hidden lg:block" : ""}`}
        >
          <AssetTermsCard tenantId={asset.tenantId || tenantId} assetId={id} refreshKey={termsVersion} />
          <div className="bg-white dark:bg-[#111113] rounded-xl p-6 border border-slate-200/80 dark:border-zinc-800 shadow-sm h-full flex flex-col">
            <h3 className="text-lg font-bold text-slate-900 dark:text-[#fafafa] mb-6 flex items-center gap-2">
              <History size={20} aria-hidden="true" /> Linha do Tempo
            </h3>

            <div className="relative border-l-2 border-slate-200 dark:border-zinc-800 ml-3 space-y-8 pb-8">
              {history.length === 0 && (
                <p className="text-sm text-slate-500 dark:text-zinc-400 pl-6 italic">
                  Sem histórico registrado.
                </p>
              )}
              {history.map((item, index) => (
                <div
                  key={item.id || `${item.action || 'item'}-${stableTimestampPart(item.date, index)}`}
                  className="[content-visibility:auto] [contain-intrinsic-size:auto_56px] relative pl-6 group"
                >
                  <div
                    className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white dark:border-[#111113] shadow-sm ${item.action?.includes("Manutenção") ? "bg-amber-500" : item.action?.includes("Entrega") ? "bg-emerald-500" : "bg-zinc-400"} group-hover:scale-125 transition-transform`}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-0.5 block tabular-nums">
                    {formatDate(item.date)}
                  </span>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-[#fafafa]">
                    {item.action}
                  </h4>

                  {/* Mostra em lista organizada caso existam múltiplas alterações geradas no processo de edição */}
                  {item.details && (
                    <div className="text-xs text-slate-600 dark:text-zinc-300 mt-1 leading-relaxed bg-slate-50 dark:bg-zinc-900 p-3 rounded-xl border border-slate-200/80 dark:border-zinc-800">
                      {item.action === "Edição de Ativo" &&
                      item.details.includes(", Alterou ") ? (
                        <ul className="list-disc pl-4 space-y-1">
                          {item.details.split(", ").map((diff, i) => (
                            <li key={`${diff}-${i}`}>{diff}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>{item.details}</p>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-2 font-medium flex items-center gap-1.5">
                    <User size={12} aria-hidden="true" /> {item.user || "Sistema"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Janelas flutuantes que surgem na frente da tela principal para preenchimento de formulários e etapas em processo */}
      {isMoveModalOpen && (
        <MoveAssetModal
          isOpen={isMoveModalOpen}
          onClose={() => setIsMoveModalOpen(false)}
          onConfirm={handleMoveConfirm}
          asset={asset}
        />
      )}
      {isMaintModalOpen && (
        <MaintenanceModal
          isOpen={isMaintModalOpen}
          onClose={() => setIsMaintModalOpen(false)}
          onConfirm={handleMaintenanceConfirm}
          asset={asset}
        />
      )}
      {termModal && termModal.kind !== "transferencia" && (
        <TermIssueModal
          kind={termModal.kind}
          initialAssets={[asset]}
          onClose={() => setTermModal(null)}
          onIssued={() => setTermsVersion((v) => v + 1)}
        />
      )}
      {termModal?.kind === "transferencia" && (
        <TransferModal
          initialAssets={[asset]}
          onClose={() => setTermModal(null)}
          onDispatched={() => setTermsVersion((v) => v + 1)}
        />
      )}
      <WriteOffModal
        isOpen={isWriteOffOpen}
        onClose={() => setIsWriteOffOpen(false)}
        asset={asset}
        onConfirm={handleWriteOff}
        saving={writingOff}
      />
    </div>
  );
};

// Componentes minimalistas e locais que evitam muita repetição na exibição das especificações
const SpecItem = ({ label, value, fontMono, copyable }) => (
  <div className="flex flex-col">
    <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
      {label}
    </span>
    <div className="flex items-center gap-1.5 min-h-[32px]">
      <span
        className={`text-sm font-medium text-slate-800 dark:text-[#fafafa] tabular-nums ${fontMono ? "font-mono" : ""} truncate max-w-full`}
        title={value}
      >
        {value || "---"}
      </span>
      {copyable && value && (
        <button
          type="button"
          onClick={() => copyToClipboard(value, `${label} copiado!`)}
          aria-label={`Copiar ${label}`}
          title={`Copiar ${label}`}
          className="-my-1.5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-[#fafafa] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <CopyIcon size={14} />
        </button>
      )}
    </div>
  </div>
);

const CopyIcon = ({ size }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2-2v1"></path>
  </svg>
);
const BarcodeIcon = ({ className }) => (
  <svg
    className={className}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 5v14" />
    <path d="M8 5v14" />
    <path d="M12 5v14" />
    <path d="M17 5v14" />
    <path d="M21 5v14" />
  </svg>
);

export default AssetDetail;

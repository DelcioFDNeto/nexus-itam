// src/pages/AssetDetail.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
} from "lucide-react";

import AssetIcon from "../components/AssetIcon";

const AssetDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const confirm = useConfirm();

  const tenantId = currentUser?.tenantId;

  // Estados principais da página
  const [asset, setAsset] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
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
  const [activeTab, setActiveTab] = useState("details"); // 'details' | 'history' (Mobile)

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
    setLoading(true);

    if (currentUser?.authSource === 'gateway') {
      let active = true;
      getAssetById(id, tenantId)
        .then((data) => {
          if (!active) return;
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
          if (active) navigate("/assets");
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
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [id, navigate, currentUser?.authSource, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!newLinkUrl || !newLinkName)
      return toast.warning("Preencha o nome e o link!");
    setIsAddingLink(true);
    const userEmail = currentUser?.email || "Usuário Desconhecido";
    const tenantId = asset?.tenantId || currentUser?.tenantId;
    try {
      const currentLinks = asset.attachments || [];
      const newLink = {
        name: newLinkName,
        url: newLinkUrl,
        type: "link",
        addedAt: new Date(),
      };
      await updateAsset(
        id,
        { attachments: [...currentLinks, newLink], tenantId },
        {
          action: "Novo Anexo",
          details: `Adicionado link/documento: ${newLinkName}`,
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-black dark:border-white"></div>
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
          onClick={() => navigate("/assets")}
          className="group flex items-center text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors font-bold text-sm"
        >
          <div className="p-2 rounded-full group-hover:bg-gray-100 dark:group-hover:bg-slate-800 transition-all mr-2">
            <ArrowLeft size={20} />
          </div>
          Voltar para Lista
        </button>

        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
          {/* Ações de escrita só para quem pode gravar: o visualizador via os
              botões, clicava e recebia erro de permissão do banco. */}
          {canWrite && (
            <>
              <button
                onClick={() => navigate(`/assets/edit/${id}`)}
                className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg font-semibold text-xs shadow-sm hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors whitespace-nowrap"
              >
                <Edit3 size={15} />{" "}
                <span className="hidden sm:inline">Editar Ativo</span>
              </button>
              <button
                onClick={() => setIsMoveModalOpen(true)}
                disabled={Boolean(lifecycleBlocker(asset, "movimentar"))}
                title={lifecycleBlocker(asset, "movimentar") || "Movimentar"}
                className="flex items-center gap-2 px-3.5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-semibold text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap disabled:opacity-40"
              >
                <ArrowRightLeft size={15} />{" "}
                <span className="hidden sm:inline">Movimentar</span>
              </button>
              <button
                onClick={() => setIsMaintModalOpen(true)}
                disabled={Boolean(lifecycleBlocker(asset, "enviar para manutenção"))}
                title={lifecycleBlocker(asset, "enviar para manutenção") || "Manutenção"}
                className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-all whitespace-nowrap disabled:opacity-40"
              >
                <Wrench size={16} />{" "}
                <span className="hidden sm:inline">Manutenção</span>
              </button>
            </>
          )}
          {canIssueTerms && !isRetired(asset?.status) && (
            <>
              <button
                onClick={() => setTermModal({ kind: "responsabilidade" })}
                disabled={Boolean(asset?.transit)}
                title="Termo de responsabilidade (entrega)"
                className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-all whitespace-nowrap disabled:opacity-40"
              >
                <FileSignature size={16} />{" "}
                <span className="hidden sm:inline">Termo</span>
              </button>
              {asset?.assignedTo && (
                <button
                  onClick={() => setTermModal({ kind: "devolucao" })}
                  disabled={Boolean(asset?.transit)}
                  title="Termo de devolução"
                  className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-all whitespace-nowrap disabled:opacity-40"
                >
                  <Undo2 size={16} />{" "}
                  <span className="hidden sm:inline">Devolução</span>
                </button>
              )}
              <button
                onClick={() => setTermModal({ kind: "transferencia" })}
                disabled={Boolean(asset?.transit)}
                title="Transferir para uma loja com termo de transferência e recebimento"
                className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-all whitespace-nowrap disabled:opacity-40"
              >
                <Truck size={16} />{" "}
                <span className="hidden sm:inline">Enviar p/ loja</span>
              </button>
            </>
          )}
          <button
            onClick={handlePrintLabel}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-all whitespace-nowrap"
          >
            <Printer size={16} />{" "}
            <span className="hidden sm:inline">Etiqueta</span>
          </button>
          {canRetire && (
            isRetired(asset?.status) ? (
              <button
                onClick={handleReactivate}
                disabled={isReactivating}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-xl font-bold text-sm hover:bg-emerald-100 transition-all whitespace-nowrap disabled:opacity-50"
              >
                <RotateCcw size={16} />{" "}
                <span className="hidden sm:inline">{isReactivating ? "Reativando..." : "Reativar"}</span>
              </button>
            ) : (
              <button
                onClick={() => setIsWriteOffOpen(true)}
                disabled={Boolean(asset?.transit)}
                title={asset?.transit ? lifecycleBlocker(asset, "dar baixa") : "Dar baixa"}
                className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-200 rounded-xl font-bold text-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-all whitespace-nowrap disabled:opacity-40"
              >
                <Archive size={16} />{" "}
                <span className="hidden sm:inline">Dar baixa</span>
              </button>
            )
          )}
          {canRetire && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              title="Excluir ativo"
              aria-label="Excluir ativo"
              className="flex items-center gap-2 px-3.5 py-2 bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 rounded-lg font-semibold text-xs hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors ml-auto disabled:opacity-50"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Ativo em transito: so muda de local quando o termo assinado pela loja for anexado */}
      {asset.transit && (
        <div className={`mb-6 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border px-4 py-3 text-xs ${asset.transit.missing ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300" : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300"}`}>
          <Truck size={20} className="shrink-0" />
          <p className="text-sm font-bold flex-1">
            {asset.transit.missing
              ? `Não recebido em ${asset.transit.to}: a loja registrou a falta deste item na conferência (${asset.transit.number}).`
              : `Em trânsito de ${asset.transit.from} para ${asset.transit.to}${asset.transit.since ? ` desde ${new Date(asset.transit.since).toLocaleDateString("pt-BR")}` : ""}. O local muda quando o termo assinado pela loja for anexado.`}
          </p>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => navigate(`/termos/${asset.transit.termId}`)}
              className="rounded-xl bg-white/70 dark:bg-slate-900/60 px-4 py-2 text-xs font-black uppercase tracking-wider"
            >
              Abrir {asset.transit.number}
            </button>
            {canIssueTerms && !asset.transit.missing && (
              <button
                onClick={() => navigate(`/termos/${asset.transit.termId}?anexar=1`)}
                className="rounded-xl bg-blue-600 text-white px-4 py-2 text-xs font-black uppercase tracking-wider hover:bg-blue-700"
              >
                Anexar assinado
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quadro de destaque no topo, exibindo a visão geral principal do equipamento */}
      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 md:p-10 shadow-sm border border-gray-100 dark:border-slate-700 relative overflow-hidden mb-8 group">
        <div
          className={`absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-700/30 dark:to-slate-700/10 rounded-bl-full -mr-16 -mt-16 opacity-50 pointer-events-none transition-all duration-700 group-hover:scale-110`}
        ></div>

        <div className="flex flex-col md:flex-row gap-8 relative z-10">
          <div className="flex-shrink-0">
            <div className="w-24 h-24 md:w-32 md:h-32 bg-gray-50 dark:bg-slate-900 rounded-xl flex items-center justify-center text-gray-900 dark:text-white shadow-inner border border-gray-100 dark:border-slate-700">
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
            <div className="flex flex-col md:flex-row md:items-center gap-4 mb-2">
              <StatusBadge status={asset.status} />

              {/* Garantia: o dado so vale se estiver visivel onde se decide
                  abrir chamado ou trocar o equipamento. */}
              {garantia && (
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${WARRANTY_BADGE[garantia.state]}`}>
                  <ShieldCheck size={12} />
                  {WARRANTY_LABEL[garantia.state]}
                  {garantia.state === 'expirando' && ` · ${garantia.days}d`}
                </span>
              )}

              <span className="text-sm font-mono text-gray-400 dark:text-gray-500 font-bold">
                {asset.category}
              </span>
            </div>

            <h1 className="text-3xl md:text-5xl font-black text-gray-900 dark:text-white tracking-tight mb-2 leading-tight">
              {asset.model}
            </h1>

            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm font-medium text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-900 px-3 py-1.5 rounded-lg border border-gray-100 dark:border-slate-700 group">
                <Tag size={16} className="text-black dark:text-white" />
                <span className="font-mono font-bold text-gray-900 dark:text-white">
                  {asset.internalId}
                </span>
                <button onClick={() => { navigator.clipboard.writeText(asset.internalId); toast.success("Patrimônio copiado!"); }} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-gray-400 dark:text-gray-500 hover:text-black dark:hover:text-white transition-all" title="Copiar Patrimônio">
                  <Copy size={14} />
                </button>
              </div>
              {asset.serialNumber && (
                <div className="flex items-center gap-2 px-2 py-1.5 group">
                  <BarcodeIcon className="text-gray-400 dark:text-gray-500" />
                  <span className="font-mono">SN: {asset.serialNumber}</span>
                  <button onClick={() => { navigator.clipboard.writeText(asset.serialNumber); toast.success("Serial copiado!"); }} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-gray-400 dark:text-gray-500 hover:text-black dark:hover:text-white transition-all" title="Copiar Serial">
                    <Copy size={14} />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Clock size={16} className="text-gray-400 dark:text-gray-500" />
                <span>Atualizado: {formatDate(asset.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sistema de abas presente apenas na visão mobile para poupar espaço vertical na tela */}
      <div className="md:hidden flex mb-6 bg-gray-100 dark:bg-slate-900 p-1 rounded-xl">
        <button
          onClick={() => setActiveTab("details")}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === "details" ? "bg-white dark:bg-slate-800 shadow-sm text-black dark:text-white" : "text-gray-500 dark:text-gray-400"}`}
        >
          Detalhes
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === "history" ? "bg-white dark:bg-slate-800 shadow-sm text-black dark:text-white" : "text-gray-500 dark:text-gray-400"}`}
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
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 md:p-8 border border-gray-100 dark:border-slate-700 shadow-sm relative overflow-hidden">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
              <User size={20} /> Responsabilidade e Localização
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-gray-50 dark:bg-slate-900 p-5 rounded-xl border border-gray-100 dark:border-slate-700">
                <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">
                  Responsável Atual
                </p>
                <p className="font-bold text-gray-900 dark:text-white text-lg">
                  {responsibleName}
                </p>
                <div className="flex items-center gap-2 mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                  <Building2 size={12} /> {derivedSector}
                </div>
                {asset.clientCpf && (
                  <div className="flex items-center gap-2 mt-2 text-xs font-mono font-medium text-gray-500 dark:text-gray-400">
                    <FileText size={12} /> CPF: {asset.clientCpf}
                  </div>
                )}
              </div>
              <div className="bg-gray-50 dark:bg-slate-900 p-5 rounded-xl border border-gray-100 dark:border-slate-700">
                <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">
                  Localização Física
                </p>
                <p className="font-bold text-gray-900 dark:text-white text-lg">
                  {expandLocation(asset.location)}
                </p>
                <div className="flex items-center gap-2 mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                  <MapPin size={12} />{" "}
                  {asset.locationDetails || "Sem detalhes de sala/mesa"}
                </div>
              </div>
            </div>

            {/* Campo editável para adicionar ou alterar o CPF do responsável pelo ativo */}
            {canWrite && (
              <div className="mt-6 bg-gray-50 dark:bg-slate-900 p-4 rounded-xl border border-gray-100 dark:border-slate-700">
                <label className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase mb-2 block">
                  CPF do Responsável
                </label>
                <div className="flex gap-2">
                  <input
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
                    className="flex-1 px-4 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl font-mono font-bold text-sm text-gray-800 dark:text-gray-100 outline-none focus:border-black dark:focus:border-white transition-colors"
                    id="cpf-input"
                  />
                  <button
                    onClick={handleSaveCpf}
                    disabled={savingCpf}
                    className="px-4 py-2.5 bg-black text-white dark:bg-white dark:text-slate-900 rounded-xl font-bold text-sm hover:bg-gray-800 dark:hover:bg-slate-200 transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
                  >
                    <Save size={14} /> {savingCpf ? "Salvando..." : "Salvar"}
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">Este CPF será usado automaticamente no Termo de Responsabilidade.</p>
              </div>
            )}
          </div>

          {/* Card listando todas as chaves técnicas do hardware como identificadores e valores de componentes */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 md:p-8 border border-gray-100 dark:border-slate-700 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Monitor size={20} /> Especificações
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
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 md:p-8 border border-gray-100 dark:border-slate-700 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
              <Plug size={20} /> Periféricos & Acessórios
            </h3>

            <div className="flex flex-wrap gap-2 mb-6">
              {asset.peripherals && asset.peripherals.length > 0 ? (
                asset.peripherals.map((item, idx) => (
                  <div
                    key={idx}
                    className="group flex items-center gap-2 bg-gray-50 dark:bg-slate-900 border border-gray-100 dark:border-slate-700 pl-3 pr-2 py-2 rounded-xl transition-all hover:border-gray-300 hover:bg-white dark:hover:bg-slate-800 hover:shadow-sm"
                  >
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {item.name}
                    </span>
                    <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity ml-2">
                      <button
                        onClick={() => handlePrintPeripheral(item)}
                        className="p-1 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded"
                      >
                        <Printer size={12} />
                      </button>
                      {canWrite && (
                        <button
                          onClick={() => handleDeletePeripheral(idx)}
                          className="p-1 hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 rounded"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <span className="text-sm text-gray-400 dark:text-gray-500 italic">
                  Nenhum periférico vinculado.
                </span>
              )}
            </div>

            {canWrite && (
              <div className="bg-gray-50 dark:bg-slate-900 rounded-xl p-2 flex gap-2 border border-slate-200/80 dark:border-slate-800">
                <input
                  type="text"
                  placeholder="Adicionar (ex: Mouse Logitech, Base Dell...)"
                  className="flex-1 bg-transparent px-3 text-xs font-medium outline-none text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  value={newPeripheral}
                  onChange={(e) => setNewPeripheral(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddPeripheral()}
                />
                <button
                  onClick={handleAddPeripheral}
                  disabled={isAddingPeripheral}
                  className="bg-slate-900 text-white dark:bg-white dark:text-slate-900 p-2 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-50 transition-colors"
                >
                  <Plus size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Agrupamento final para notas detalhadas e armazenamento de links e arquivos digitais */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 md:p-8 border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <StickyNote size={20} /> Notas
                </h3>
                {canWrite && (
                  <button
                    onClick={handleSaveNotes}
                    disabled={isSavingNotes}
                    className="text-xs font-bold bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    {isSavingNotes ? (
                      "Salvando..."
                    ) : (
                      <>
                        <Save size={12} /> Salvar
                      </>
                    )}
                  </button>
                )}
              </div>
              <textarea
                className="w-full flex-1 bg-yellow-50/50 dark:bg-slate-900/50 border border-yellow-100 dark:border-yellow-900/30 rounded-xl p-4 text-sm text-gray-700 dark:text-gray-200 leading-relaxed focus:bg-white dark:focus:bg-slate-900 focus:border-yellow-300 dark:focus:border-yellow-600 focus:ring-4 focus:ring-yellow-50 dark:focus:ring-yellow-950/20 outline-none transition-all resize-none min-h-[150px] disabled:opacity-75"
                placeholder={canWrite ? "Digite observações importantes sobre o ativo..." : "Nenhuma observação registrada."}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                readOnly={!canWrite}
              ></textarea>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl p-6 md:p-8 border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <LinkIcon size={20} /> Anexos & Links
              </h3>

              <div className="flex-1 space-y-2 mb-4 overflow-y-auto max-h-[150px] custom-scrollbar">
                {asset.attachments?.map((link, i) => {
                  const href = safeLinkUrl(link.url);
                  return (
                    <div
                      key={i}
                      className="flex justify-between items-center p-3 rounded-xl bg-gray-50 dark:bg-slate-900 border border-gray-100 dark:border-slate-700 hover:border-blue-200 dark:hover:border-slate-600 transition-colors group"
                    >
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline truncate"
                        >
                          <FileText size={14} className="text-gray-400 dark:text-gray-500" />{" "}
                          {link.name}
                        </a>
                      ) : (
                        <span
                          title="Endereço bloqueado por segurança"
                          className="flex items-center gap-3 text-sm font-medium text-gray-400 line-through truncate"
                        >
                          <FileText size={14} />{" "}
                          {link.name}
                        </span>
                      )}
                      {canWrite && (
                        <button
                          onClick={() => handleDeleteLink(i)}
                          className="text-gray-400 dark:text-gray-500 hover:text-red-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all ml-2"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {(!asset.attachments || asset.attachments.length === 0) && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic text-center py-4">
                    Nenhum link adicionado.
                  </p>
                )}
              </div>

              {canWrite && (
                <div className="flex flex-col gap-2 bg-gray-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <input
                    type="text"
                    placeholder="Nome (ex: Manual PDF)"
                    className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-xs font-bold text-gray-900 dark:text-white outline-none focus:border-black dark:focus:border-white"
                    value={newLinkName}
                    onChange={(e) => setNewLinkName(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <input
                      type="url"
                      placeholder="https://..."
                      className="flex-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-xs text-gray-900 dark:text-white outline-none focus:border-black dark:focus:border-white"
                      value={newLinkUrl}
                      onChange={(e) => setNewLinkUrl(e.target.value)}
                    />
                    <button
                      onClick={handleAddLink}
                      disabled={isAddingLink}
                      className="bg-black text-white dark:bg-white dark:text-slate-900 p-2 rounded-lg hover:bg-gray-800 dark:hover:bg-slate-200 disabled:opacity-50"
                    >
                      <Plus size={16} />
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
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-gray-100 dark:border-slate-700 shadow-sm h-full flex flex-col">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
              <History size={20} /> Linha do Tempo
            </h3>

            <div className="relative border-l-2 border-gray-100 dark:border-slate-700 ml-3 space-y-8 pb-8">
              {history.length === 0 && (
                <p className="text-sm text-gray-400 dark:text-gray-500 pl-6 italic">
                  Sem histórico registrado.
                </p>
              )}
              {history.map((item, index) => (
                <div key={item.id || index} className="relative pl-6 group">
                  <div
                    className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white shadow-sm ${item.action?.includes("Manutenção") ? "bg-orange-500" : item.action?.includes("Entrega") ? "bg-green-500" : "bg-gray-400"} group-hover:scale-125 transition-transform`}
                  ></div>
                  <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-0.5 block">
                    {formatDate(item.date)}
                  </span>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                    {item.action}
                  </h4>

                  {/* Mostra em lista organizada caso existam múltiplas alterações geradas no processo de edição */}
                  {item.details && (
                    <div className="text-xs text-gray-600 mt-1 leading-relaxed bg-gray-50 dark:bg-slate-900 p-3 rounded-xl border border-gray-100 dark:border-slate-700">
                      {item.action === "Edição de Ativo" &&
                      item.details.includes(", Alterou ") ? (
                        <ul className="list-disc pl-4 space-y-1">
                          {item.details.split(", ").map((diff, i) => (
                            <li key={i}>{diff}</li>
                          ))}
                        </ul>
                      ) : (
                        <p>{item.details}</p>
                      )}
                    </div>
                  )}

                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2 font-medium flex items-center gap-1">
                    <User size={10} /> {item.user || "Sistema"}
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
    <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
      {label}
    </span>
    <div className="flex items-center gap-2">
      <span
        className={`text-sm font-medium text-gray-800 dark:text-gray-100 ${fontMono ? "font-mono" : ""} truncate max-w-full`}
        title={value}
      >
        {value || "---"}
      </span>
      {copyable && value && (
        <button
          onClick={() => {
            navigator.clipboard.writeText(value);
            toast.success(`${label} copiado!`);
          }}
          className="text-gray-300 hover:text-black transition-colors"
        >
          <CopyIcon size={12} />
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
  >
    <path d="M3 5v14" />
    <path d="M8 5v14" />
    <path d="M12 5v14" />
    <path d="M17 5v14" />
    <path d="M21 5v14" />
  </svg>
);

export default AssetDetail;

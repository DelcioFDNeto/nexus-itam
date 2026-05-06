// src/pages/AssetList.jsx
import React, { useState, useEffect, useMemo } from "react";
import { db } from "../services/firebase";
import { collection, query, orderBy, onSnapshot, doc, getDoc } from "firebase/firestore";
import { updateAsset } from "../services/assetService";
import { Link, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import ReactDOMServer from "react-dom/server";
import { toast } from "sonner";
import AssetListSkeleton from "../components/assets/AssetListSkeleton";
import AssetIcon from "../components/AssetIcon";
import AssetMetrics from "../components/assets/AssetMetrics";
import {
  Search,
  Plus,
  Filter,
  LayoutGrid,
  Smartphone,
  Monitor,
  Printer,
  Network,
  MapPin,
  User,
  FileText,
  Laptop,
  Megaphone,
  CreditCard,
  Download,
  CheckSquare,
  Square,
  Printer as PrinterIcon,
  RefreshCcw,
  X,
  Check,
  ArrowDownAZ,
  ArrowUpAZ,
  Clock,
  AlertCircle,
  ChevronRight,
  Plug,
  MoreVertical,
  SlidersHorizontal,
  Package,
} from "lucide-react";

const getCompanyLabel = (companyName) =>
  (companyName || "Nexus ITAM").trim() || "Nexus ITAM";

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const AssetList = () => {
  const navigate = useNavigate();

  // Estados que controlam a lista de ativos e o carregamento da tela
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState({
    companyName: "Nexus ITAM",
  });

  // Definições de filtros de pesquisa e ordenação da tabela (Persistidos na Sessão)
  const [searchTerm, setSearchTerm] = useState(() => sessionStorage.getItem("itam_asset_searchTerm") || "");
  const [filterType, setFilterType] = useState(() => sessionStorage.getItem("itam_asset_filterType") || "Todos");
  const [filterStatus, setFilterStatus] = useState(() => sessionStorage.getItem("itam_asset_filterStatus") || "Todos");
  const [sortOrder, setSortOrder] = useState(() => sessionStorage.getItem("itam_asset_sortOrder") || "asc");
  const [sortBy, setSortBy] = useState(() => sessionStorage.getItem("itam_asset_sortBy") || "internalId");

  useEffect(() => {
    sessionStorage.setItem("itam_asset_searchTerm", searchTerm);
    sessionStorage.setItem("itam_asset_filterType", filterType);
    sessionStorage.setItem("itam_asset_filterStatus", filterStatus);
    sessionStorage.setItem("itam_asset_sortBy", sortBy);
    sessionStorage.setItem("itam_asset_sortOrder", sortOrder);
  }, [searchTerm, filterType, filterStatus, sortBy, sortOrder]);

  // Controle da seleção múltipla para exportação, impressão corporativa e edições conjuntas
  const [selectedIds, setSelectedIds] = useState([]);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "assets"), orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const assetData = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setAssets(assetData);
        setLoading(false);
      },
      (error) => {
        console.error("Erro ao sincronizar ativos:", error);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const settingsRef = doc(db, "settings", "general");
        const snap = await getDoc(settingsRef);
        if (snap.exists()) {
          setConfig((prev) => ({
            ...prev,
            ...snap.data(),
          }));
        }
      } catch (err) {
        console.error("Erro ao carregar configurações:", err);
      }
    };

    loadConfig();
  }, []);

  // Processa a lista de ativos otimizando filtragem e ordenação dependendo das seleções do menu
  const processedAssets = useMemo(() => {
    const safeLower = (val) => (val || "").toString().toLowerCase();
    const getTimeValue = (value) => {
      if (!value) return 0;
      if (value?.toDate) return value.toDate().getTime();
      if (value?.seconds) return value.seconds * 1000;
      const parsed = new Date(value).getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    // Filtra logicamente antes de devolver a lista visual de ativos
    let result = assets.filter((asset) => {
      const isPromo =
        asset.category === "Promocional" || asset.internalId?.includes("PRM");

      // Busca por correspondências em diversos campos textuais do registro
      const term = safeLower(searchTerm);
      const matchesSearch =
        safeLower(asset.model).includes(term) ||
        safeLower(asset.internalId).includes(term) ||
        safeLower(asset.serialNumber).includes(term) ||
        safeLower(asset.assignedTo).includes(term) ||
        safeLower(asset.clientName).includes(term) ||
        safeLower(asset.vendedor).includes(term);

      if (!matchesSearch) return false;

      // Limita resultados focando num status específico (Ex: Em Uso, Defeito)
      if (filterStatus !== "Todos" && asset.status !== filterStatus)
        return false;

      // Navega rapidamente através das abas horizontais focadas no tipo da máquina
      if (filterType === "Todos") return true;
      if (filterType === "Promocionais") return isPromo;
      if (isPromo) return false;

      if (filterType === "Notebook")
        return (
          asset.type === "Notebook" ||
          safeLower(asset.model).includes("notebook")
        );
      if (filterType === "Computador")
        return (
          asset.type === "Computador" &&
          !safeLower(asset.model).includes("notebook")
        );

      return asset.type === filterType;
    });

    // Ordena os resultados finais por data de registro ou alfabeticamente/numericamente.
    return result.sort((a, b) => {
      if (sortBy === "createdAt") {
        const valA = getTimeValue(a.createdAt);
        const valB = getTimeValue(b.createdAt);
        return sortOrder === "asc" ? valA - valB : valB - valA;
      }

      const valA = safeLower(a[sortBy]);
      const valB = safeLower(b[sortBy]);
      return sortOrder === "asc"
        ? valA.localeCompare(valB, undefined, {
            numeric: true,
            sensitivity: "base",
          })
        : valB.localeCompare(valA, undefined, {
            numeric: true,
            sensitivity: "base",
          });
    });
  }, [assets, searchTerm, filterType, filterStatus, sortBy, sortOrder]);

  const toggleSelectAll = () => {
    if (selectedIds.length === processedAssets.length) setSelectedIds([]);
    else setSelectedIds(processedAssets.map((a) => a.id));
  };

  const toggleSelectOne = (id) => {
    if (selectedIds.includes(id))
      setSelectedIds((prev) => prev.filter((itemId) => itemId !== id));
    else setSelectedIds((prev) => [...prev, id]);
  };

  const selectedAssetsData = useMemo(() => {
    return assets.filter((a) => selectedIds.includes(a.id));
  }, [assets, selectedIds]);

  const selectedPeripheralsData = useMemo(() => {
    return selectedAssetsData.flatMap((asset) => {
      const peripherals = asset.peripherals || [];
      return peripherals.map((p) => ({
        ...p,
        parentId: asset.internalId,
        parentModel: asset.model,
      }));
    });
  }, [selectedAssetsData]);

  // Abre uma nova janela com HTML autocontido e aciona a impressão (compatível com mobile)
  const printInNewWindow = (htmlContent) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Popup bloqueado! Permita popups para imprimir.');
      return;
    }
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 500);
    };
  };

  const handleBulkPrint = () => {
    if (selectedAssetsData.length === 0) return;
    const companyLabel = escapeHtml(getCompanyLabel(config.companyName).toLocaleUpperCase("pt-BR"));
    const supportEmail = escapeHtml((config.supportEmail || "shiadmti@gmail.com").trim() || "shiadmti@gmail.com");
    const labelsHtml = selectedAssetsData.map((asset) => {
      const qrSvg = ReactDOMServer.renderToStaticMarkup(<QRCodeSVG value={asset.internalId} size={68} level="M" />);
      return `<div class="bulk-label">
        <div class="qr">${qrSvg}</div>
        <div class="info">
          <div class="logo-row" style="font-weight: 900; font-family: sans-serif; display: flex; align-items: center; justify-content: flex-start; gap: 4px; color: #4F46E5; font-size: 14px; letter-spacing: -0.5px;">
            <div class="brand-line">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>
              Nexus<span style="color: #111827">ITAM</span>
            </div>
            <div class="company-line">${companyLabel}</div>
          </div>
          <div class="id-section">
            <span class="id-label">Patrimônio</span>
            <span class="id-value">${asset.internalId}</span>
            <span class="model">${asset.model}</span>
          </div>
          <div class="footer-row">
            <span class="footer-left">SUPORTE TI</span>
            <span class="footer-right">${supportEmail}</span>
          </div>
        </div>
      </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Etiquetas_Ativos_NexusITAM</title>
<style>
  @page { size: A4; margin: 5mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { margin: 0; padding: 5mm; font-family: Arial, sans-serif; -webkit-print-color-adjust: exact; }
  .print-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5mm; justify-items: center; width: 100%; }
  .bulk-label { width: 7cm; height: 3.5cm; padding: 4px; border: 2px solid black; border-radius: 6px; display: flex; align-items: center; gap: 6px; background: white; overflow: hidden; page-break-inside: avoid; }
  .qr { width: 68px; height: 68px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .info { display: flex; flex-direction: column; height: 100%; flex-grow: 1; justify-content: space-between; overflow: hidden; }
  .logo-row { min-height: 32px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; border-bottom: 1px solid #eee; padding-bottom: 2px; overflow: hidden; }
  .brand-line { display: flex; align-items: center; justify-content: flex-start; gap: 4px; color: #4F46E5; font-size: 14px; font-weight: 900; line-height: 1; letter-spacing: -0.5px; }
  .company-line { width: 100%; margin-top: 2px; font-size: 6px; font-weight: 900; color: #111827; text-transform: uppercase; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .logo-row img { height: 100%; max-height: 28px; }
  .id-section { display: flex; flex-direction: column; justify-content: center; }
  .id-label { font-size: 7px; font-weight: bold; color: #666; text-transform: uppercase; line-height: 1; }
  .id-value { font-size: 18px; font-weight: 900; color: black; font-family: monospace; line-height: 1.1; letter-spacing: -0.5px; }
  .model { font-size: 8px; font-weight: bold; color: #333; text-transform: uppercase; margin-top: 2px; white-space: nowrap; max-width: 125px; overflow: hidden; text-overflow: ellipsis; }
  .footer-row { border-top: 1.5px solid #000; padding-top: 1px; margin-top: auto; display: flex; justify-content: space-between; align-items: center; }
  .footer-left { font-size: 6px; font-weight: bold; color: #444; }
  .footer-right { font-size: 8px; font-weight: 900; color: #000; }
</style></head><body>
  <div class="print-grid">${labelsHtml}</div>
</body></html>`;
    printInNewWindow(html);
  };

  const handleBulkPeripheralPrint = () => {
    if (selectedPeripheralsData.length === 0) return;
    const companyLabel = escapeHtml(getCompanyLabel(config.companyName).toLocaleUpperCase("pt-BR"));
    const supportEmail = escapeHtml((config.supportEmail || "shiadmti@gmail.com").trim() || "shiadmti@gmail.com");
    const labelsHtml = selectedPeripheralsData.map((peri) => {
      const qrSvg = ReactDOMServer.renderToStaticMarkup(<QRCodeSVG value={peri.parentId} size={42} level="M" />);
      return `<div class="peri-label">
        <div class="qr">${qrSvg}</div>
        <div class="info">
          <div class="logo-row" style="font-weight: 900; font-family: sans-serif; display: flex; align-items: center; justify-content: center; gap: 3px; color: #4F46E5; font-size: 8px; letter-spacing: -0.2px;">
            <div class="brand-line">
              <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>
              NEXUS<span style="color: #111827">ITAM</span>
            </div>
            <div class="company-line">${companyLabel}</div>
          </div>
          <div class="id-section">
            <span class="id-value">${peri.parentId}</span>
            <span class="peri-name">${peri.name}</span>
          </div>
          <div class="footer-row"><p>${supportEmail}</p></div>
        </div>
      </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Etiquetas_Perifericos_NexusITAM</title>
<style>
  @page { size: A4; margin: 5mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { margin: 0; padding: 5mm; font-family: Arial, sans-serif; -webkit-print-color-adjust: exact; }
  .print-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; justify-items: center; width: 100%; }
  .peri-label { width: 5cm; height: 2.5cm; padding: 2px; border: 1px solid black; border-radius: 4px; display: flex; align-items: center; gap: 3px; overflow: hidden; page-break-inside: avoid; }
  .qr { width: 45px; height: 45px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .info { display: flex; flex-direction: column; height: 100%; flex-grow: 1; justify-content: space-between; }
  .logo-row { min-height: 22px; border-bottom: 0.5px solid #ccc; margin-bottom: 1px; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; }
  .brand-line { display: flex; align-items: center; justify-content: center; gap: 3px; color: #4F46E5; font-size: 8px; font-weight: 900; line-height: 1; letter-spacing: -0.2px; }
  .company-line { width: 100%; margin-top: 1px; font-size: 4px; font-weight: 900; color: #111827; text-align: center; text-transform: uppercase; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .logo-row img { height: 100%; }
  .id-section { display: flex; flex-direction: column; line-height: 0.9; }
  .id-value { font-size: 10px; font-weight: 900; font-family: monospace; }
  .peri-name { font-size: 6px; font-weight: bold; text-transform: uppercase; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .footer-row { border-top: 0.5px solid #000; padding-top: 1px; margin-top: auto; text-align: right; }
  .footer-row p { margin: 0; font-size: 5px; font-weight: 900; }
</style></head><body>
  <div class="print-grid">${labelsHtml}</div>
</body></html>`;
    printInNewWindow(html);
  };

  // Métodos que manipulam a API/banco de dados ou processam a lista num contexto maior
  const handleBulkStatusChange = async (newStatus) => {
    if (
      !confirm(
        `Mudar status de ${selectedIds.length} ativos para "${newStatus}"?`,
      )
    )
      return;
    setBulkProcessing(true);
    try {
      const updates = selectedIds.map((id) =>
        updateAsset(
          id,
          { status: newStatus },
          {
            action: "Alteração em Massa",
            details: `Status alterado em lote para: ${newStatus}`,
            user: "Admin TI",
          },
        ),
      );
      await Promise.all(updates);
      toast.success(`Status de ${selectedIds.length} ativos atualizados!`);
      setSelectedIds([]);
      setIsStatusModalOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("Erro ao atualizar ativos em lote.");
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleExportExcel = async () => {
    const XLSX = await import("xlsx");
    const dataToExport = processedAssets.map((asset) => ({
      Patrimônio: asset.internalId,
      Modelo: asset.model,
      Tipo: asset.type,
      Serial: asset.serialNumber || "",
      Responsável: asset.assignedTo || asset.clientName || "",
      "Setor/Local": asset.location,
      Status: asset.status,
    }));
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ativos");
    XLSX.writeFile(
      workbook,
      `Inventario_NexusITAM_${new Date().toLocaleDateString()}.xlsx`,
    );
  };

  const filters = [
    { label: "Todos", value: "Todos", icon: <LayoutGrid size={16} /> },
    { label: "Notebooks", value: "Notebook", icon: <Laptop size={16} /> },
    { label: "Computadores", value: "Computador", icon: <Monitor size={16} /> },
    { label: "Celulares", value: "Celular", icon: <Smartphone size={16} /> },
    { label: "Maquininhas", value: "PGT", icon: <CreditCard size={16} /> },
    { label: "Impressoras", value: "Impressora", icon: <Printer size={16} /> },
    {
      label: "Promocionais",
      value: "Promocionais",
      icon: <Megaphone size={16} />,
    },
  ];

  const statusOptions = [
    "Em Uso",
    "Disponível",
    "Em Transferência",
    "Manutenção",
    "Entregue",
    "Defeito",
    "Em Trânsito",
  ];

  if (loading) return <AssetListSkeleton />;

  return (
    <div className="max-w-[1920px] mx-auto pb-24 animate-fade-in relative min-h-screen">


      {/* Componente externo contendo o quadro abstrato e quantitativo do ambiente de TI no topo */}
      <AssetMetrics assets={assets} />

      {/* Controles de Busca, Visualização, Botão de Filtro Expandido e Ações Inicias */}
      <div className="px-4 md:px-8 pb-6 bg-[#F4F4F5] sticky top-0 md:static z-20">
        <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 items-center">
          {/* Campo de pesquisa global que abrange IDs e Nomes */}
          <div className="relative w-full md:flex-1">
            <Search
              className="absolute left-4 top-3.5 text-gray-400"
              size={20}
            />
            <input
              type="text"
              placeholder="Buscar por tag, modelo, serial ou responsável..."
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-black rounded-2xl outline-none font-bold text-sm transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Controles maiores ou que tomam muito espaço sendo mostrados apenas nos computadores */}
          <div className="hidden md:flex gap-2 items-center">
            <div className="flex gap-1 bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
              {statusOptions.slice(0, 3).map((st) => (
                <button
                  key={st}
                  onClick={() =>
                    setFilterStatus(filterStatus === st ? "Todos" : st)
                  }
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${filterStatus === st ? "bg-black text-white shadow-md" : "text-gray-500 hover:bg-gray-200"}`}
                >
                  {st}
                </button>
              ))}
              <div className="w-[1px] h-6 bg-gray-200 mx-1 self-center"></div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-transparent text-xs font-bold text-gray-500 outline-none cursor-pointer hover:text-black"
              >
                <option value="Todos">Mais Filtros</option>
                {statusOptions.slice(3).map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() =>
                setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))
              }
              title={sortBy === "createdAt" ? "Alternar recentes/antigos" : "Alternar ordem alfabética"}
              className="p-3 bg-gray-50 hover:bg-gray-100 rounded-2xl border border-gray-100 text-gray-600 transition-colors"
            >
              {sortOrder === "asc" ? (
                <ArrowDownAZ size={20} />
              ) : (
                <ArrowUpAZ size={20} />
              )}
            </button>
            <button
              onClick={() => {
                const nextSort = sortBy === "createdAt" ? "internalId" : "createdAt";
                setSortBy(nextSort);
                setSortOrder(nextSort === "createdAt" ? "desc" : "asc");
              }}
              className={`flex items-center gap-2 px-3 py-3 rounded-2xl border text-xs font-black transition-colors ${sortBy === "createdAt" ? "bg-black text-white border-black shadow-md" : "bg-gray-50 hover:bg-gray-100 border-gray-100 text-gray-600"}`}
              title="Ordenar por data e hora de registro"
            >
              <Clock size={18} />
              <span>Recentes</span>
            </button>
          </div>

          {/* Atalhos do painel direito para tarefas mais gerenciais (importar/exportar para Excel) */}
          <div className="hidden md:flex gap-2 border-l border-gray-100 pl-4">
            <button
              onClick={handleExportExcel}
              className="p-3 bg-green-50 text-green-700 hover:bg-green-100 rounded-2xl transition-colors"
              title="Exportar Excel"
            >
              <Download size={20} />
            </button>
            <Link
              to="/import"
              className="p-3 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-2xl transition-colors"
              title="Importar"
            >
              <FileText size={20} />
            </Link>
          </div>
        </div>

        {/* Rolagem horizontal de abas arredondadas e rápidas organizando por Tipo de Ativo */}
        <div className="flex gap-3 overflow-x-auto py-4 scrollbar-hide">
          <button
            onClick={() => {
              const nextSort = sortBy === "createdAt" ? "internalId" : "createdAt";
              setSortBy(nextSort);
              setSortOrder(nextSort === "createdAt" ? "desc" : "asc");
            }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all border ${sortBy === "createdAt" ? "bg-black text-white border-black shadow-lg scale-105" : "bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}
          >
            <Clock size={16} /> Recentes
          </button>
          {filters.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilterType(f.value)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-all border ${filterType === f.value ? "bg-black text-white border-black shadow-lg scale-105" : "bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}
            >
              {f.icon} {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista real contendo dados extraídos de acordo com o cruzamento de pesquisa, ordenameto e status */}
      <div className="px-4 md:px-8">
        {processedAssets.length === 0 ? (
          <div className="p-20 text-center text-gray-400 flex flex-col items-center bg-white rounded-3xl border border-gray-200 border-dashed animate-fade-in">
            <AlertCircle size={48} className="mb-4 opacity-20" />
            <p className="font-medium">
              Nenhum ativo encontrado com esses filtros.
            </p>
          </div>
        ) : (
          <>
            {/* Exibe listagem agrupada em cards com menos detalhes quando no celular por falta de tela */}
            <div className="grid grid-cols-1 gap-4 md:hidden pb-20">
              {processedAssets.map((asset) => (
                <div
                  key={asset.id}
                  onClick={() => navigate(`/assets/${asset.id}`)}
                  className={`bg-white p-5 rounded-3xl border border-gray-100 shadow-[0_4px_20px_-12px_rgba(0,0,0,0.1)] active:scale-[0.98] transition-all relative overflow-hidden group ${selectedIds.includes(asset.id) ? "ring-2 ring-black bg-gray-50" : ""}`}
                >
                  {/* Forma orgânica desenhada apenas para visual agradável das extremidades do Card */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gray-50 rounded-full -mr-10 -mt-10 opacity-50 pointer-events-none"></div>

                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <span
                      className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wide ${asset.status === "Em Uso" ? "bg-green-100 text-green-700" : asset.status === "Disponível" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}
                    >
                      {asset.status}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelectOne(asset.id);
                      }}
                      className="text-gray-300 active:scale-125 transition-transform p-1"
                    >
                      {selectedIds.includes(asset.id) ? (
                        <CheckSquare size={24} className="text-black" />
                      ) : (
                        <Square size={24} />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-5 relative z-10">
                    <div className="w-16 h-16 bg-white border border-gray-100 rounded-2xl flex items-center justify-center shadow-sm text-gray-700 shrink-0">
                      <AssetIcon
                        type={asset.type}
                        category={asset.category}
                        model={asset.model}
                        internalId={asset.internalId}
                        size={32}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-black text-gray-900 leading-tight truncate text-lg">
                        {asset.model}
                      </h3>
                      <p className="text-xs text-gray-400 font-mono font-bold mt-1 tracking-wider">
                        {asset.internalId}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between text-xs font-medium text-gray-500 relative z-10">
                    <div className="flex items-center gap-2 truncate max-w-[60%]">
                      <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                        <User size={12} />
                      </div>
                      <span className="truncate">
                        {asset.assignedTo || asset.clientName || "N/A"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-75">
                      <MapPin size={12} />{" "}
                      {asset.location?.substring(0, 10) || "N/A"}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Quando no formato para computadores, usa tabelas extensas super rápidas de varrer a visão */}
            <div className="hidden md:block bg-white rounded-[2rem] shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#FAFAFA] border-b border-gray-100 sticky top-0 z-10 backdrop-blur-sm">
                    <tr className="text-[10px] xl:text-xs uppercase text-gray-400 font-black tracking-widest">
                      <th className="py-4 px-3 w-12 text-center">
                        <button
                          onClick={toggleSelectAll}
                          className="hover:text-black transition-colors"
                        >
                          {selectedIds.length > 0 &&
                          selectedIds.length === processedAssets.length ? (
                            <CheckSquare size={18} className="text-black" />
                          ) : (
                            <Square size={18} />
                          )}
                        </button>
                      </th>
                      <th className="py-4 px-3">Ativo</th>
                      <th className="py-4 px-3">Patrimônio</th>
                      <th className="py-4 px-3">Responsável</th>
                      <th className="py-4 px-3">Local</th>
                      <th className="py-4 px-3 text-center">Status</th>
                      <th className="py-4 px-3 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {processedAssets.map((asset) => {
                      const responsibleName =
                        asset.assignedTo || asset.clientName || "---";
                      return (
                        <tr
                          key={asset.id}
                          className={`hover:bg-gray-50/80 transition-all group cursor-pointer ${selectedIds.includes(asset.id) ? "bg-gray-50" : ""}`}
                          onClick={() => navigate(`/assets/${asset.id}`)}
                        >
                          <td
                            className="py-3 px-3 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => toggleSelectOne(asset.id)}
                              className="text-gray-300 hover:text-black transition-colors"
                            >
                              {selectedIds.includes(asset.id) ? (
                                <CheckSquare size={18} className="text-black" />
                              ) : (
                                <Square size={18} />
                              )}
                            </button>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-white border border-gray-100 rounded-xl flex items-center justify-center shadow-sm text-gray-600 group-hover:scale-110 transition-transform shrink-0">
                                <AssetIcon
                                  type={asset.type}
                                  category={asset.category}
                                  model={asset.model}
                                  internalId={asset.internalId}
                                  size={18}
                                />
                              </div>
                              <div className="min-w-0">
                                <p
                                  className="font-bold text-gray-900 text-xs xl:text-sm truncate max-w-[120px] xl:max-w-[200px]"
                                  title={asset.model}
                                >
                                  {asset.model}
                                </p>
                                <span className="text-[9px] xl:text-[10px] font-bold uppercase text-gray-400 mt-1 block truncate">
                                  {asset.type}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="bg-gray-50 px-2 py-1.5 rounded-lg border border-gray-200 w-fit group-hover:bg-white transition-colors">
                              <p className="font-mono font-bold text-[10px] xl:text-xs text-gray-900">
                                {asset.internalId}
                              </p>
                            </div>
                            {asset.serialNumber && (
                              <p className="text-[8px] xl:text-[10px] text-gray-400 mt-1 font-mono truncate max-w-[80px] xl:max-w-[100px]" title={asset.serialNumber}>
                                {asset.serialNumber}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              {responsibleName !== "---" && (
                                <div className="hidden xl:flex w-7 h-7 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 items-center justify-center text-[9px] font-black text-gray-600 uppercase border border-white shadow-sm shrink-0">
                                  {responsibleName.substring(0, 2)}
                                </div>
                              )}
                              <p className="text-[11px] xl:text-sm font-bold text-gray-700 truncate max-w-[100px] xl:max-w-[150px]" title={responsibleName}>
                                {responsibleName}
                              </p>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5 text-gray-500 text-[11px] xl:text-sm">
                              <MapPin size={12} className="text-gray-400 shrink-0" />
                              <span className="truncate max-w-[90px] xl:max-w-[150px] font-medium" title={asset.location || "---"}>
                                {asset.location || "---"}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span
                              className={`inline-flex items-center px-2 py-1 rounded-full text-[8px] xl:text-[10px] font-black uppercase tracking-wide whitespace-nowrap shadow-sm border ${asset.status === "Em Uso" ? "bg-green-50 text-green-700 border-green-100" : asset.status === "Disponível" ? "bg-blue-50 text-blue-700 border-blue-100" : asset.status === "Entregue" ? "bg-purple-50 text-purple-700 border-purple-100" : "bg-gray-50 text-gray-600 border-gray-100"}`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 animate-pulse ${asset.status === "Em Uso" ? "bg-green-500" : asset.status === "Disponível" ? "bg-blue-500" : "bg-gray-400"}`}
                              ></span>
                              {asset.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <div className="p-1.5 text-gray-300 group-hover:text-black hover:bg-gray-100 rounded-xl transition-all inline-flex">
                              <ChevronRight size={18} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-8 text-center text-[10px] text-gray-300 font-bold uppercase tracking-widest pb-8">
        Exibindo {processedAssets.length} de {assets.length} ativos
      </div>

      {/* Janela de controle extra que sobe da tela do usuário ao fazer checagem nos itens individualmente */}
      {selectedIds.length > 0 && (
        <div
          className={`fixed ${window.innerWidth < 768 ? "bottom-[90px]" : "bottom-8"} left-1/2 -translate-x-1/2 bg-[#18181B] text-white p-2 pl-6 pr-2 rounded-full shadow-2xl z-50 flex items-center gap-6 animate-in slide-in-from-bottom-10 border border-white/10 w-[90%] md:w-auto max-w-2xl`}
        >
          <div className="flex items-center gap-3">
            <div className="bg-white text-black w-6 h-6 rounded-full flex items-center justify-center font-black text-xs">
              {selectedIds.length}
            </div>
            <span className="text-sm font-bold whitespace-nowrap hidden sm:inline">
              Selecionados
            </span>
          </div>
          <div className="h-6 w-[1px] bg-white/20"></div>
          <div className="flex gap-1 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setIsStatusModalOpen(true)}
              className="flex items-center gap-2 hover:bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase transition-colors whitespace-nowrap"
            >
              <RefreshCcw size={14} /> Status
            </button>
            <button
              onClick={handleBulkPrint}
              className="flex items-center gap-2 hover:bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase transition-colors whitespace-nowrap"
            >
              <PrinterIcon size={14} /> Etiquetas
            </button>
            {selectedPeripheralsData.length > 0 && (
              <button
                onClick={handleBulkPeripheralPrint}
                className="flex items-center gap-2 hover:bg-white/20 px-4 py-2 rounded-full text-xs font-bold uppercase transition-colors whitespace-nowrap"
              >
                <Plug size={14} /> Acessórios
              </button>
            )}
          </div>
          <button
            onClick={() => setSelectedIds([])}
            className="p-2 hover:bg-red-600 rounded-full transition-colors ml-auto"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Opção para forçar alteração simultânea nos atributos dos componentes de um mesmo modelo (Ex: Retornar para Status Disponível um lote de Notebooks) */}
      {isStatusModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 p-2">
            <div className="bg-gray-50 p-5 rounded-[1.5rem] mb-2 flex justify-between items-center">
              <h3 className="font-black text-lg flex items-center gap-2">
                <RefreshCcw size={20} className="text-black" /> Novo Status
              </h3>
              <button
                onClick={() => setIsStatusModalOpen(false)}
                className="hover:bg-gray-200 p-2 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-500 mb-6 font-medium px-2">
                Alterar status de <strong>{selectedIds.length}</strong> itens
                selecionados:
              </p>
              <div className="space-y-2">
                {statusOptions.map((status) => (
                  <button
                    key={status}
                    onClick={() => handleBulkStatusChange(status)}
                    disabled={bulkProcessing}
                    className="w-full py-3 px-5 rounded-2xl border border-gray-100 bg-white hover:bg-black hover:text-white hover:border-black transition-all font-bold text-sm text-left flex items-center justify-between group active:scale-95 shadow-sm"
                  >
                    {status}{" "}
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Check size={16} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetList;

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clipboard,
  Download,
  FileJson,
  Laptop,
  Play,
  RefreshCcw,
  ShieldCheck,
  UploadCloud,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { updateAsset } from '../services/assetService';
import {
  DEFAULT_AGENT_NAMING,
  generateAgentAssetCode,
  getAgentSubmissions,
  markAgentSubmission,
  previewAgentPayload,
  registerAgentAsset,
  resolveAgentNamingFromDatabase,
} from '../services/agentService';

const samplePayload = {
  hostname: 'DESKTOP-TI-001',
  usuario_logado: 'usuario.ti',
  mac_address: '00:11:22:AA:BB:CC',
  ip_address: '192.168.0.10',
  sistema_operacional: 'Microsoft Windows 11 Pro',
  hardware: {
    placa_mae_serial: 'BOARD-123456',
    bios_serial: 'SN-ABC-123',
    processador: 'Intel Core i5',
    ram_gb: 16,
  },
  data_coleta: new Date().toISOString(),
};

const normalizeNamingConfig = (config = {}) => ({
  ...DEFAULT_AGENT_NAMING,
  ...config,
  companyPrefix: String(config.companyPrefix || DEFAULT_AGENT_NAMING.companyPrefix).toUpperCase(),
  locationCode: String(config.locationCode || DEFAULT_AGENT_NAMING.locationCode).toUpperCase(),
  padLength: Number(config.padLength) || DEFAULT_AGENT_NAMING.padLength,
});

const buildAgentScript = (tenantId = 'default-tenant') => {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'SEU_PROJECT_ID';
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY || 'SUA_API_KEY';

  return `# Agente ITAM Ativo - Nexus ITAM
param(
  [ValidateSet("Direct", "Json")]
  [string]$Mode = "Direct"
)

$ProjectId = "${projectId}"
$ApiKey = "${apiKey}"
$TenantId = "${tenantId}"

function Get-ItamPayload {
  $ErrorActionPreference = "SilentlyContinue"
  $os = Get-CimInstance Win32_OperatingSystem
  $sys = Get-CimInstance Win32_ComputerSystem
  $bios = Get-CimInstance Win32_BIOS
  $board = Get-CimInstance Win32_BaseBoard
  $cpu = Get-CimInstance Win32_Processor
  $rams = Get-CimInstance Win32_PhysicalMemory
  $netAdapter = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -eq $true } | Select-Object -First 1
  $disks = Get-CimInstance Win32_DiskDrive | ForEach-Object {
    $size = if ($_.Size) { [math]::Round($_.Size / 1GB, 2) } else { 0 }
    "$($_.Model) ($size GB) Serial: $($_.SerialNumber)"
  }

  return @{
    hostname = $env:COMPUTERNAME
    usuario_logado = $env:USERNAME
    mac_address = if ($netAdapter -and $netAdapter.MACAddress) { $netAdapter.MACAddress } else { "" }
    ip_address = if ($netAdapter -and $netAdapter.IPAddress) { $netAdapter.IPAddress[0] } else { "" }
    sistema_operacional = "$($os.Caption) $($os.OSArchitecture)"
    data_coleta = (Get-Date).ToString("o")
    hardware = @{
      fabricante = $sys.Manufacturer
      modelo_sistema = $sys.Model
      modelo_placa = $board.Product
      placa_mae_serial = $board.SerialNumber
      bios_serial = $bios.SerialNumber
      pc_system_type = $sys.PCSystemType
      chassis_types = ($sys.ChassisSKUNumber, ((Get-CimInstance Win32_SystemEnclosure).ChassisTypes -join ",")) -join "|"
      processador = $cpu.Name
      ram_gb = if ($rams) { [math]::Round(($rams | Measure-Object Capacity -Sum).Sum / 1GB, 2) } else { 0 }
      storage = ($disks -join " | ")
    }
  }
}

function ConvertTo-FirestoreValue {
  param($Value)
  if ($null -eq $Value) { return @{ nullValue = $null } }
  if ($Value -is [hashtable]) {
    $fields = @{}
    foreach ($key in $Value.Keys) { $fields[$key] = ConvertTo-FirestoreValue $Value[$key] }
    return @{ mapValue = @{ fields = $fields } }
  }
  if ($Value -is [int] -or $Value -is [long]) { return @{ integerValue = "$Value" } }
  if ($Value -is [double] -or $Value -is [decimal] -or $Value -is [float]) { return @{ doubleValue = [double]$Value } }
  if ($Value -is [bool]) { return @{ booleanValue = $Value } }
  return @{ stringValue = [string]$Value }
}

function Export-ItamPayload {
  param($Payload)
  $desktopPath = [Environment]::GetFolderPath("Desktop")
  $filePath = Join-Path $desktopPath "ITAM_AGENT_$($env:COMPUTERNAME).json"
  $Payload | ConvertTo-Json -Depth 10 | Out-File -FilePath $filePath -Encoding UTF8
  Write-Host "Payload exportado em: $filePath"
}

function Send-ItamPayload {
  param($Payload)
  $endpoint = "https://firestore.googleapis.com/v1/projects/$ProjectId/databases/(default)/documents/agentInbox?key=$ApiKey"
  $document = @{
    fields = @{
      payload = ConvertTo-FirestoreValue $Payload
      source = @{ stringValue = "Agente ITAM PowerShell" }
      status = @{ stringValue = "pending" }
      hostname = @{ stringValue = [string]$Payload.hostname }
      internalId = @{ stringValue = "" }
      serialNumber = @{ stringValue = [string]$Payload.hardware.bios_serial }
      createdAt = @{ stringValue = (Get-Date).ToString("o") }
      tenantId = @{ stringValue = $TenantId }
    }
  }
  $body = $document | ConvertTo-Json -Depth 20
  Invoke-RestMethod -Method Post -Uri $endpoint -Body $body -ContentType "application/json" | Out-Null
  Write-Host "Submissao enviada para o ITAM."
}

$payload = Get-ItamPayload
if ($Mode -eq "Json") {
  Export-ItamPayload $payload
  exit
}

try {
  Send-ItamPayload $payload
} catch {
  Write-Warning "Envio direto falhou. Exportando JSON local para importacao manual."
  Write-Warning $_.Exception.Message
  Export-ItamPayload $payload
}
`;
};

const parsePayload = (value) => {
  const parsed = JSON.parse(value);
  return parsed.payload || parsed;
};

const buildJsonPayload = (currentText) => {
  try {
    const parsed = parsePayload(currentText);
    return {
      ...samplePayload,
      ...parsed,
      internalId: undefined,
      patrimonio: undefined,
      assetTag: undefined,
      data_coleta: new Date().toISOString(),
      hardware: {
        ...samplePayload.hardware,
        ...(parsed.hardware || {}),
      },
    };
  } catch {
    return {
      ...samplePayload,
      data_coleta: new Date().toISOString(),
    };
  }
};

const AgentManager = () => {
  const { currentUser } = useAuth();
  const tenantId = currentUser?.tenantId || 'default-tenant';
  const [jsonText, setJsonText] = useState(JSON.stringify(samplePayload, null, 2));
  const [preview, setPreview] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [namingConfig, setNamingConfig] = useState(DEFAULT_AGENT_NAMING);
  const [autoNamingPreview, setAutoNamingPreview] = useState(null);

  const pendingSubmissions = useMemo(
    () => submissions.filter((item) => item.status !== 'processed'),
    [submissions],
  );
  const normalizedNamingConfig = useMemo(() => normalizeNamingConfig(namingConfig), [namingConfig]);
  const nextAssetCode = autoNamingPreview?.nextInternalId || generateAgentAssetCode({ ...normalizedNamingConfig, typeCode: 'TIPO', nextSequence: 1 });

  const updateNamingField = (field, value) => {
    setNamingConfig((prev) => ({
      ...prev,
      [field]: ['nextSequence', 'padLength'].includes(field) ? Number(value) : value.toUpperCase(),
    }));
  };

  const saveNamingConfig = async (configToSave = normalizedNamingConfig, silent = false) => {
    setSavingConfig(true);
    try {
      await setDoc(doc(db, 'settings', tenantId), { agentNaming: configToSave }, { merge: true });
      setNamingConfig(configToSave);
      if (!silent) toast.success('Padrão de nomenclatura salvo.');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao salvar nomenclatura do agente.');
    } finally {
      setSavingConfig(false);
    }
  };

  const refreshAutoNamingPreview = async () => {
    if (!tenantId) return;
    try {
      const payload = parsePayload(jsonText);
      const resolved = await resolveAgentNamingFromDatabase(payload, { namingConfig: normalizedNamingConfig, tenantId });
      setAutoNamingPreview(resolved);
    } catch {
      setAutoNamingPreview(null);
    }
  };

  const analyzeJson = async () => {
    setLoadingPreview(true);
    try {
      const payload = parsePayload(jsonText);
      const result = await previewAgentPayload(payload, { namingConfig: normalizedNamingConfig, tenantId });
      setPreview({ ...result, payload });
      setAutoNamingPreview(result.resolvedNaming);
      toast.success('Payload analisado.');
    } catch (error) {
      console.error(error);
      toast.error(`JSON inválido ou incompleto: ${error.message}`);
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const loadInbox = async () => {
    if (!tenantId) return;
    setLoadingInbox(true);
    try {
      const data = await getAgentSubmissions(tenantId);
      const enriched = await Promise.all(
        data.map(async (submission) => {
          try {
            const agentPreview = await previewAgentPayload(submission.payload || {}, { namingConfig: normalizedNamingConfig, tenantId });
            return { ...submission, preview: agentPreview };
          } catch {
            return submission;
          }
        }),
      );
      setSubmissions(enriched);
    } catch (error) {
      console.error(error);
      toast.error('Erro ao carregar submissões do agente.');
    } finally {
      setLoadingInbox(false);
    }
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settingsRef = doc(db, 'settings', tenantId);
        const snap = await getDoc(settingsRef);
        if (snap.exists()) {
          setNamingConfig(normalizeNamingConfig(snap.data().agentNaming || {}));
        } else {
          const generalRef = doc(db, 'settings', 'general');
          const generalSnap = await getDoc(generalRef);
          if (generalSnap.exists()) {
            setNamingConfig(normalizeNamingConfig(generalSnap.data().agentNaming || {}));
          }
        }
      } catch (error) {
        console.error(error);
      }
    };

    if (tenantId) {
      loadSettings();
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      loadInbox();
    }
  }, [tenantId, normalizedNamingConfig]);

  useEffect(() => {
    refreshAutoNamingPreview();
  }, [jsonText, normalizedNamingConfig, tenantId]);

  const registerManualPayload = async () => {
    setProcessing(true);
    try {
      const payload = preview?.payload || parsePayload(jsonText);
      const result = await registerAgentAsset(payload, {
        user: currentUser?.email || 'Agente ITAM',
        namingConfig: normalizedNamingConfig,
        tenantId,
      });
      toast.success(result.action === 'created' ? 'Ativo criado pelo agente.' : 'Ativo existente atualizado pelo agente.');
      await analyzeJson();
    } catch (error) {
      console.error(error);
      toast.error(`Erro ao registrar ativo: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const processSubmission = async (submission) => {
    setProcessing(true);
    try {
      const result = await registerAgentAsset(submission.payload, {
        user: currentUser?.email || 'Agente ITAM',
        namingConfig: normalizedNamingConfig,
        tenantId,
      });
      await markAgentSubmission(submission.id, {
        status: 'processed',
        resultAction: result.action,
        assetId: result.assetId,
      });
      toast.success(result.action === 'created' ? 'Submissão processada: ativo criado.' : 'Submissão processada: ativo atualizado.');
      await loadInbox();
    } catch (error) {
      console.error(error);
      toast.error(`Falha ao processar submissão: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const updateDuplicateStatus = async (status) => {
    if (!preview?.duplicate?.id) return;
    setProcessing(true);
    try {
      await updateAsset(preview.duplicate.id, { status }, {
        tenantId,
        type: 'agent-management',
        action: 'Gestão via Agente ITAM',
        details: `Status alterado para ${status} a partir do módulo Agente ITAM.`,
        user: currentUser?.email || 'Agente ITAM',
      });
      toast.success(`Status atualizado para ${status}.`);
      await analyzeJson();
    } catch (error) {
      console.error(error);
      toast.error('Erro ao atualizar status do ativo.');
    } finally {
      setProcessing(false);
    }
  };

  const downloadScript = () => {
    const blob = new Blob([buildAgentScript(tenantId)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Agente_ITAM_Ativo.ps1';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const copyScript = async () => {
    await navigator.clipboard.writeText(buildAgentScript(tenantId));
    toast.success('Script do agente copiado.');
  };

  const generateJson = async () => {
    const payload = buildJsonPayload(jsonText);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Payload_Agente_ITAM_${payload.hostname || 'endpoint'}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setJsonText(json);
    toast.success('JSON do agente gerado.');
  };

  const uploadJson = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => setJsonText(evt.target.result);
    reader.readAsText(file);
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-gray-900 text-white rounded-xl">
            <Activity size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">Agente ITAM</h1>
            <p className="text-sm text-gray-500">Coleta ativa, deduplicação e registro assistido de endpoints.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={generateJson} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700">
            <FileJson size={16} /> Gerar JSON
          </button>
          <button onClick={downloadScript} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white font-bold text-sm hover:bg-gray-800">
            <Download size={16} /> Baixar agente
          </button>
          <button onClick={copyScript} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-700 font-bold text-sm hover:bg-gray-50">
            <Clipboard size={16} /> Copiar script
          </button>
        </div>
      </div>

      <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 mb-6">
        <div className="flex flex-col xl:flex-row xl:items-end gap-4">
          <div className="flex-1">
            <h2 className="font-black text-gray-900 flex items-center gap-2"><ShieldCheck size={18} /> Padrão de nomenclatura</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
              <ConfigInput label="Empresa" value={namingConfig.companyPrefix} onChange={(value) => updateNamingField('companyPrefix', value)} maxLength={6} />
              <ConfigInput label="Local" value={namingConfig.locationCode} onChange={(value) => updateNamingField('locationCode', value)} maxLength={6} />
              <ConfigInput label="Dígitos" type="number" value={namingConfig.padLength} onChange={(value) => updateNamingField('padLength', value)} min={2} max={8} />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row xl:flex-col gap-3 xl:w-64">
            <div className="rounded-xl bg-gray-950 text-cyan-100 p-4">
              <p className="text-[10px] font-black uppercase text-cyan-500">Próximo patrimônio</p>
              <p className="mt-1 font-mono text-lg font-black">{nextAssetCode}</p>
              <p className="mt-1 text-[10px] font-bold uppercase text-cyan-600">
                Tipo: {autoNamingPreview?.assetType || 'aguardando payload'} / Código: {autoNamingPreview?.namingConfig?.typeCode || 'auto'}
              </p>
            </div>
            <button onClick={() => saveNamingConfig()} disabled={savingConfig} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-black text-white font-bold text-sm hover:bg-gray-800 disabled:opacity-60">
              {savingConfig ? <RefreshCcw size={16} className="animate-spin" /> : <CheckCircle size={16} />} Salvar padrão
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-black text-gray-900 flex items-center gap-2"><FileJson size={18} /> Payload do Agente</h2>
              <p className="text-xs text-gray-500 mt-1">Cole o JSON exportado ou use o agente ativo para alimentar a fila automaticamente.</p>
            </div>
            <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50">
              <UploadCloud size={14} /> JSON
              <input type="file" accept=".json,application/json" onChange={uploadJson} className="hidden" />
            </label>
          </div>
          <div className="p-5">
            <textarea
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              className="w-full h-80 p-4 rounded-xl bg-gray-950 text-cyan-100 font-mono text-xs outline-none border border-gray-800 focus:ring-2 focus:ring-brand resize-none"
              spellCheck={false}
            />
            <div className="flex flex-wrap gap-3 mt-4">
              <button onClick={analyzeJson} disabled={loadingPreview} className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:opacity-60">
                {loadingPreview ? <RefreshCcw size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Comparar antes de registrar
              </button>
              <button onClick={registerManualPayload} disabled={processing} className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-black text-white font-bold text-sm hover:bg-gray-800 disabled:opacity-60">
                <Play size={16} /> Registrar ou atualizar ativo
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100">
              <h2 className="font-black text-gray-900 flex items-center gap-2"><Laptop size={18} /> Resultado da comparação</h2>
            </div>
            <div className="p-5">
              {!preview ? (
                <div className="text-sm text-gray-500">Analise um payload para ver se ele cria um ativo novo ou atualiza um existente.</div>
              ) : (
                <div className="space-y-4">
                  <div className={`rounded-xl p-4 border ${preview.duplicate ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                    <div className="flex items-center gap-2 font-black text-sm">
                      {preview.duplicate ? <AlertTriangle size={18} className="text-amber-600" /> : <CheckCircle size={18} className="text-emerald-600" />}
                      {preview.duplicate ? 'Ativo já registrado' : 'Novo ativo detectado'}
                    </div>
                    <p className="text-xs text-gray-600 mt-2">
                      {preview.duplicate
                        ? `Correspondência por ${preview.duplicate.matchField}. O agente atualizará o registro existente.`
                        : 'Nenhum patrimônio ou serial igual foi encontrado.'}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <InfoRow label="Patrimônio" value={preview.normalized.internalId} />
                    <InfoRow label="Serial" value={preview.normalized.serialNumber} />
                    <InfoRow label="Hostname" value={preview.normalized.hostname} />
                    <InfoRow label="Usuário" value={preview.normalized.loggedUser} />
                    <InfoRow label="IP" value={preview.normalized.ipAddress} />
                  </div>
                  {preview.duplicate && (
                    <div className="pt-2">
                      <p className="text-[10px] font-black uppercase text-gray-400 mb-2">Gestão rápida do ativo</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Link to={`/assets/${preview.duplicate.id}`} className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
                          <Laptop size={13} /> Abrir
                        </Link>
                        <button onClick={() => updateDuplicateStatus('Manutenção')} disabled={processing} className="inline-flex items-center justify-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2 py-2 text-xs font-bold text-orange-700 hover:bg-orange-100 disabled:opacity-60">
                          <Wrench size={13} /> Manutenção
                        </button>
                        <button onClick={() => updateDuplicateStatus('Em Uso')} disabled={processing} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60">
                          Em uso
                        </button>
                        <button onClick={() => updateDuplicateStatus('Disponível')} disabled={processing} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
                          Disponível
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h2 className="font-black text-gray-900">Fila do Agente</h2>
                <p className="text-xs text-gray-500">{pendingSubmissions.length} pendente(s)</p>
              </div>
              <button onClick={loadInbox} disabled={loadingInbox} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600">
                <RefreshCcw size={16} className={loadingInbox ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
              {submissions.length === 0 ? (
                <div className="p-5 text-sm text-gray-500">Nenhuma submissão recebida ainda.</div>
              ) : submissions.map((submission) => (
                <div key={submission.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-black text-sm text-gray-900 truncate">{submission.hostname || 'Endpoint sem hostname'}</p>
                      <p className="text-xs text-gray-500 truncate">{submission.serialNumber || 'Serial não informado'}</p>
                    </div>
                    <span className={`text-[10px] font-black px-2 py-1 rounded-full ${submission.status === 'processed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {submission.status === 'processed' ? 'Processado' : 'Pendente'}
                    </span>
                  </div>
                  {submission.status !== 'processed' && (
                    <button onClick={() => processSubmission(submission)} disabled={processing} className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gray-900 text-white text-xs font-bold hover:bg-gray-800 disabled:opacity-60">
                      <Play size={14} /> Processar com filtro anti-duplicidade
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};

const InfoRow = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3 border-b border-gray-100 pb-2">
    <span className="text-xs font-bold uppercase text-gray-400">{label}</span>
    <span className="text-right font-mono text-xs font-black text-gray-900 truncate">{value || 'N/A'}</span>
  </div>
);

const ConfigInput = ({ label, value, onChange, type = 'text', ...props }) => (
  <label className="block">
    <span className="text-[10px] font-black uppercase text-gray-400">{label}</span>
    <input
      type={type}
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-black text-gray-900 outline-none focus:border-black focus:bg-white"
      {...props}
    />
  </label>
);

export default AgentManager;

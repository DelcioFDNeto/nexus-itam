# Análise Completa do Sistema Nexus ITAM v2.1.0

## 1. Visão Geral do Sistema

**Nome**: Nexus IT Asset Manager (ITAM)
**Versão**: 2.1.0
**Tipo**: Aplicação Web Progresiva (PWA)
**Stack Principal**: React 19 + Firebase + Vite + Tailwind CSS

---

## 2. Stack Tecnológico Detalhado

### Frontend
| Tecnologia | Versão | Propósito |
|------------|--------|------------|
| React | 19.2.0 | Framework UI |
| React DOM | 19.2.0 | Renderização |
| React Router Dom | 7.10.1 | Roteamento |
| React Hook Form | 7.68.0 | Formulários |
| React To Print | 3.2.0 | Impressão/PDF |
| React Barcode | 1.6.1 | Códigos de barras |
| QRCode React | 4.2.0 | QR Codes |
| Html5 Qrcode | 2.3.8 | Leitor QR Code |

### UI/Styling
| Tecnologia | Versão | Propósito |
|------------|--------|------------|
| Tailwind CSS | 3.4.17 | Framework CSS |
| Tailwind Merge | 3.4.0 | Utilitários |
| Clsx | 2.1.1 | Classes condicionais |
| Lucide React | 0.555.0 | Ícones |

### Charts/Dados
| Tecnologia | Versão | Propósito |
|------------|--------|------------|
| Chart.js | 4.5.1 | Gráficos |
| React Chartjs 2 | 5.3.1 | Integração Chart.js |
| Recharts | 3.5.1 | Gráficos React |

### Backend/Cloud
| Tecnologia | Versão | Propósito |
|------------|--------|------------|
| Firebase | 12.6.0 | Backend Serverless |
| Firestore | - | Banco de dados |
| Firebase Auth | - | Autenticação |
| Firebase Storage | - | Armazenamento |

### Utilitários
| Tecnologia | Versão | Propósito |
|------------|--------|------------|
| Date-fns | 4.1.0 | Datas |
| XLSX | Latest | Excel import/export |
| Sonner | 2.0.7 | Notificações toast |
| Vite PWA | 1.2.0 | PWA |

### Build Tools
| Tecnologia | Versão | Propósito |
|------------|--------|------------|
| Vite | 7.2.4 | Build tool |
| ESLint | 9.39.1 | Linting |
| PostCSS | 8.5.6 | CSS processing |
| Autoprefixer | 10.4.22 | Vendor prefixes |
| Puppeteer | 24.38.0 | E2E testing |

---

## 3. Estrutura de Diretórios

```
itam-shineray/
├── .firebase/              # Hosting Firebase
├── .git/                  # Git
├── dist/                  # Build output
├── public/                # Assets públicos
│   ├── pwa-192x192.png
│   ├── pwa-512x512.png
│   └── logo.png
├── src/
│   ├── assets/            # Assets internos
│   │   ├── logo.png
│   │   └── react.svg
│   ├── components/        # Componentes reutilizáveis
│   │   ├── AssetIcon.jsx
│   │   ├── AssetListSkeleton.jsx
│   │   ├── AssetMetrics.jsx
│   │   ├── AssetTimeline.jsx
│   │   ├── GlobalSearch.jsx
│   │   ├── Layout.jsx
│   │   ├── Logo.jsx
│   │   ├── MaintenanceModal.jsx
│   │   ├── MoveAssetModal.jsx
│   │   ├── PrivateRoute.jsx
│   │   ├── QRScanner.jsx
│   │   ├── Sidebar.jsx
│   │   ├── dashboard/
│   │   │   ├── CategoryRow.jsx
│   │   │   ├── DashboardSkeleton.jsx
│   │   │   └── KpiCard.jsx
│   │   ├── assets/
│   │   │   └── AssetMetrics.jsx
│   │   └── assets/
│   │       └── AssetListSkeleton.jsx
│   ├── contexts/          # Contextos React
│   │   └── AuthContext.jsx
│   ├── hooks/            # Custom hooks
│   │   └── useAssets.js
│   ├── pages/            # Páginas do sistema
│   │   ├── AuditPage.jsx
│   │   ├── AssetDetail.jsx
│   │   ├── AssetForm.jsx
│   │   ├── AssetList.jsx
│   │   ├── Dashboard.jsx
│   │   ├── EmployeeManager.jsx
│   │   ├── ImportData.jsx
│   │   ├── LicenseManager.jsx
│   │   ├── Login.jsx
│   │   ├── ProjectDetails.jsx
│   │   ├── ProjectsPage.jsx
│   │   ├── ServiceManager.jsx
│   │   ├── SettingsPage.jsx
│   │   ├── TaskManager.jsx
│   │   └── Login.jsx
│   ├── services/          # Serviços/API Firebase
│   │   ├── assetService.js
│   │   ├── backupService.js
│   │   ├── contractService.js
│   │   ├── employeeService.js
│   │   ├── firebase.js
│   │   ├── importService.js
│   │   ├── licenseService.js
│   │   ├── projectService.js
│   │   ├── taskService.js
│   │   └── importService.js
│   ├── utils/            # Utilitários
│   │   └── dataMerger.js
│   ├── App.css
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── .env                  # Variáveis ambiente
├── .env.local            # Locais
├── .eslint.config.js
├── .firebaserc
├── firebase.json
├── index.html
├── package.json
├── package-lock.json
├── postcss.config.js
├── README.md
├── tailwind.config.js
└── vite.config.js
```

---

## 4. Sistema de Rotas

### Autenticação
| Rota | Componente | Descrição |
|------|------------|-----------|
| `/` | Login | Página pública de login |

### Rotas Protegidas (PrivateRoute)

#### Gestão de Ativos
| Rota | Componente | Descrição |
|------|------------|-----------|
| `/dashboard` | Dashboard | Dashboard geral com KPIs |
| `/assets` | AssetList | Lista de todos os ativos |
| `/assets/new` | AssetForm | Criar novo ativo |
| `/assets/edit/:id` | AssetForm | Editar ativo existente |
| `/assets/:id` | AssetDetail | Detalhes do ativo |

#### Gestão de Pessoas
| Rota | Componente | Descrição |
|------|------------|-----------|
| `/employees` | EmployeeManager | Gestão de colaboradores |

#### Gestão de Projetos
| Rota | Componente | Descrição |
|------|------------|-----------|
| `/projects` | ProjectsPage | Lista de projetos |
| `/projects/:id` | ProjectDetails | Detalhes do projeto |

#### Outras Gestão
| Rota | Componente | Descrição |
|------|------------|-----------|
| `/tasks` | TaskManager | Gestão de tarefas |
| `/licenses` | LicenseManager | Gestão de licenças |
| `/services` | ServiceManager | Gestão de serviços |
| `/audit` | AuditPage | Auditoria de ativos |
| `/import` | ImportData | Importação de dados |
| `/settings` | SettingsPage | Configurações |

---

## 5. Sistema de Dados Firebase

### Autenticação
- **Provider**: Firebase Auth
- **Contexto**: AuthContext.jsx
- **Proteção**: PrivateRoute.jsx

### Collections Firestore (esperadas)

#### assets
```javascript
{
  id: string,
  name: string,
  type: 'notebook' | 'desktop' | 'mobile' | 'printer' | etc,
  serialNumber: string,
  patrimonyCode: string,
  brand: string,
  model: string,
  purchaseDate: Date,
  purchaseValue: number,
  warrantyEnd: Date,
  status: 'active' | 'maintenance' | 'inactive' | 'discarded',
  assignedTo: string | null, // employee id
  department: string,
  location: string,
  notes: string,
  qrCode: string,
  history: [
    { date: Date, action: string, user: string }
  ],
  createdAt: Date,
  updatedAt: Date
}
```

#### employees
```javascript
{
  id: string,
  name: string,
  email: string,
  cpf: string,
  department: string,
  role: string,
  admissionDate: Date,
  status: 'active' | 'inactive',
  createdAt: Date,
  updatedAt: Date
}
```

#### licenses
```javascript
{
  id: string,
  name: string,
  type: string,
  licenseKey: string,
  expiryDate: Date,
  seats: number,
  usedSeats: number,
  assignedTo: string[],
  createdAt: Date,
  updatedAt: Date
}
```

#### projects
```javascript
{
  id: string,
  name: string,
  description: string,
  status: 'planning' | 'active' | 'completed',
  startDate: Date,
  endDate: Date,
  team: string[],
  createdAt: Date,
  updatedAt: Date
}
```

#### tasks
```javascript
{
  id: string,
  name: string,
  description: string,
  status: 'pending' | 'in_progress' | 'completed',
  priority: 'low' | 'medium' | 'high',
  assignedTo: string,
  projectId: string,
  dueDate: Date,
  createdAt: Date,
  updatedAt: Date
}
```

#### audits
```javascript
{
  id: string,
  date: Date,
  performedBy: string,
  assetsChecked: number,
  findings: number,
  status: 'pending' | 'resolved',
  createdAt: Date
}
```

---

## 6. Serviços e APIs

### assetService.js
- `getAssets()` - Lista todos os ativos
- `getAssetById(id)` - Busca ativo por ID
- `createAsset(data)` - Cria novo ativo
- `updateAsset(id, data)` - Atualiza ativo
- `deleteAsset(id)` - Remove ativo
- `assignAsset(assetId, employeeId)` - Assegna ativo a colaborador
- `moveAsset(assetId, newLocation)` - Move ativo
- `getAssetHistory(id)` - Histórico do ativo

### employeeService.js
- `getEmployees()` - Lista colaboradores
- `getEmployeeById(id)` - Busca colaborador
- `createEmployee(data)` - Cria colaborador
- `updateEmployee(id, data)` - Atualiza colaborador
- `deleteEmployee(id)` - Remove colaborador

### licenseService.js
- `getLicenses()` - Lista licenças
- `createLicense(data)` - Cria licença
- `updateLicense(id, data)` - Atualiza licença
- `assignLicense(licenseId, employeeId)` - Assegna licença

### projectService.js
- `getProjects()` - Lista projetos
- `createProject(data)` - Cria projeto
- `updateProject(id, data)` - Atualiza projeto

### taskService.js
- `getTasks()` - Lista tarefas
- `createTask(data)` - Cria tarefa
- `updateTask(id, data)` - Atualiza tarefa

### contractService.js
- Gerenciamento de contratos

### importService.js
- `importFromExcel(file)` - Importa de Excel
- `importFromJSON(data)` - Importa de JSON
- Validação de dados

### backupService.js
- `exportAllData()` - Exporta todos os dados
- `backupDatabase()` - Faz backup

---

## 7. Componentes Principais

### Layout.jsx
- Estrutura base com Sidebar
- Gerenciamento de estado
- Responsive

### Sidebar.jsx
- Menu de navegação
- Itens: Dashboard, Ativos, Colaboradores, Projetos, Tarefas, Licenças, Serviços, Auditoria, Importar, Configurações

### QRScanner.jsx
- Leitor de QR Code via câmera
- Usado em auditoria

### AssetIcon.jsx
- Ícones dinamicos por tipo de ativo
- Tipos: notebook, desktop, mobile, printer, server, monitor, etc

### AssetTimeline.jsx
- Histórico de movimentações
- Linha cronológica

### MoveAssetModal.jsx
- Modal para mover ativo
- Seleção de localização

### MaintenanceModal.jsx
- Modal para manutenção
- Registro de manutenções

### GlobalSearch.jsx
- Busca global
- Filtros avançados

---

## 8. Páginas Principais

### Dashboard.jsx
- KPIs: Total ativos, valor total, em manutenção, alertas
- Gráficos: Distribuição por tipo, status, setor
- Alertas de garantia vencendo
- Ativos recentes

### AssetList.jsx
- Lista filtrável de ativos
- Busca por nome, código, tipo
- Filtros: status, departamento, tipo
- Ordenação
- Paginação

### AssetForm.jsx
- Formulário de ativos
- Campos: nome, tipo, serial, patrimônio, marca, modelo, compra, valor, garantia
- Validação com React Hook Form

### AssetDetail.jsx
- Detalhes completos do ativo
- Histórico de movimentações
- Termo de responsabilidade (PDF)
- Etiqueta patrimonial (QR Code)
- Opções: Editar, Mover, Manutenção, Descartar

### EmployeeManager.jsx
- CRUD colaboradores
- Vincular ativos
- Termos de responsabilidade

### LicenseManager.jsx
- CRUD licenças
- Controle de asientos
- Alertas de vencimento

### AuditPage.jsx
- Scanner QR Code
- Lista de ativos para auditar
- Registro de auditoria
- Relatório de diferenças

### ImportData.jsx
- Importação Excel/JSON
- Validação
- Preview de dados
- Erros e correções

---

## 9. Funcionalidades Especiais

### Geração de QR Code
- Usado para identificacao de ativos
- Scanneável via mobile

### Geração de Termo de Responsabilidade
- PDF com dados do ativo e colaborador
- Baseado em CLT Art. 462 §1º
- Assinatura digital

### Backup do Sistema
- Exportação JSON completa
- Criptografia
- Restore

### Auditoria Mobile
- Scanner QR Code
- Lista de ativos esperados vs encontrados
- Relatório de diferenças

---

## 10. Configurações

### Firebase (.env)
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

### Vite (vite.config.js)
- Porta: 5173
- Host: true (acesso em rede)
- PWA: enabled

### Tailwind (tailwind.config.js)
- custom colors
- breakpoints
- plugins

---

## 11. Variáveis de Ambiente Disponíveis

```
VITE_API_KEY
VITE_AUTH_DOMAIN
VITE_PROJECT_ID
VITE_STORAGE_BUCKET
VITE_MESSAGING_SENDER_ID
VITE_APP_ID
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

---

## 12. Scripts NPM

```json
{
  "dev": "vite",
  "build": "vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "deploy": "npm run build && firebase deploy"
}
```

---

## 13. Dependências Externas

### Firebase Project ID
- Esperado: `nexusitam` ou similar

### Services
- Firestore (Database)
- Firebase Auth (Authentication)
- Firebase Storage (Arquivos)
- Firebase Hosting (Deploy)

---

## 14. Padrões de Código

### Componentes
- Functional components com hooks
- Props com default values
- Error boundaries

### Services
- Async/await
- Try/catch
- Retornos formatados

### Estado
- useState local
- Context API para global
- Custom hooks

### Estilização
- Tailwind CSS
- Classes condicionais (clsx)
- Responsive design

---

## 15. Fluxo de Uso

### 1. Autenticação
- Usuário acessa `/`
- Login com email/senha Firebase Auth
- Redirecionado para Dashboard

### 2. Gestão de Ativos
- Criar ativo via `/assets/new`
- Ativo recebe código patrimonial e QR Code
- Assegna a colaborador
- Registra histórico

### 3. Auditoria
- Acessa `/audit`
- Escaneia QR Codes
- Sistema compara com lista
- Gera relatório

### 4. Backup
- Acessa `/settings`
- Exporta JSON
- Salva localmente

---

## 16. Boas Práticas Utilizadas

- **Lazy loading de páginas e componentes**: Divisão de rotas principais e carregamento sob demanda do componente pesado `QRScanner` (`html5-qrcode`), reduzindo o bundle de Auditoria de 351 KB para 15 KB.
- **Code splitting granular (manualChunks)**: Separação de dependências pesadas (`firebase`, `react`, `lucide-react`, `sonner`, `recharts`, `xlsx`) em chunks separados para otimizar o cache de longo prazo do navegador.
- **Animações nativas via CSS puro**: Eliminação do framer-motion no caminho crítico inicial (Login e Registro) substituindo por animações nativas otimizadas em CSS (`index.css`), zerando o tempo de bloqueio (TBT).
- **Cache Agressivo HTTP (Firebase Hosting)**: Configuração de cabeçalhos HTTP com cache imutável de 1 ano para bundles compilados baseados em hash e de 30 dias para imagens locais.
- **Otimização de Imagens e Rede**: Uso de imagens WebP moderna de alta compressão (redução da logo de 260 KB para 7.5 KB) e eliminação de conexões DNS externas síncronas.
- **PWA offline-capable**: Uso do plugin Vite PWA com manifestos e Service Worker.
- **Error handling & Form validation**: Tratamento estruturado de erros e validação eficiente via formulários do React.
- **Responsive design & Accessibility**: Interface flexível em todos os viewports e aderente aos padrões semânticos de HTML5.

---

## 17. Pontos de Atenção

- Variáveis de ambiente precisam estar configuradas no ambiente de Build/CI.
- Firebase rules do Firestore precisam estar implantadas de acordo com as regras multi-tenant.
- Storage para imagens precisa estar habilitado e as permissões de gravação configuradas.
- O Service Worker gerado precisa de invalidação imediata em deploys (`no-cache` em `sw.js`).

---

## 18. Fontes e Referências

- Desenvolvido por: Délcio Farias Dias Neto
- Tech Lead & Full Stack Developer
- 2025/2026

---

*Documento atualizado com as melhorias de performance (v2.1.0) em 2026-05-28*
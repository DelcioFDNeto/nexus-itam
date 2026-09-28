# Nexus IT Asset Manager (ITAM) v2.2 🚀

> **Sistema Corporativo de Gestão de Ativos de TI, Licenciamento, Auditoria e Inventário Automatizado.**

![Versão](https://img.shields.io/badge/Versão-2.2.0-indigo?style=for-the-badge&logo=firebase)
![Status](https://img.shields.io/badge/Status-Produção-green?style=for-the-badge&logo=react)
![CI](https://img.shields.io/badge/CI%2FCD-GitHub_Actions-blue?style=for-the-badge&logo=githubactions)
![License](https://img.shields.io/badge/License-Private-gray?style=for-the-badge)

O **Nexus ITAM** é uma plataforma robusta e multi-tenant desenvolvida para centralizar, controlar e auditar todo o parque tecnológico da empresa. Com foco em usabilidade (UI/UX), conformidade jurídica e automação, o sistema oferece desde o rastreamento de hardware até a coleta automatizada de inventário via agente PowerShell.

🔗 **Produção:** [https://itam-nexus.web.app](https://itam-nexus.web.app)

---

## 👨‍💻 Créditos e Autoria

Este projeto foi idealizado, arquitetado e desenvolvido por:

### **Délcio Farias Dias Neto**

_Tech Lead & Full Stack Developer_

> "A tecnologia não é apenas sobre código, é sobre criar soluções que empoderam pessoas e transformam processos."

---

## ✨ Funcionalidades Principais

### 🤖 Agente ITAM (Inventário Automatizado)

- **Script PowerShell Gerado Automaticamente**: A plataforma gera um script `.ps1` personalizado com o Token do tenant embutido, pronto para deploy via GPO/SCCM em centenas de máquinas.
- **Coleta de Hardware**: CPU, RAM, Disco, Placa-Mãe, Nº de Série, IP, Hostname — tudo enviado para o Firestore automaticamente.
- **Coleta de Software (SAM)**: Leitura do Registro do Windows para listar todos os softwares instalados, status do Antivírus e do Firewall.
- **Token Drop-Box (Segurança)**: O agente não requer autenticação Firebase. Ele envia os dados para uma coleção `agentInbox` protegida por regras Firestore que validam o `agentToken` contra as configurações do tenant — sem Cloud Functions, 100% compatível com o plano Spark (gratuito).
- **Detecção de Duplicatas**: O sistema identifica automaticamente ativos já registrados (por Serial, Hostname ou IP) e atualiza em vez de duplicar.
- **Dedução Automática de Licenças**: Softwares detectados pelo agente são cruzados com o módulo de Licenças para deduzir automaticamente as licenças em uso.
- **Aprovação em Lote (Bulk Actions)**: Checkboxes + botão "Incorporar Selecionados" para aprovar centenas de ativos de uma vez.
- **Auto-Accept por IPs Confiáveis**: Regras configuráveis de aprovação automática baseadas em faixas de IP da empresa (desabilitado por padrão, com toggle explícito na interface).

### 🖥️ Gestão de Ativos Avançada

- **Ciclo de Vida Completo**: Do registro à baixa (descarte/venda).
- **Rastreabilidade**: Histórico imutável de movimentações, manutenções e trocas de responsabilidade.
- **Identidade Visual**: Ícones inteligentes para cada tipo de ativo (Notebook, Desktop, Mobile, Impressoras, Roteadores, etc).
- **Etiquetagem**: Geração automática de Etiquetas Patrimoniais com QR Code e Código de Barras.
- **Exportação**: Relatórios em Excel (XLSX) com filtros avançados.

### 📋 Gestão de Projetos & Tarefas

- **Projetos**: Kanban com fases, orçamento, equipe vinculada e upload de imagens.
- **Tarefas**: Atribuição de tarefas a colaboradores com status, prioridades e prazos.
- **Timeline de Atividades**: Histórico visual de ações em cada projeto.

### 💿 Gestão de Licenças (SAM)

- **Controle de Licenças**: Registro de chaves, datas de expiração, tipo (perpétua/assinatura), e quantidades.
- **Dedução Automática**: Integração com o Agente ITAM para calcular automaticamente licenças em uso vs. disponíveis.
- **Alertas de Expiração**: Identificação visual de licenças vencidas ou próximas do vencimento.

### 🌐 Gestão de Contratos & Serviços

- **Contratos de TI**: Registro de provedores de internet, telefonia, cloud, e suporte com custos mensais e datas de renovação.

### ⚖️ Conformidade Jurídica (Compliance)

- **Termo de Responsabilidade**: Geração automática de termos em PDF (A4).
- **Blindagem Jurídica**: Texto conforme **Art. 462 §1º da CLT** e Código Civil, com cláusulas de desconto em folha e responsabilidade por dolo/negligência.
- **Assinatura Digital**: Campos preparados para assinatura física ou digital.

### 📊 Dashboard & BI

- **KPIs em Tempo Real**: Valor total do parque, status dos ativos, projetos ativos, e alertas.
- **Gráficos Interativos**: Distribuição por tipo (Bar Chart) e status operacional (Doughnut) via Chart.js.
- **Dashboard Superadmin (Nexus Master)**: Visão global de todos os tenants, receitas, e distribuição de planos.
- **Auditoria Mobile**: Scanner de QR Code integrado para inventários físicos rápidos via celular.

### 🛡️ Segurança & Multi-Tenancy

- **Isolamento por Tenant**: Cada empresa opera em um silo de dados completamente isolado. As Firestore Rules garantem que nenhum tenant acesse dados de outro.
- **Entrada controlada**: um perfil só nasce junto com a empresa que o próprio usuário está fundando ou consumindo um convite pendente endereçado ao e-mail dele — ninguém se vincula sozinho a uma empresa existente.
- **RBAC (Role-Based Access Control)**: papéis `owner`, `admin`, `manager`, `member`, `operator` e `viewer` (mais `superadmin` no tenant master). Admin não cria nem altera owners/admins; ninguém altera o próprio papel ou status.
- **Suspensão real**: empresa suspensa/encerrada e usuário suspenso perdem o acesso aos dados (validado nas regras, não só na tela).
- **Token Drop-Box para Agente**: Validação de token via Firestore Rules (sem Cloud Functions); empresas suspensas deixam de receber envios.
- **Backup Inteligente**: Exportação completa do banco de dados (JSON) com opção de restauração.
- **Importação Resiliente**: Importação em massa via Excel/JSON com validação pré-processamento.
- **Logs de Auditoria**: Registro detalhado de quem fez o quê e quando.

### 👥 Gestão de Pessoas

- **Colaboradores & Departamentos**: Cadastro completo com cargo, email, CPF, filial e setor.
- **Vínculo Ativo-Colaborador**: Associação direta entre ativos e responsáveis com histórico.

### 🏢 Plataforma Multi-Tenant (Nexus Master)

- **Visão do dono**: receita recorrente (MRR/ARR), empresas ativas, novas, uso de limites, empresas legadas e alertas acionáveis (limite atingido, inatividade, sem owner).
- **Visão 360° por empresa**: plano, limites e recursos **sob medida** (ex.: liberar o Agente para um cliente Starter), mensalidade negociada, identidade visual, membros, notas comerciais internas e suspensão/encerramento reversível.
- **Empresas legadas**: tenants usados por perfis mas sem cadastro em `/tenants` aparecem no console e podem ser regularizados sem mexer nos dados.
- **Gestão de Planos**: limites e recursos por plano, aplicados de fato no app de cada empresa (`src/utils/entitlements.js`).
- **Convites por link**: o administrador gera um link `/convite/{id}` (válido por 7 dias) e envia por e-mail ou mensagem; o convidado cria a senha e entra direto na empresa.
- **Personalização por empresa**: nome, logotipo, cor da marca (com prévia e aviso de contraste), texto do termo, rodapé das etiquetas, módulos visíveis e tipos/campos de ativo próprios. O whitelabel completo remove a marca Nexus do menu, etiquetas e termos.

### ⚡ Performance & PWA

- **Code Splitting Inteligente**: Divisão granular de bundles via Vite (`manualChunks`) — Firebase SDK, React Core e UI isolados em caches independentes de longo prazo.
- **Lazy Loading Estratégico**: Todas as 19 páginas do sistema são carregadas sob demanda (`React.lazy`). Bibliotecas pesadas (jsPDF, XLSX, Chart.js, QRScanner) são importadas dinamicamente apenas quando necessário.
- **PWA Instalável**: Aplicação instalável no Desktop e Mobile com Service Worker (Workbox) e atualização automática com notificação visual (PWA Toast).
- **Skeletons UI**: Telas de carregamento estilizadas (DashboardSkeleton, ManagerSkeleton) para UX fluida durante fetches.
- **Cache Agressivo**: Headers de cache permanente de 1 ano (imutável) via Firebase Hosting.
- **Recursos Otimizados**: Logos em WebP moderno e eliminação de dependências DNS externas.

---

## 🛠️ Stack Tecnológico

| Categoria                | Tecnologias                                                     |
| ------------------------ | --------------------------------------------------------------- |
| **Frontend**             | React 19, Vite 7, Tailwind CSS 3                                |
| **Backend (Serverless)** | Firebase (Firestore, Auth, Hosting, Rules)                      |
| **Linguagem**            | JavaScript (ESNext)                                             |
| **PWA**                  | Vite PWA Plugin + Workbox (Instalável Desktop/Mobile)           |
| **Charts**               | Chart.js + react-chartjs-2                                      |
| **PDF/Print**            | jsPDF + jsPDF-AutoTable, React-to-Print                         |
| **Excel**                | SheetJS (XLSX)                                                  |
| **Ícones**               | Lucide React                                                    |
| **Animações**            | Framer Motion, CSS Animations                                   |
| **QR Code**              | qrcode.react, html5-qrcode (Scanner)                           |
| **Testes**               | Vitest + Happy-DOM + Testing Library                            |
| **CI/CD**                | GitHub Actions (Lint → Tests → Build) — Node 20.x / 22.x       |
| **Linting**              | ESLint 9 (Flat Config)                                          |
| **Formulários**          | React Hook Form                                                 |

---

## 🏗️ Arquitetura do Projeto

```
nexus-itam/
├── .github/workflows/     # CI/CD Pipeline (GitHub Actions)
│   └── ci.yml
├── public/                # Assets estáticos (PWA icons, logos)
├── src/
│   ├── components/        # Componentes reutilizáveis
│   │   ├── dashboard/     # DashboardCharts, DashboardSkeleton, ManagerSkeleton
│   │   ├── Layout.jsx     # Shell principal (Sidebar + Header)
│   │   ├── PrivateRoute.jsx
│   │   └── PWAToast.jsx   # Notificação de atualização do PWA
│   ├── contexts/          # React Contexts
│   │   ├── AuthContext.jsx # Autenticação + RBAC + Multi-Tenancy
│   │   └── ThemeContext.jsx
│   ├── pages/             # 19 páginas com Lazy Loading
│   │   ├── AgentManager.jsx       # Agente ITAM (Inbox, Scripts, Bulk Actions)
│   │   ├── AssetList/Form/Detail  # CRUD completo de Ativos
│   │   ├── AuditPage.jsx          # Auditoria com QR Scanner
│   │   ├── Dashboard.jsx          # Dashboard principal
│   │   ├── EmployeeManager.jsx    # Colaboradores & Departamentos
│   │   ├── LicenseManager.jsx     # Licenças de Software (SAM)
│   │   ├── ProjectsPage.jsx       # Gestão de Projetos
│   │   ├── ServiceManager.jsx     # Contratos de TI
│   │   ├── SettingsPage.jsx       # Configurações & Whitelabel
│   │   ├── TaskManager.jsx        # Gestão de Tarefas
│   │   └── ...                    # Admin: Tenants, Users, Plans
│   ├── services/          # Camada de dados (Firestore)
│   │   ├── agentService.js        # Registro, duplicatas, SAM, licenças
│   │   ├── assetService.js        # CRUD de ativos + histórico
│   │   └── ...
│   └── utils/
│       └── agentScripts.js        # Gerador de scripts PowerShell
├── firestore.rules        # Regras de segurança (Token Drop-Box)
├── firestore.indexes.json
├── vite.config.js         # Build config (Code Splitting, PWA)
└── vitest.config.js       # Test config (Happy-DOM)
```

---

## 🧪 Testes & Qualidade

O projeto conta com uma suíte automatizada de testes unitários:

```bash
# Rodar testes uma vez
npm run test

# Rodar testes em modo watch
npm run test:watch

# Rodar linter
npm run lint
```

Regras do Firestore (cenários de ataque contra o emulador — exige Java):

```bash
npm run test:rules
```

| Suíte                        | Testes | Cobertura                                    |
| ---------------------------- | ------ | -------------------------------------------- |
| `agentService.test.js`       | 3      | Registro, duplicatas, normalização SAM       |
| `assetService.test.js`       | 4      | CRUD de ativos, histórico                    |
| `employeeService.test.js`    | 4      | CRUD de colaboradores e departamentos        |
| `licenseService.test.js`     | 2      | CRUD de licenças                             |
| `ThemeContext.test.jsx`      | 2      | Toggle de tema claro/escuro                  |
| `Login.test.jsx`             | 3      | Renderização, login com sucesso, erro        |
| `AssetForm.test.jsx`         | 2      | Renderização dinâmica, submissão             |
| **Total**                    | **20** | **7 suítes, 100% passando**                  |

### CI/CD Pipeline

Toda push para `dev` ou `main` dispara automaticamente:

```
Lint (ESLint) → Testes (Vitest) → Build (Vite)
```

Matrix: **Node 20.x** e **Node 22.x** no Ubuntu latest.

---

## 🚀 Como Executar o Projeto

### Pré-requisitos

- Node.js 20+ (recomendado 22+)
- NPM

### Passo a Passo

1. **Clone o repositório**

   ```bash
   git clone https://github.com/DelcioFDNeto/nexus-itam.git
   cd nexus-itam
   ```

2. **Instale as dependências**

   ```bash
   npm install
   ```

3. **Configuração de Ambiente**
   Crie um arquivo `.env` na raiz do projeto com as credenciais do Firebase:

   ```env
   VITE_FIREBASE_API_KEY=seu_api_key
   VITE_FIREBASE_AUTH_DOMAIN=seu_projeto.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=seu_project_id
   VITE_FIREBASE_STORAGE_BUCKET=seu_bucket.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=seu_sender_id
   VITE_FIREBASE_APP_ID=seu_app_id
   ```

   Para desenvolver sem tocar em dados reais, rode `firebase emulators:start --only auth,firestore --project demo-nexus-itam` e inicie o app com `VITE_USE_EMULATORS=true` e `VITE_FIREBASE_PROJECT_ID=demo-nexus-itam`.

4. **Execute o Servidor de Desenvolvimento**
   ```bash
   npm run dev
   ```
   Acesse: `http://localhost:5173`

5. **Build & Deploy**
   ```bash
   npm run deploy
   ```

---

## 📜 Histórico de Versões

- **v2.2.0 (Atual)**:
  - 🤖 **Agente ITAM** com segurança via Token Drop-Box (Firestore Rules, sem Cloud Functions).
  - 💿 **Coleta Profunda (SAM)**: Software, Antivírus e Firewall via Registro do Windows.
  - ⚡ **Bulk Actions**: Aprovação em lote + Auto-Accept por IPs confiáveis (desabilitado por padrão).
  - 🧪 **Suíte de Testes**: 20 testes unitários (Vitest + Happy-DOM + Testing Library).
  - 🔄 **CI/CD**: GitHub Actions com pipeline Lint → Tests → Build (Node 20 + 22).
  - 🚀 **Performance**: Lazy loading de gráficos, PWA Toast global, happy-dom 2x mais rápido que jsdom.
  - 🔒 **Dedução automática de licenças** baseada nos softwares detectados pelo agente.
- **v2.1.0**: Upgrade massivo de performance (PageSpeed 90+), Code Splitting granular, Lazy Loading, animações CSS nativas, otimização WebP e cache agressivo.
- **v2.0.0**: Rebranding "Nexus ITAM", Nova UI/UX Glassmórfica, Termo Jurídico CLT, Backup System 2.0, Multi-Tenancy.
- **v1.5.0**: Módulo de Auditoria Mobile com QR Code.
- **v1.0.0**: Lançamento inicial (Legacy BySabel).

---

## 📄 Scripts Disponíveis

| Comando             | Descrição                               |
| ------------------- | --------------------------------------- |
| `npm run dev`       | Servidor de desenvolvimento (Vite)      |
| `npm run build`     | Build de produção otimizada             |
| `npm run preview`   | Preview da build de produção            |
| `npm run deploy`    | Build + Deploy para Firebase Hosting    |
| `npm run lint`      | Análise estática de código (ESLint)     |
| `npm run test`      | Execução da suíte de testes (Vitest)    |
| `npm run test:watch`| Testes em modo watch (desenvolvimento)  |
| `npm run test:rules`| Testes das regras do Firestore (emulador) |

---

© 2026 **Nexus ITAM**. Todos os direitos reservados.
_Desenvolvido com orgulho por Délcio Farias Dias Neto._

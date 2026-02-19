# BySabel IT Asset Manager (ITAM) v2.0 🚀

> **Sistema Corporativo de Gestão de Ativos de TI, Licenciamento e Auditoria.**

![Shield](https://img.shields.io/badge/Versão-2.0.0-red?style=for-the-badge&logo=firebase)
![Shield](https://img.shields.io/badge/Status-Estável-green?style=for-the-badge&logo=react)
![Shield](https://img.shields.io/badge/License-Private-blue?style=for-the-badge)

O **BySabel ITAM** é uma plataforma robusta desenvolvida para centralizar, controlar e auditar todo o parque tecnológico da empresa. Com foco em usabilidade (UI/UX 2.0) e conformidade jurídica, o sistema oferece desde o rastreamento de hardware até a gestão contratual de colaboradores.

---

## 👨‍💻 Créditos e Autoria

Este projeto foi idealizado, arquitetado e desenvolvido por:

### **Délcio Farias Dias Neto**

_Tech Lead & Full Stack Developer_

> "A tecnologia não é apenas sobre código, é sobre criar soluções que empoderam pessoas e transformam processos."

Com dedicação exclusiva à modernização da infraestrutura de TI, Délcio liderou a transição digital implementando tecnologias de ponta para garantir segurança, agilidade e confiabilidade na gestão de ativos corporativos.

---

## ✨ Funcionalidades Principais (v2.0)

### 🖥️ Gestão de Ativos Avançada

- **Ciclo de Vida Completo**: Do registro à baixa (descarte/venda).
- **Rastreabilidade**: Histórico imutável de movimentações, manutenções e trocas de responsabilidade.
- **Identidade Visual**: Ícones inteligentes para cada tipo de ativo (Notebook, Desktop, Mobile, Impressoras).
- **Etiquetagem**: Geração automática de Etiquetas Patrimoniais com QR Code.

### ⚖️ Conformidade Jurídica (Compliance)

- **Termo de Responsabilidade**: Geração automática de termos em PDF (A4).
- **Blindagem Jurídica**: Texto conforme **Art. 462 §1º da CLT** e Código Civil, com cláusulas de desconto em folha e responsabilidade por dolo/negligência.
- **Assinatura Digital**: Campos preparados para assinatura física ou digital.

### 📊 Dashboard & BI

- **KPIs em Tempo Real**: Valor total do parque, status dos ativos, e alertas de garantia.
- **Gráficos Interativos**: Distribuição por setor, tipo e integridade.
- **Auditoria Mobile**: App com scanner de QR Code para realizar inventários físicos rapidamente via celular.

### 🛡️ Segurança & Backup

- **Backup Inteligente**: Exportação completa do banco de dados (JSON) com criptografia de ponta a ponta.
- **Importação Resiliente**: Ferramenta de importação em massa (Excel/JSON) com validação de dados pré-processamento.
- **Logs de Auditoria**: Registro detalhado de quem fez o quê e quando.

### 👥 Gestão de Pessoas

- **Vínculo Empregatício**: Associação direta entre ativos e colaboradores.
- **Portal do Colaborador**: (Em Roadmap) Visualização dos ativos sob sua guarda.

---

## 🛠️ Stack Tecnológico

O sistema foi construído utilizando as tecnologias mais modernas do mercado (2025/2026):

| Categoria                | Tecnologias                                    |
| ------------------------ | ---------------------------------------------- |
| **Frontend**             | React 19, Vite, Tailwind CSS 4                 |
| **Backend (Serverless)** | Firebase (Firestore, Auth, Storage, Functions) |
| **Linguagem**            | JavaScript (ESNext)                            |
| **PWA**                  | Vite PWA Plugin (Instalável no Desktop/Mobile) |
| **Charts**               | Chart.js, Recharts                             |
| **PDF/Print**            | React-to-Print, JSPDF                          |
| **Ícones**               | Lucide React                                   |

---

## 🚀 Como Executar o Projeto

### Pré-requisitos

- Node.js 20+
- NPM ou Yarn

### Passo a Passo

1. **Clone o repositório**

   ```bash
   git clone https://github.com/DelcioFDNeto/itam-shineray.git
   cd itam-shineray
   ```

2. **Instale as dependências**

   ```bash
   npm install
   ```

3. **Configuração de Ambiente**
   Crie um arquivo `.env` na raiz do projeto com as credenciais do Firebase:

   ```env
   VITE_API_KEY=seu_api_key
   VITE_AUTH_DOMAIN=seu_projeto.firebaseapp.com
   VITE_PROJECT_ID=seu_project_id
   VITE_STORAGE_BUCKET=seu_bucket.appspot.com
   VITE_MESSAGING_SENDER_ID=seu_sender_id
   VITE_APP_ID=seu_app_id
   ```

4. **Execute o Servidor de Desenvolvimento**
   ```bash
   npm run dev
   ```
   Acesse: `http://localhost:5173`

---

## 📜 Histórico de Versões

- **v2.0.0 (Atual)**: Rebranding "BySabel", Nova UI/UX, Termo Jurídico CLT, Backup System 2.0.
- **v1.5.0**: Módulo de Auditoria Mobile com QR Code.
- **v1.0.0**: Lançamento inicial (Legacy).

---

© 2026 **BySabel ITAM**. Todos os direitos reservados.
_Desenvolvido com orgulho por Délcio Farias Dias Neto._

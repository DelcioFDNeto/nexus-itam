// scripts/runProjectUpdates.js
import { patchProjectDoc, getProjectDoc, createProjectDoc } from './updateProjectsFromAudit.js';

async function main() {
  console.log('=== ATUALIZANDO PROJETOS NO FIRESTORE ===\n');

  // 1. Nexus ITAM (K3NaLEPgdfve7ND5hcfK)
  console.log('1. Atualizando Nexus ITAM (K3NaLEPgdfve7ND5hcfK)...');
  await patchProjectDoc('K3NaLEPgdfve7ND5hcfK', {
    version: '3.0.0',
    status: 'Em Andamento',
    progress: '92',
    leader: 'Délcio Farias Dias Neto',
    description: 'Plataforma B2B Enterprise de Gestão de Ativos de TI (ITAM), Licenças (SAM), Termos CLT com Assinatura Digital e Service Desk Hub com 5 Microsserviços e WebSocket RFC 6455.',
    newChangelogEntry: 'v3.0.0: Lançamento da arquitetura v3.0 com cluster de microserviços (Fastify), Portal do Colaborador desacoplado em Vue 3 com Firebase Multi-Site Hosting, Service Desk Hub corporativo padrão B2B Enterprise, gerador adaptativo de tags patrimoniais e Agente NexusDesk v3.2 com serviço de segundo plano, telemetria em tempo real e atualização OTA remota. (30/10/2026)'
  });
  console.log('-> Nexus ITAM atualizado.');

  // 2. Agente ITAM V3 (gc98F4re7ypE0uDobBUw)
  console.log('2. Atualizando Agente ITAM V3 (gc98F4re7ypE0uDobBUw)...');
  await patchProjectDoc('gc98F4re7ypE0uDobBUw', {
    version: '3.2',
    status: 'Em Andamento',
    progress: '90',
    leader: 'Délcio Farias Dias Neto',
    description: 'Agente de telemetria RMM e inventário automatizado WMI/Registry com modo serviço de segundo plano Windows, System Tray e atualização remota OTA.',
    newChangelogEntry: 'v3.2: Evolução do agente com modo de execução como Serviço do Windows em segundo plano, telemetria nativa WMI/Registry sem dependência de Cloud Functions (Token Drop-Box spark-compatible), bandeja do sistema (System Tray), token único por máquina com autenticação timing-safe e pipeline de atualização remota OTA via GitHub Releases. (30/10/2026)'
  });
  console.log('-> Agente ITAM V3 atualizado.');

  // 3. BySabel BI (CzTHF6vZItW5ipWO7Ann)
  console.log('3. Atualizando BySabel BI (CzTHF6vZItW5ipWO7Ann)...');
  await patchProjectDoc('CzTHF6vZItW5ipWO7Ann', {
    version: '1.2.0',
    status: 'Em Andamento',
    progress: '88',
    leader: 'Délcio Farias Dias Neto',
    description: 'Plataforma executiva de Business Intelligence para vendas, faturamento, pós-venda, estoque, precificação e DRG/DRE das concessionárias Shineray By Sabel.',
    newChangelogEntry: 'v1.2.0: Consolidação da apuração DRG com pareamento rigoroso de devoluções, suporte à unidade de Abaetetuba (filial 52), módulo de vendas antecipadas com deduplicação automática, metas individuais por vendedor (motos e consórcios) com projeção diária e tabela de precificação com presets configuráveis. (30/10/2026)'
  });
  console.log('-> BySabel BI atualizado.');

  // 4. SGM By Sabel (C0wIt78PnR8biAbAFIC6)
  console.log('4. Atualizando SGM By Sabel (C0wIt78PnR8biAbAFIC6)...');
  await patchProjectDoc('C0wIt78PnR8biAbAFIC6', {
    version: '2.0.0',
    status: 'Concluído',
    progress: '95',
    leader: 'Délcio Farias Dias Neto',
    description: 'Sistema web industrial para controle e rastreabilidade total da linha fabril de montagem de motocicletas Shineray By Sabel em 5 estações (E1 a E5).',
    newChangelogEntry: 'v2.0.0: Entrega da V2 com arquitetura visual em 5 estações fabris (E1 a E5), painel de alertas Andon, prontuário digital unificado do chassi, inventário do pátio em tempo real com múltiplos tablets, upload direto de fotos de avarias/QA e controle de acesso RBAC com autenticação simplificada para operadores. (30/10/2026)'
  });
  console.log('-> SGM By Sabel atualizado.');

  // 5. By Sabel Logística (gWpag6BO1j9dzGVHMNSQ)
  console.log('5. Atualizando By Sabel Logística (gWpag6BO1j9dzGVHMNSQ)...');
  await patchProjectDoc('gWpag6BO1j9dzGVHMNSQ', {
    version: '3.0.0',
    status: 'Concluído',
    progress: '98',
    leader: 'Délcio Farias Dias Neto',
    description: 'Sistema de gestão logística para transferência de motocicletas, expedição, rotas, montagem de carga e catálogo de reposição de peças da rede Shineray By Sabel.',
    newChangelogEntry: 'v3.0.0: Lançamento da v3.0 com módulo integrado de gestão de peças (2.380+ SKUs), ferramenta "Onde Encontrar" para remanejamento ágil de saldos entre filiais, Design System v3 padronizado em 24 telas corporativas, módulo de auditoria reativado e alternância dinâmica de módulos opcionais. (30/10/2026)'
  });
  console.log('-> By Sabel Logística atualizado.');

  // 6. E-commerce Shineray by Sabel (ecommerce-shineray-parts)
  console.log('6. Verificando / Criando E-commerce Shineray by Sabel (ecommerce-shineray-parts)...');
  const existingEcom = await getProjectDoc('ecommerce-shineray-parts');
  if (existingEcom) {
    await patchProjectDoc('ecommerce-shineray-parts', {
      version: '0.5.0',
      status: 'Em Andamento',
      progress: '72',
      leader: 'Délcio Farias / SamuelbaldMatos',
      description: 'Loja própria de peças e acessórios Shineray com integração ao ERP Microwork, catálogo por moto/ano, vistas explodidas, checkout transparente e frete Melhor Envio.',
      newChangelogEntry: 'v0.5.0: Conclusão da Onda 5 (Etapa 1) com fluxo completo de operação do pedido na API (separação, conferência, despacho e retirada), auditoria de entrega em tempo real, monitoramento automático de pedidos parados, validação matemática e bloqueio de expedição sem NF-e autorizada e adaptadores reais de CEP, e-mail e segurança de senhas. (30/10/2026)'
    });
    console.log('-> E-commerce Shineray by Sabel atualizado.');
  } else {
    await createProjectDoc('ecommerce-shineray-parts', {
      name: 'E-commerce Shineray by Sabel',
      description: 'Loja própria de peças e acessórios Shineray com integração ao ERP Microwork, catálogo por moto/ano, vistas explodidas, checkout transparente (PIX/Cartão) e frete inteligente Melhor Envio.',
      version: '0.5.0',
      status: 'Em Andamento',
      progress: '72',
      priority: 'Alta',
      leader: 'Délcio Farias / SamuelbaldMatos',
      deadline: '2026-11-30',
      tenantId: 'tenant-ap3htf6',
      newChangelogEntry: 'v0.5.0: Conclusão da Onda 5 (Etapa 1) com fluxo completo de operação do pedido na API (separação, conferência, despacho e retirada), auditoria de entrega em tempo real, monitoramento automático de pedidos parados, validação matemática e bloqueio de expedição sem NF-e autorizada e adaptadores reais de CEP, e-mail e segurança de senhas. (30/10/2026)'
    });
    console.log('-> E-commerce Shineray by Sabel criado no Firestore com sucesso.');
  }

  console.log('\n=== TODOS OS PROJETOS ATUALIZADOS COM SUCESSO NO FIRESTORE! ===');
}

main().catch((err) => {
  console.error('Erro na execução:', err);
  process.exit(1);
});

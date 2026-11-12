// src/utils/remoteControlConstants.js

export const QUALITY_LABELS = {
  low: 'Turbo 30+ FPS (768p)',
  balanced: 'Equilibrada (1088p)',
  high: 'Alta HD (1366p+)',
};

export const SESSION_END_MESSAGES = {
  rejected: 'O colaborador recusou o acesso NexusDesk (ou não respondeu em 30 s).',
  refused_policy: 'A política da empresa desligou o acesso remoto.',
  ended_by_user: 'O colaborador encerrou o acesso remoto.',
  timeout: 'Sessão encerrada pelo agente por inatividade ou tempo limite.',
  ended: 'Sessão NexusDesk encerrada.',
};

export const WINGET_PRESETS = [
  { label: 'Google Chrome', pkg: 'Google.Chrome' },
  { label: 'Mozilla Firefox', pkg: 'Mozilla.Firefox' },
  { label: '7-Zip', pkg: '7zip.7zip' },
  { label: 'Adobe Acrobat Reader', pkg: 'Adobe.Acrobat.Reader.64-bit' },
  { label: 'LibreOffice', pkg: 'TheDocumentFoundation.LibreOffice' },
];

// src/components/RemoteControlModal.test.jsx
import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RemoteControlModal from './RemoteControlModal';
import { 
  QUALITY_LABELS, 
  SESSION_END_MESSAGES, 
  WINGET_PRESETS 
} from '../utils/remoteControlConstants';

let registeredWsCallback = null;

// Mock dos serviços de rmm e firebase
vi.mock('../services/rmmService', () => ({
  DEFAULT_RUNTIME_POLICY: { remoteAccess: 'attended', commandsEnabled: true, heartbeatSeconds: 30 },
  MAX_COMMAND_LENGTH: 1000,
  QUICK_POWERSHELL_ACTIONS: [
    { id: 'ipconfig', label: 'IP & DNS', command: 'ipconfig /all', description: 'Rede' },
  ],
  REMOTE_COMMANDS: {
    POWERSHELL: 'powershell',
    FORCE_INVENTORY: 'force_inventory',
    KILL_PROCESS: 'kill_process',
    LOCK_SCREEN: 'lock_screen',
    RESTART: 'restart',
    SHUTDOWN: 'shutdown',
    MSGBOX: 'msgbox',
    INSTALL_WINGET: 'install_winget',
    UNINSTALL_SOFTWARE: 'uninstall_software',
  },
  clearRemoteInputEvents: vi.fn().mockResolvedValue(true),
  dispatchAgentUpdate: vi.fn().mockResolvedValue({ id: 'upd-1' }),
  dispatchRemoteCommand: vi.fn().mockResolvedValue({ id: 'cmd-1' }),
  formatAccessId: vi.fn((_dev) => 'ND-12345'),
  isDeviceOnline: vi.fn(() => true),
  pingRemoteViewer: vi.fn().mockResolvedValue(true),
  resolveSupportRequest: vi.fn().mockResolvedValue(true),
  revokeAgentDevice: vi.fn().mockResolvedValue(true),
  sendRemoteInputEvents: vi.fn().mockResolvedValue(true),
  startRemoteSession: vi.fn().mockResolvedValue('ses-test-123'),
  stopRemoteSession: vi.fn().mockResolvedValue(true),
  subscribeAgentDevice: vi.fn((t, d, cb) => {
    cb({
      deviceKey: 'dev-001',
      hostname: 'NTB-TI-01',
      internalId: 'NTB-TI-01',
      loggedUser: 'carlos.silva',
      agentVersion: '3.2.0',
      screenFrame: { seq: 1, data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }
    });
    return () => {};
  }),
  subscribeRuntimePolicy: vi.fn((t, cb) => {
    cb({ remoteAccess: 'attended', commandsEnabled: true });
    return () => {};
  }),
  updateRemoteQuality: vi.fn().mockResolvedValue(true),
  wakeAgentDevice: vi.fn().mockResolvedValue(true),
}));

vi.mock('../services/agentService', () => ({
  processAgentInbox: vi.fn().mockResolvedValue({ processed: 0 }),
}));

vi.mock('../services/microservicesClient', () => ({
  microservicesApi: {
    openNexusDeskSocket: vi.fn((t, cb) => {
      registeredWsCallback = cb;
      return {
        pushRemoteControl: vi.fn(),
        ping: vi.fn(),
        close: vi.fn(),
      };
    }),
    updateRemoteControlRelay: vi.fn().mockResolvedValue({ accepted: true }),
  },
}));

vi.mock('./ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

describe('RemoteControlModal (NexusDesk PWA Mobile & Desktop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredWsCallback = null;
  });

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    tenantId: 'tenant-test-itam',
    initialDevice: {
      deviceKey: 'dev-001',
      hostname: 'NTB-GESTOR-01',
      internalId: 'SHL-NTB-01',
      loggedUser: 'gestor@shineray.com.br',
      agentVersion: '3.2.0',
    },
    currentUser: { name: 'Admin TI', email: 'admin@shineray.com.br', role: 'admin' },
  };

  it('renders correctly when open and displays accessId and patrimony', async () => {
    await act(async () => {
      render(<RemoteControlModal {...defaultProps} />);
    });
    expect(screen.getByText(/ID ND-12345/i)).toBeInTheDocument();
    expect(screen.getAllByText(/NTB-TI-01/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/carlos\.silva/i)).toBeInTheDocument();
  });

  it('does not render when isOpen is false', async () => {
    let container;
    await act(async () => {
      const res = render(<RemoteControlModal {...defaultProps} isOpen={false} />);
      container = res.container;
    });
    expect(container.firstChild).toBeNull();
  });

  it('exports quality labels supporting Turbo 30+ FPS and standard modes', () => {
    expect(QUALITY_LABELS.low).toContain('Turbo 30+ FPS');
    expect(QUALITY_LABELS.balanced).toBeDefined();
    expect(QUALITY_LABELS.high).toBeDefined();
  });

  it('exports session end messages and winget presets', () => {
    expect(SESSION_END_MESSAGES.rejected).toBeDefined();
    expect(WINGET_PRESETS.length).toBeGreaterThan(0);
    expect(WINGET_PRESETS.some(p => p.pkg.includes('Chrome'))).toBe(true);
  });

  it('allows switching tabs between Screen, Terminal, Processes, and Actions', async () => {
    await act(async () => {
      render(<RemoteControlModal {...defaultProps} />);
    });
    
    // Alterna para Terminal PowerShell
    const termBtn = screen.getByRole('button', { name: /PowerShell/i });
    await act(async () => {
      fireEvent.click(termBtn);
    });
    expect(screen.getByText(/Ações Rápidas PowerShell/i)).toBeInTheDocument();

    // Alterna para Processos
    const procBtn = screen.getByRole('button', { name: /Processos/i });
    await act(async () => {
      fireEvent.click(procBtn);
    });
    expect(screen.getByText(/USO DE CPU/i)).toBeInTheDocument();

    // Alterna para Ações
    const actBtn = screen.getByRole('button', { name: /Ações/i });
    await act(async () => {
      fireEvent.click(actBtn);
    });
    expect(screen.getByText(/Atualização Remota OTA/i)).toBeInTheDocument();
  });

  it('allows toggling between Trackpad Virtual and Direct Touch mode', async () => {
    await act(async () => {
      render(<RemoteControlModal {...defaultProps} />);
    });
    
    const trackpadToggle = screen.getByTitle(/Alternar entre Trackpad Virtual e Toque Direto/i);
    expect(trackpadToggle).toBeInTheDocument();
    
    await act(async () => {
      fireEvent.click(trackpadToggle);
    });
    expect(screen.getAllByText(/Toque Direto/i).length).toBeGreaterThan(0);
  });

  it('renders Windows system shortcut buttons (Ctrl+Alt+Del, Alt+Tab, Win, Esc)', async () => {
    await act(async () => {
      render(<RemoteControlModal {...defaultProps} />);
    });
    expect(screen.getByRole('button', { name: 'Ctrl+Alt+Del' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alt+Tab' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Win' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Esc' })).toBeInTheDocument();
  });

  it('receives WebSocket frames delivered via service-nexusdesk envelope', async () => {
    await act(async () => {
      render(<RemoteControlModal {...defaultProps} />);
    });

    const connectBtn = screen.getByRole('button', { name: /Conectar NexusDesk/i });
    await act(async () => {
      fireEvent.click(connectBtn);
    });

    // Despacha frame via WebSocket com o envelope do Fastify service-nexusdesk
    await act(async () => {
      registeredWsCallback?.({
        protocol: 'nexusdesk-ws/3.0',
        event: 'remote.frame',
        data: {
          deviceKey: 'dev-001',
          sessionId: 'ses-test-123',
          frame: {
            seq: 2,
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            quality: 'low',
          },
          remoteState: {
            state: 'active',
            sessionId: 'ses-test-123',
          },
        },
      });
    });

    expect(screen.getByText(/Turbo WS/i)).toBeInTheDocument();
  });

  it('stops touch and click event propagation on the mobile floating dock', async () => {
    await act(async () => {
      render(<RemoteControlModal {...defaultProps} />);
    });

    const connectBtn = screen.getByRole('button', { name: /Conectar NexusDesk/i });
    await act(async () => {
      fireEvent.click(connectBtn);
    });

    const dockToggle = screen.getByTitle(/Recolher dock mobile/i);
    expect(dockToggle).toBeInTheDocument();

    const touchEvent = new Event('touchstart', { bubbles: true });
    const spy = vi.spyOn(touchEvent, 'stopPropagation');
    dockToggle.dispatchEvent(touchEvent);
    expect(spy).toHaveBeenCalled();
  });

  it('synchronizes isFullscreen state on fullscreenchange document events', async () => {
    await act(async () => {
      render(<RemoteControlModal {...defaultProps} />);
    });
    
    // Simula navegador entrando em tela cheia
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.createElement('div'),
    });
    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(screen.getByTitle(/Alternar Tela Cheia/i)).toBeInTheDocument();

    // Simula saída de tela cheia pelo usuário
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });
    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
  });
});

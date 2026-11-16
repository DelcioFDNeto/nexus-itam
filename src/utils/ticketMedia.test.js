import { describe, expect, it } from 'vitest';
import {
  compressImageFile,
  extractClipboardImages,
  formatAttachmentBytes,
  isSupportStaffRole,
  isSupportedRasterImage,
  processTicketImageFiles,
} from './ticketMedia';

describe('ticketMedia utilities', () => {
  it('identifica corretamente todos os perfis da equipe técnica de TI', () => {
    expect(isSupportStaffRole('owner')).toBe(true);
    expect(isSupportStaffRole('admin')).toBe(true);
    expect(isSupportStaffRole('manager')).toBe(true);
    expect(isSupportStaffRole('operator')).toBe(true);
    expect(isSupportStaffRole('ADMIN')).toBe(true);
    expect(isSupportStaffRole('collaborator')).toBe(false);
    expect(isSupportStaffRole('')).toBe(false);
  });

  it('valida extensões e MIME types raster e rejeita SVG', () => {
    expect(isSupportedRasterImage({ type: 'image/png', name: 'print.png' })).toBe(true);
    expect(isSupportedRasterImage({ type: 'image/jpeg', name: 'foto.jpg' })).toBe(true);
    expect(isSupportedRasterImage({ type: 'image/webp', name: 'captura.webp' })).toBe(true);
    expect(isSupportedRasterImage({ type: 'image/gif', name: 'anim.gif' })).toBe(true);
    expect(isSupportedRasterImage({ type: 'image/svg+xml', name: 'xss.svg' })).toBe(false);
    expect(isSupportedRasterImage({ type: '', name: 'payload.svg' })).toBe(false);
  });

  it('formata tamanhos de anexo em B, KB e MB', () => {
    expect(formatAttachmentBytes(512)).toBe('512 B');
    expect(formatAttachmentBytes(14_500)).toBe('14 KB');
    expect(formatAttachmentBytes(1_572_864)).toBe('1.5 MB');
  });

  it('comprime/processa arquivo raster válido respeitando o limite de 4 imagens', async () => {
    const tinyPngBytes = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
      (c) => c.charCodeAt(0),
    );
    const pngFile = new File([tinyPngBytes], 'erro-vpn.png', { type: 'image/png' });
    const compressed = await compressImageFile(pngFile);

    expect(compressed.dataUrl).toMatch(/^data:image\/(png|jpeg);base64,/);
    expect(compressed.name).toContain('erro-vpn');

    const svgFile = new File(['<svg></svg>'], 'bad.svg', { type: 'image/svg+xml' });
    const batch = await processTicketImageFiles(
      [pngFile, pngFile, pngFile, svgFile, pngFile, pngFile],
      [],
      4,
    );
    expect(batch.added.length).toBeLessThanOrEqual(4);
    expect(batch.errors.length).toBeGreaterThan(0);
  });

  it('extrai prints colados via Ctrl+V da área de transferência', () => {
    const mockFile = new File(['abc'], 'image.png', { type: 'image/png' });
    const fakeClipboard = {
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => mockFile },
      ],
    };
    const extracted = extractClipboardImages(fakeClipboard);
    expect(extracted).toHaveLength(1);
    expect(extracted[0].type).toBe('image/png');
  });
});

import { describe, expect, it } from 'vitest';
import { parseDriveLink } from './attachments';
import { addDays, formatDate, isWeekend, revisionLabel } from './format';
import { richDocMentions, richDocToText, sanitizeRichDoc, type RichNode } from './richtext';
import { createUserSchema, passwordSchema } from './schemas';

describe('links do Google Drive (RF-9.2)', () => {
  it('aceita Drive e Docs e identifica o tipo', () => {
    expect(parseDriveLink('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMn/edit')).toMatchObject({
      kind: 'spreadsheet',
      driveFileId: '1AbCdEfGhIjKlMn',
    });
    expect(parseDriveLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn')?.kind).toBe('folder');
  });

  it('recusa outros domínios, http e URLs disfarçadas', () => {
    expect(parseDriveLink('https://dropbox.com/s/abc')).toBeNull();
    expect(parseDriveLink('http://drive.google.com/file/d/1AbCdEfGhIjKlMn')).toBeNull();
    expect(parseDriveLink('https://drive.google.com.evil.com/file/d/x')).toBeNull();
    expect(parseDriveLink('javascript:alert(1)')).toBeNull();
  });
});

describe('texto rico (RNF-03)', () => {
  const doc: RichNode = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Olá ' },
          { type: 'mention', attrs: { id: 'u1', label: 'Ana', onclick: 'x' } },
          { type: 'text', text: ' veja', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          { type: 'text', text: ' aqui', marks: [{ type: 'link', attrs: { href: 'https://unimais.edu.br' } }, { type: 'bold' }] },
        ],
      },
      { type: 'script', content: [{ type: 'text', text: 'mal' }] },
    ],
  };

  it('remove nós desconhecidos, atributos extras e links perigosos', () => {
    const clean = sanitizeRichDoc(doc);
    const json = JSON.stringify(clean);
    expect(json).not.toContain('script');
    expect(json).not.toContain('javascript');
    expect(json).not.toContain('onclick');
    expect(json).toContain('https://unimais.edu.br');
  });

  it('extrai texto e menções', () => {
    expect(richDocToText(doc)).toContain('Olá @Ana veja aqui');
    expect(richDocMentions(doc)).toEqual(['u1']);
  });
});

describe('formatos e validações', () => {
  it('data pura não sofre fuso', () => {
    expect(formatDate('2026-10-28')).toBe('28/10/2026');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isWeekend('2026-10-31')).toBe(true);
    expect(isWeekend('2026-10-28')).toBe(false);
  });

  it('rótulo de revisão (RF-7.7)', () => {
    expect(revisionLabel(0)).toBeNull();
    expect(revisionLabel(1)).toBe('2ª revisão');
  });

  it('senha com 8+ caracteres, letras e números (RF-3.5)', () => {
    expect(passwordSchema.safeParse('abcdefgh').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
    expect(passwordSchema.safeParse('abc12345').success).toBe(true);
  });

  it('usuário precisa de departamento e normaliza o e-mail', () => {
    const parsed = createUserSchema.safeParse({
      name: 'Ana',
      email: ' Ana@UniMais.edu.br ',
      role: 'colaborador',
      departments: [{ departmentId: '6f1d6f2a-1f0e-4b7a-9a52-1c2d3e4f5a6b' }],
    });
    expect(parsed.success && parsed.data.email).toBe('ana@unimais.edu.br');
    expect(createUserSchema.safeParse({ name: 'Ana', email: 'a@b.co', role: 'colaborador', departments: [] }).success).toBe(false);
  });
});

// Anexos são links do Google Drive (seção 9): o sistema guarda só o link e metadados.

const GOOGLE_HOSTS = new Set(['drive.google.com', 'docs.google.com']);

export type DriveFileKind = 'document' | 'spreadsheet' | 'presentation' | 'form' | 'folder' | 'file' | 'image';

export interface ParsedDriveLink {
  url: string;
  driveFileId: string | null;
  kind: DriveFileKind;
}

/** RF-9.2: só aceita drive.google.com e docs.google.com, via https. */
export function parseDriveLink(raw: string): ParsedDriveLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !GOOGLE_HOSTS.has(url.hostname)) return null;

  const path = url.pathname;
  const idFromPath = /\/d\/([A-Za-z0-9_-]{10,})/.exec(path)?.[1];
  const idFromFolder = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(path)?.[1];
  const idFromQuery = url.searchParams.get('id');

  let kind: DriveFileKind = 'file';
  if (url.hostname === 'docs.google.com') {
    if (path.startsWith('/document')) kind = 'document';
    else if (path.startsWith('/spreadsheets')) kind = 'spreadsheet';
    else if (path.startsWith('/presentation')) kind = 'presentation';
    else if (path.startsWith('/forms')) kind = 'form';
  } else if (idFromFolder) {
    kind = 'folder';
  }

  return {
    url: url.toString(),
    driveFileId: idFromPath ?? idFromFolder ?? idFromQuery ?? null,
    kind,
  };
}

export const DRIVE_KIND_LABELS: Record<DriveFileKind, string> = {
  document: 'Documento',
  spreadsheet: 'Planilha',
  presentation: 'Apresentação',
  form: 'Formulário',
  folder: 'Pasta',
  file: 'Arquivo',
  image: 'Imagem',
};

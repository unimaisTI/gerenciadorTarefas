import { UPLOAD_MAX_BYTES, UPLOAD_MIME_TYPES, apiErrorSchema, type UploadedFileDto } from '@hub/shared';
import { ApiRequestError } from './api';

export function isUploadableImage(file: File): boolean {
  return (UPLOAD_MIME_TYPES as readonly string[]).includes(file.type);
}

/** Envia uma imagem (print colado ou escolhido) para a tarefa. O servidor confere o tipo real. */
export async function uploadImage(taskId: string, file: File, attach = false): Promise<UploadedFileDto> {
  if (!isUploadableImage(file)) {
    throw new ApiRequestError(422, 'invalid_type', 'Formato não aceito. Use PNG, JPG, GIF ou WEBP.');
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    throw new ApiRequestError(413, 'too_large', 'A imagem pode ter até 5 MB.');
  }
  const name = file.name && file.name !== 'image.png' ? file.name : `print-${new Date().toISOString().slice(0, 19)}.png`;
  const params = new URLSearchParams({ taskId, name, ...(attach && { attach: 'true' }) });
  const res = await fetch(`/api/files?${params.toString()}`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'hub', 'Content-Type': file.type },
    credentials: 'same-origin',
    body: file,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(data);
    throw new ApiRequestError(res.status, parsed.success ? parsed.data.error.code : 'unknown', parsed.success ? parsed.data.error.message : 'Falha ao enviar a imagem.');
  }
  return data as UploadedFileDto;
}

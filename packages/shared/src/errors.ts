import { z } from 'zod';

// Formato único de erro da API: { error: { code, message } }, com message em PT-BR.
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

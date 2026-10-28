import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { translatePgError } from '@hub/db';
import type { ApiError } from '@hub/shared';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const forbidden = (message = 'Você não tem permissão para esta ação.') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Não encontrado.') => new HttpError(404, 'not_found', message);
export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);
export const unprocessable = (message: string) => new HttpError(422, 'rule_violation', message);

function send(reply: FastifyReply, status: number, code: string, message: string) {
  const body: ApiError = { error: { code, message } };
  return reply.status(status).send(body);
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    const first = error.validation[0];
    return send(reply, 400, 'validation_error', first?.message ?? 'Dados inválidos. Confira os campos.');
  }
  if (error instanceof HttpError) {
    return send(reply, error.statusCode, error.code, error.message);
  }
  const pg = translatePgError(error);
  if (pg) {
    if (pg.status >= 500) request.log.error(error);
    return send(reply, pg.status, pg.code, pg.message);
  }
  if (error.statusCode && error.statusCode < 500) {
    return send(reply, error.statusCode, error.code, error.message);
  }
  request.log.error(error);
  return send(reply, 500, 'internal_error', 'Erro inesperado. Tente novamente.');
}

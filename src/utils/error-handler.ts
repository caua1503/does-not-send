import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export interface ErrorResponse {
  error: string;
  statusCode: number;
}

export function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  const statusCode = error.statusCode ?? 500;

  const response: ErrorResponse = {
    error: statusCode >= 500 ? "Internal Server Error" : error.message,
    statusCode,
  };

  // Log full error server-side, send safe response to client
  reply.log.error({ err: error, statusCode }, "Request error");

  void reply.status(statusCode).send(response);
}

import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { DomainError, setCorrelationUserId } from "@aforo/common";
import type { FastifyRequest } from "fastify";
import { isUserId } from "./queue.service";

/**
 * The buyer id the Gateway forwards in `X-User-Id` (its JWT `sub`). The queue trusts it and never
 * decodes a token (services.md). It is the sorted-set member, so a missing or malformed value is a
 * 401 rather than a member nobody can find again.
 */
export const UserId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const raw = context.switchToHttp().getRequest<FastifyRequest>().headers["x-user-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!isUserId(value)) throw new DomainError("UNAUTHENTICATED");
  setCorrelationUserId(value);
  return value;
});

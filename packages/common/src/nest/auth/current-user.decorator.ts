import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { setCorrelationUserId } from "../../core/correlation/correlation-context";
import { DomainError } from "../../core/errors/domain-error";

export interface AuthenticatedUser {
  userId: string;
  email: string;
}

type Headers = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined =>
  (Array.isArray(value) ? value[0] : value)?.trim() || undefined;

/**
 * The buyer the Gateway validated, from X-User-Id / X-User-Email. Services never check the session
 * token again (contracts/conventions.md, "User identity"); only the Gateway can invoke them.
 */
export function currentUserFrom(headers: Headers): AuthenticatedUser {
  const userId = first(headers["x-user-id"]);
  if (!userId) throw new DomainError("UNAUTHENTICATED", "X-User-Id is missing");
  setCorrelationUserId(userId);
  return { userId, email: first(headers["x-user-email"]) ?? "" };
}

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthenticatedUser =>
  currentUserFrom(context.switchToHttp().getRequest<{ headers: Headers }>().headers),
);

import { ParseUUIDPipe, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { DomainError } from '../common';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Required `Idempotency-Key` header (UUID v4); anything else is a 422 VALIDATION_ERROR. */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const value = ctx.switchToHttp().getRequest().headers['idempotency-key'];
  if (typeof value !== 'string' || !UUID_V4.test(value)) {
    throw new DomainError('VALIDATION_ERROR', 'Idempotency-Key header must be a UUID v4');
  }
  return value;
});

export const uuidParam = () =>
  new ParseUUIDPipe({
    version: '4',
    exceptionFactory: () => new DomainError('VALIDATION_ERROR', 'Path parameter must be a UUID v4'),
  });

export function parsePage(page: string | undefined, size: string | undefined): { page: number; size: number } {
  const p = page === undefined ? 0 : Number(page);
  const s = size === undefined ? 20 : Number(size);
  if (!Number.isInteger(p) || p < 0) throw new DomainError('VALIDATION_ERROR', 'page must be an integer >= 0');
  if (!Number.isInteger(s) || s < 1 || s > 100) throw new DomainError('VALIDATION_ERROR', 'size must be an integer between 1 and 100');
  return { page: p, size: s };
}

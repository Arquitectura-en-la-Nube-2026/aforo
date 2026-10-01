import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../common';
import { APP_CONFIG, AppConfig } from '../config/config';

/** `X-Signature: sha256=<hex HMAC of the raw body>`, compared in constant time. */
export function verifySignature(rawBody: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!rawBody || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!verifySignature(req.rawBody, req.headers['x-signature'], this.config.webhookSecret)) {
      throw new DomainError('INVALID_SIGNATURE', 'Webhook signature does not match the request body');
    }
    return true;
  }
}

// Intended real path: server/src/adapters/webhooks/hmac-verifier.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookVerifier {
  verify(payload: string, signatureHeader: string | undefined): boolean;
}

export class HmacWebhookVerifier implements WebhookVerifier {
  constructor(private secret: string) {}

  verify(payload: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = createHmac('sha256', this.secret).update(payload).digest('hex');
    const provided = signatureHeader.replace('sha256=', '');
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

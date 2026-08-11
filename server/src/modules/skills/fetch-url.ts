import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ValidationError, ExternalServiceError } from '../../platform/errors.js';

const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

/** True for loopback/private/link-local IPv4/IPv6 ranges. */
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts as [number, number];
    if (a === 127 || a === 10 || a === 0) return true; // loopback / 10.0.0.0/8 / this-network
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local
    return false;
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

/**
 * Server-side fetch of a skill-import URL, hardened against SSRF: https-only,
 * resolves DNS and rejects private/loopback/link-local targets (checked on
 * every hop, not just the first), caps redirects and response size. Used only
 * by the import-from-URL preview — nothing here persists anything.
 */
export async function fetchUrlSafely(url: string): Promise<Buffer> {
  let target = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const parsed = new URL(target);
    if (parsed.protocol !== 'https:') {
      throw new ValidationError('Only https:// URLs are allowed');
    }

    let address: string;
    try {
      address = (await lookup(parsed.hostname)).address;
    } catch {
      throw new ValidationError('Could not resolve host');
    }
    if (isPrivateIp(address)) {
      throw new ValidationError('URL resolves to a private/internal address');
    }

    let res: Response;
    try {
      res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new ExternalServiceError(`Could not fetch URL: ${(err as Error).message}`);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new ExternalServiceError('Redirect with no Location header');
      target = new URL(location, target).toString();
      continue;
    }
    if (!res.ok) throw new ExternalServiceError(`Fetch failed with status ${res.status}`);

    const contentLength = res.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_BYTES) {
      throw new ValidationError('Response is too large (max 256KB)');
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new ValidationError('Response is too large (max 256KB)');
    return buf;
  }
  throw new ValidationError('Too many redirects');
}

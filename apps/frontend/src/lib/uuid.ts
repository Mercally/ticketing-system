/**
 * crypto.randomUUID() is gated behind isSecureContext (https vs http, and a hostname the browser
 * recognizes as "localhost"-equivalent — a subdomain like *.s3-website.localhost.localstack.cloud
 * numerically resolves to 127.0.0.1 but does NOT qualify, since Chromium's check is on the origin
 * string ending in ".localhost", not the resolved IP). crypto.getRandomValues() has no such
 * restriction, so build a UUID v4 from it manually as a fallback rather than degrading to
 * Math.random() (which would be a real weakening, not just a compatibility shim).
 */
export function generateUuid(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

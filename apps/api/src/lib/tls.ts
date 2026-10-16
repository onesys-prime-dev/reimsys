import fs from 'node:fs';

/**
 * Https is optional. It turns on when TLS_CERT and TLS_KEY point at a certificate and its key (the phone script makes a
 * self-signed one so a phone on the same Wi-Fi gets a secure page, which browsers require before they open the camera).
 * In a real deployment https is normally done by the web server in front (see DEPLOY.md), and these stay empty.
 */
export function tlsOptions(env: { TLS_CERT?: string; TLS_KEY?: string }): { cert: Buffer; key: Buffer } | null {
  const cert = env.TLS_CERT?.trim(), key = env.TLS_KEY?.trim();
  if (!cert && !key) return null;
  if (!cert || !key) throw new Error('Set both TLS_CERT and TLS_KEY to use https, or neither to use plain http.');
  try {
    return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
  } catch {
    throw new Error(`Could not read the https certificate (${cert}) or its key (${key}).`);
  }
}

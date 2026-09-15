/**
 * Which endpoints the relay is allowed to send to.
 *
 * The relay makes server-side requests to a URL supplied by whoever is using the
 * page. Unrestricted, a public deployment is an open proxy: anyone can make it
 * POST arbitrary JSON to any host on the internet from this deployment's IP
 * addresses -- and it did, confirmed against production before this module
 * existed. It exists to exercise one API, so it sends to that API only.
 *
 * Server-only: reads non-public environment variables.
 */

import { DEFAULT_TARGET_URL } from './endpoints';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * `ALLOWED_TARGET_HOSTS` (comma-separated hostnames) replaces the default
 * entirely. Without it, the relay allows the default API's host, plus the
 * loopback hosts outside production so a local sender can drive a local API.
 * Loopback is excluded in production: on a deployment it can only reach the
 * function's own environment, which a public relay has no business probing.
 */
export function allowedTargetHosts(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.ALLOWED_TARGET_HOSTS?.split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
  if (configured && configured.length > 0) return configured;

  const hosts = [new URL(DEFAULT_TARGET_URL).hostname.toLowerCase()];
  if (env.NODE_ENV !== 'production') hosts.push(...LOCAL_HOSTS);
  return hosts;
}

export type TargetCheck = { ok: true; url: URL } | { ok: false; status: 400 | 403; reason: string };

export function checkTarget(raw: string, allowedHosts: string[]): TargetCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, status: 400, reason: 'Target URL must be a valid absolute URL.' };
  }

  const host = url.hostname.toLowerCase();

  // Plain HTTP would send the API key in clear text; it is tolerated only on loopback.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(host))) {
    return { ok: false, status: 400, reason: 'Target URL must use https (http is accepted only for localhost).' };
  }

  if (url.username || url.password) {
    return { ok: false, status: 400, reason: 'Target URL must not embed credentials.' };
  }

  if (!allowedHosts.includes(host)) {
    return {
      ok: false,
      status: 403,
      reason: `This relay only sends to ${allowedHosts.join(', ')}. "${host}" is not an allowed target.`,
    };
  }

  return { ok: true, url };
}

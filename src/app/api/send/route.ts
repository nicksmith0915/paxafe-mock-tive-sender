/**
 * POST /api/send -- server-side relay to the Integration API.
 *
 * Why a relay instead of posting from the browser:
 *
 *  1. A cross-origin POST carrying `X-API-Key` triggers a CORS preflight, and
 *     the Integration API deliberately does not implement CORS -- it is a
 *     server-to-server webhook receiver, and opening it to browser origins
 *     would be a security decision made for the convenience of a test tool.
 *  2. It keeps the API key out of cross-origin browser traffic.
 *  3. It mirrors what a real Tive backend does: server to server.
 *
 * The relay adds nothing to the request beyond the API key. What the Integration
 * API receives is exactly what the UI displays, which is the point of a test
 * harness -- if the relay reshaped payloads, results here would not be evidence
 * about the receiver.
 */

import { z } from 'zod';

import { allowedTargetHosts, checkTarget } from '@/lib/target';

/** Bounded so a mistyped burst cannot turn this into a load generator. */
const MAX_PAYLOADS_PER_REQUEST = 50;
const PER_REQUEST_TIMEOUT_MS = 15_000;

export const maxDuration = 60;

const SendRequestSchema = z.object({
  // Shape only; which URLs are acceptable is decided by checkTarget below.
  targetUrl: z.string().min(1, 'A target URL is required.'),
  apiKey: z.string().min(1, 'An API key is required.'),
  payloads: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, 'At least one payload is required.')
    .max(MAX_PAYLOADS_PER_REQUEST, `At most ${MAX_PAYLOADS_PER_REQUEST} payloads per request.`),
  /** Pause between sends, to imitate a real reporting interval. */
  delayMs: z.number().int().min(0).max(5000).default(0),
});

export interface SendResult {
  index: number;
  ok: boolean;
  status: number | null;
  durationMs: number;
  requestId: string | null;
  body: unknown;
  error: string | null;
}

export async function POST(request: Request): Promise<Response> {
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return Response.json({ error: 'Request body is not valid JSON.' }, { status: 400 });
  }

  const parsed = SendRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return Response.json(
      {
        error: 'Invalid send request.',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.map(String).join('.'),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const { targetUrl, apiKey, payloads, delayMs } = parsed.data;

  // Before any request leaves: the relay sends only to the Integration API.
  const target = checkTarget(targetUrl, allowedTargetHosts());
  if (!target.ok) {
    return Response.json({ error: target.reason }, { status: target.status });
  }
  const results: SendResult[] = [];

  // Sequential rather than parallel: the point is to imitate a device
  // reporting on an interval, and ordered results are far easier to read.
  for (const [index, payload] of payloads.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    results.push(await sendOne(targetUrl, apiKey, payload, index));
  }

  return Response.json({
    results,
    summary: {
      total: results.length,
      accepted: results.filter((r) => r.ok).length,
      rejected: results.filter((r) => !r.ok && r.status !== null).length,
      failed: results.filter((r) => r.status === null).length,
    },
  });
}

async function sendOne(
  targetUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
  index: number,
): Promise<SendResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
      // Following a redirect would send the payload -- and the API key -- to
      // whatever host an allowed target points at, bypassing the allowlist.
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        index,
        ok: false,
        status: response.status,
        durationMs: Date.now() - startedAt,
        requestId: response.headers.get('x-request-id'),
        body: null,
        error: `Target redirected to ${response.headers.get('location') ?? 'another location'}; the relay does not follow redirects.`,
      };
    }

    // The receiver answers with JSON for success and problem+json for errors,
    // but a misconfigured URL could return anything -- so fall back to text.
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep the raw text: seeing an HTML error page is diagnostic in itself */
    }

    return {
      index,
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      requestId: response.headers.get('x-request-id'),
      body,
      error: null,
    };
  } catch (error) {
    // Network failure, DNS failure, or our own timeout: no HTTP status exists.
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      index,
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      requestId: null,
      body: null,
      error: aborted
        ? `No response within ${PER_REQUEST_TIMEOUT_MS / 1000}s.`
        : error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The Integration API this sender targets by default. Client-safe: imported by
 * the console to prefill the endpoint field, and by the relay to derive which
 * host it may send to.
 *
 * Override with NEXT_PUBLIC_DEFAULT_TARGET_URL when running against a local API.
 */
export const DEFAULT_TARGET_URL =
  process.env.NEXT_PUBLIC_DEFAULT_TARGET_URL ??
  'https://paxafe-integration-api-five.vercel.app/api/webhook/tive';

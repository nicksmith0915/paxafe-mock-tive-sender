# Mock Tive Sender

Generates Tive telemetry payloads and posts them to the
[PAXAFE Integration API](https://github.com/nicksmith0915/paxafe-integration-api), then shows exactly what came back.

Built for the Senior Integration Engineer take-home.

**Live:** https://paxafe-mock-tive-sender-lilac.vercel.app

It opens already pointed at the deployed Integration API. Paste the test key from
the submission email, pick a scenario, and send. Both the endpoint and the key are
editable and remembered in `localStorage`.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:3001
```

Set the Integration API endpoint and API key in the UI. Both are remembered in
`localStorage`, so they survive a reload.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server on port 3001 |
| `npm run verify` | Typecheck, lint and test |
| `npm test` | Generator tests |
| `npm run build` | Production build |

Port 3001 is the default so the sender and the Integration API can run side by
side locally without a collision.

---

## What it does

**Provided fixtures.** Every payload from `sample-tive-payloads.json` — the four
valid ones and all six invalid ones — as a one-click scenario, each labelled with
the response it should produce. The invalid fixtures are included deliberately: a
sender that can only produce well-formed payloads cannot demonstrate that the
receiver rejects malformed ones correctly, which is most of what "handles edge
cases" means.

The valid fixtures are re-stamped to the current time before sending, because
they are dated February 2025 and would otherwise be rejected by the receiver's
ingestion window. The two timestamp fixtures keep their original values — being
out of window is the entire point of them.

**Simulated shipment.** A generated sequence of readings with moving
coordinates, draining battery and drifting temperature. Three profiles:

| Profile | What it exercises |
|---|---|
| Nominal cold chain | Steady 2–8 °C telemetry along a route |
| Temperature excursion | A deliberate excursion partway through |
| Failing device | Battery draining toward empty, signal degrading |

Location method (GPS / WiFi / Cellular) is selectable, and each reports a
realistic accuracy radius — which is what drives the receiver's derived
`location_accuracy_category`.

**Editable payloads.** Any scenario can be edited as raw JSON before sending, so
a specific field can be broken on purpose. Edits are kept per scenario.

**Idempotency check.** *Send twice* posts the identical payload twice. A correct
receiver stores it once and answers `201` then `200 duplicate`.

---

## Design notes

### Requests are relayed server-side

The browser posts to this app's own `/api/send`, which forwards to the
Integration API. It does not post to the Integration API directly.

1. A cross-origin POST carrying `X-API-Key` triggers a CORS preflight, and the
   Integration API deliberately does not implement CORS. It is a server-to-server
   webhook receiver; opening it to browser origins would be a security decision
   made for the convenience of a test tool.
2. It keeps the API key out of cross-origin browser traffic.
3. It mirrors what a real Tive backend does: server to server.

The relay adds nothing but the API key — what the receiver gets is exactly what
the UI shows. If the relay reshaped payloads, the results would not be evidence
about the receiver.

### The generator is pure and seeded

`src/lib/generator.ts` has no I/O and takes a seed, so the same seed produces the
same shipment every time. A failing send can be reproduced exactly, and the
generator is unit tested rather than eyeballed.

Timestamps are floored to whole seconds: Tive reports second-resolution epochs —
every timestamp in the provided samples ends in `000` — and `EntryTimeUtc` is an
ISO string with no milliseconds, so keeping sub-second precision would make the
two fields contradict each other.

### Results distinguish three outcomes

| Outcome | Meaning |
|---|---|
| **Accepted** | 2xx. Shows `stored` or `duplicate`, plus any data-quality flags the receiver reported |
| **Rejected** | 4xx. Shows the receiver's error code and the first offending field path |
| **Unreachable** | No HTTP response at all — wrong URL, DNS failure, or timeout |

The third column matters: a rejection means the receiver is working, while an
unreachable target means the test itself never ran. Collapsing them into
"failed" would hide the difference.

Sends are sequential rather than parallel, to imitate a device reporting on an
interval and to keep results readable. A request is capped at 50 payloads so a
mistyped burst cannot turn this into a load generator.

---

## Testing

```bash
npm test
```

The generator's output is validated against the **provided**
`tive-incoming-schema.json` with ajv, not against our own assumptions about it.
If the generator produced payloads the receiver would reject for the wrong
reason, every result shown in the UI would be misleading — so that is the
property worth pinning down. The tests also cover determinism, timestamp
spacing, coordinate ranges and per-profile behaviour.

---

## Deployment

Vercel. No environment variables are required: the endpoint and API key are
entered in the UI, so one deployment can target any Integration API instance.

That is a deliberate trade-off for a test tool. A production sender would hold
its credential server-side rather than accepting it from the browser.

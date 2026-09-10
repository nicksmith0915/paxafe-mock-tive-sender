'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SendResult } from '@/app/api/send/route';
import {
  fixtureScenarios,
  generatedScenario,
  LOCATION_METHODS,
  PROFILES,
  type Scenario,
} from '@/lib/scenarios';
import type { LocationMethod, ShipmentProfile } from '@/lib/generator';

const STORAGE_KEY = 'px-mock-sender-config';

/**
 * Endpoint the console starts on. It points at the deployed Integration API so
 * the hosted sender works on first load -- a reviewer opening it should not be
 * met with a localhost URL that cannot possibly respond. Override with
 * NEXT_PUBLIC_DEFAULT_TARGET_URL when running against a local API, or just edit
 * the field, which is what it is there for.
 */
const DEFAULT_TARGET_URL =
  process.env.NEXT_PUBLIC_DEFAULT_TARGET_URL ??
  'https://paxafe-integration-api-five.vercel.app/api/webhook/tive';

interface StoredConfig {
  targetUrl: string;
  apiKey: string;
}

interface SendSummary {
  total: number;
  accepted: number;
  rejected: number;
  failed: number;
}

type Mode = 'fixtures' | 'simulate';

function loadConfig(): StoredConfig {
  const fallback: StoredConfig = {
    targetUrl: DEFAULT_TARGET_URL,
    apiKey: '',
  };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<StoredConfig>;
    return {
      targetUrl: parsed.targetUrl || fallback.targetUrl,
      apiKey: parsed.apiKey || fallback.apiKey,
    };
  } catch {
    // Corrupt JSON, or storage unavailable in private mode.
    return fallback;
  }
}

export default function SenderConsole() {
  // Initialised directly from storage. This component is rendered client-only
  // (see SenderConsoleLoader), so reading localStorage during the first render
  // is safe and avoids syncing state in an effect.
  const [targetUrl, setTargetUrl] = useState(() => loadConfig().targetUrl);
  const [apiKey, setApiKey] = useState(() => loadConfig().apiKey);
  const [mode, setMode] = useState<Mode>('fixtures');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftError, setDraftError] = useState<string | null>(null);

  const [seed, setSeed] = useState(1);
  const [count, setCount] = useState(5);
  const [intervalMinutes, setIntervalMinutes] = useState(15);
  const [profile, setProfile] = useState<ShipmentProfile>('nominal');
  const [locationMethod, setLocationMethod] = useState<LocationMethod>('gps');

  const [results, setResults] = useState<SendResult[]>([]);
  const [summary, setSummary] = useState<SendSummary | null>(null);
  const [sending, setSending] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ targetUrl, apiKey }));
    } catch {
      /* private mode, or storage disabled */
    }
  }, [targetUrl, apiKey]);

  const fixtures = useMemo(() => fixtureScenarios(), []);

  const generated = useMemo(
    () => generatedScenario({ seed, count, intervalMinutes, profile, locationMethod }),
    [seed, count, intervalMinutes, profile, locationMethod],
  );

  const scenarios = mode === 'fixtures' ? fixtures : generated;

  const selected = useMemo(
    () => scenarios.find((s) => s.id === selectedId) ?? scenarios[0],
    [scenarios, selectedId],
  );

  /**
   * The editor shows the selected scenario's payload until it is edited, after
   * which the edit is remembered per scenario. Deriving this during render
   * rather than synchronising it in an effect avoids a cascading re-render and
   * keeps edits intact when switching between scenarios.
   */
  const draft = selected ? (drafts[selected.id] ?? JSON.stringify(selected.payload, null, 2)) : '';

  const setDraft = useCallback(
    (value: string) => {
      if (!selected) return;
      setDrafts((current) => ({ ...current, [selected.id]: value }));
    },
    [selected],
  );

  const send = useCallback(
    async (payloads: Record<string, unknown>[], delayMs = 0) => {
      setSending(true);
      setTransportError(null);
      setResults([]);
      setSummary(null);

      try {
        const response = await fetch('/api/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetUrl, apiKey, payloads, delayMs }),
        });
        const body = await response.json();

        if (!response.ok) {
          setTransportError(
            body.issues?.map((i: { message: string }) => i.message).join(' ') ??
              body.error ??
              'The relay rejected this request.',
          );
          return;
        }
        setResults(body.results);
        setSummary(body.summary);
      } catch (error) {
        setTransportError(error instanceof Error ? error.message : String(error));
      } finally {
        setSending(false);
      }
    },
    [targetUrl, apiKey],
  );

  const sendDraft = useCallback(() => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(draft);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : 'Payload is not valid JSON.');
      return;
    }
    setDraftError(null);
    void send([payload]);
  }, [draft, send]);

  const sendShipment = useCallback(() => {
    void send(
      generated.map((scenario) => scenario.payload),
      120,
    );
  }, [generated, send]);

  const replayDraft = useCallback(() => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(draft);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : 'Payload is not valid JSON.');
      return;
    }
    setDraftError(null);
    // The same payload twice: the second must come back as a duplicate.
    void send([payload, payload]);
  }, [draft, send]);

  const canSend = Boolean(targetUrl && apiKey) && !sending;

  return (
    <div className="console">
      <section className="panel">
        <h2>Target</h2>
        <div className="field-row">
          <label className="field">
            <span>Integration API endpoint</span>
            <input
              type="url"
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              placeholder="https://your-api.vercel.app/api/webhook/tive"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="px_test_..."
              spellCheck={false}
            />
          </label>
        </div>
        {!apiKey && <p className="hint">An API key is required before sending.</p>}
      </section>

      <section className="panel">
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'fixtures'}
            className={mode === 'fixtures' ? 'tab active' : 'tab'}
            onClick={() => {
              setMode('fixtures');
              setSelectedId(null);
            }}
          >
            Provided fixtures
          </button>
          <button
            role="tab"
            aria-selected={mode === 'simulate'}
            className={mode === 'simulate' ? 'tab active' : 'tab'}
            onClick={() => {
              setMode('simulate');
              setSelectedId(null);
            }}
          >
            Simulated shipment
          </button>
        </div>

        {mode === 'simulate' && (
          <div className="field-row controls">
            <label className="field">
              <span>Profile</span>
              <select
                value={profile}
                onChange={(event) => setProfile(event.target.value as ShipmentProfile)}
              >
                {PROFILES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Location method</span>
              <select
                value={locationMethod}
                onChange={(event) => setLocationMethod(event.target.value as LocationMethod)}
              >
                {LOCATION_METHODS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field narrow">
              <span>Readings</span>
              <input
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(event) => setCount(clamp(Number(event.target.value), 1, 50))}
              />
            </label>
            <label className="field narrow">
              <span>Interval (min)</span>
              <input
                type="number"
                min={1}
                max={240}
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(clamp(Number(event.target.value), 1, 240))}
              />
            </label>
            <label className="field narrow">
              <span>Seed</span>
              <input
                type="number"
                min={1}
                value={seed}
                onChange={(event) => setSeed(clamp(Number(event.target.value), 1, 999999))}
              />
            </label>
          </div>
        )}

        <div className="scenario-list" role="listbox" aria-label="Scenarios">
          {scenarios.map((scenario) => (
            <button
              key={scenario.id}
              role="option"
              aria-selected={selected?.id === scenario.id}
              className={selected?.id === scenario.id ? 'scenario selected' : 'scenario'}
              onClick={() => setSelectedId(scenario.id)}
            >
              <span className={`badge ${badgeClass(scenario)}`}>{badgeLabel(scenario)}</span>
              <span className="scenario-name">{scenario.name}</span>
              <span className="scenario-expectation">{scenario.expectation}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Payload</h2>
        {selected && <p className="hint">{selected.description}</p>}
        <textarea
          className={draftError ? 'editor invalid' : 'editor'}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftError(null);
          }}
          spellCheck={false}
          rows={16}
          aria-label="Payload JSON"
        />
        {draftError && <p className="error">Invalid JSON: {draftError}</p>}

        <div className="actions">
          <button className="primary" onClick={sendDraft} disabled={!canSend}>
            {sending ? 'Sending...' : 'Send payload'}
          </button>
          <button onClick={replayDraft} disabled={!canSend} title="Sends the same payload twice">
            Send twice (idempotency)
          </button>
          {mode === 'simulate' && (
            <button onClick={sendShipment} disabled={!canSend}>
              Send whole shipment ({generated.length})
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Results</h2>

        {transportError && <p className="error">{transportError}</p>}
        {!transportError && results.length === 0 && !sending && (
          <p className="hint">No requests sent yet.</p>
        )}

        {summary && (
          <div className="summary">
            <Stat label="Sent" value={summary.total} />
            <Stat label="Accepted" value={summary.accepted} tone="good" />
            <Stat label="Rejected" value={summary.rejected} tone="warn" />
            <Stat label="Unreachable" value={summary.failed} tone="bad" />
          </div>
        )}

        {results.length > 0 && (
          <table className="results">
            <thead>
              <tr>
                <th>#</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Outcome</th>
                <th>Request ID</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.index}>
                  <td>{result.index + 1}</td>
                  <td>
                    <span className={`status ${statusTone(result)}`}>{result.status ?? 'ERR'}</span>
                  </td>
                  <td>{result.durationMs} ms</td>
                  <td>{describeOutcome(result)}</td>
                  <td className="mono muted">{result.requestId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {results.length > 0 && (
          <details className="raw">
            <summary>Raw responses</summary>
            <pre>{JSON.stringify(results.map((r) => r.body), null, 2)}</pre>
          </details>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={tone ? `stat ${tone}` : 'stat'}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function badgeLabel(scenario: Scenario): string {
  if (scenario.kind === 'valid-fixture') return 'valid';
  if (scenario.kind === 'invalid-fixture') return 'invalid';
  return 'generated';
}

function badgeClass(scenario: Scenario): string {
  if (scenario.kind === 'valid-fixture') return 'good';
  if (scenario.kind === 'invalid-fixture') return 'warn';
  return 'neutral';
}

function statusTone(result: SendResult): string {
  if (result.status === null) return 'bad';
  if (result.status < 300) return 'good';
  if (result.status < 500) return 'warn';
  return 'bad';
}

/**
 * Turns a response into a one-line verdict. A rejection with the expected error
 * code is a *successful* test of the receiver, so it is described rather than
 * simply marked as a failure.
 */
function describeOutcome(result: SendResult): string {
  if (result.error) return result.error;

  const body = result.body as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return result.ok ? 'Accepted' : 'Rejected';

  if (result.ok) {
    const status = typeof body.status === 'string' ? body.status : 'processed';
    const flags = Array.isArray(body.data_quality_flags) ? body.data_quality_flags : [];
    const suffix = flags.length > 0 ? ` · flags: ${flags.join(', ')}` : '';
    return status === 'duplicate' ? `Duplicate — already stored${suffix}` : `Stored${suffix}`;
  }

  const code = typeof body.code === 'string' ? body.code : 'error';
  const errors = Array.isArray(body.errors) ? body.errors : [];
  const first = errors[0] as { path?: string } | undefined;
  return first?.path ? `${code} (${first.path})` : code;
}

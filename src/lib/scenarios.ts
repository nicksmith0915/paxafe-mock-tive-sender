/**
 * Scenario library.
 *
 * Two sources:
 *  - the fixtures shipped with the exercise, read straight from
 *    `schemas/sample-tive-payloads.json` so they stay authoritative;
 *  - generated shipments, for traffic the fixtures cannot represent.
 *
 * The invalid fixtures are included on purpose. A sender that can only produce
 * well-formed payloads cannot demonstrate that the receiver rejects bad ones
 * correctly, which is most of what "handles edge cases" means.
 */

import samples from '../../schemas/sample-tive-payloads.json';
import { generateShipment, type LocationMethod, type ShipmentProfile } from './generator';

export type ScenarioKind = 'valid-fixture' | 'invalid-fixture' | 'generated';

export interface Scenario {
  id: string;
  name: string;
  description: string;
  kind: ScenarioKind;
  /** What the receiver is expected to do. Shown in the UI next to the result. */
  expectation: string;
  payload: Record<string, unknown>;
}

interface RawSample {
  name: string;
  description: string;
  payload: Record<string, unknown>;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The shipped fixtures are dated February 2025 and will fall outside any
 * sensible ingestion window. Re-stamping them to "now" keeps them useful as
 * functional tests of the mapping; the original timestamp is what the
 * dedicated timestamp scenarios are for.
 */
function restamp(payload: Record<string, unknown>): Record<string, unknown> {
  const now = Date.now();
  return {
    ...payload,
    EntryTimeEpoch: now,
    EntryTimeUtc: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

export function fixtureScenarios(): Scenario[] {
  const valid = (samples.payloads as RawSample[]).map((sample) => ({
    id: `valid-${slug(sample.name)}`,
    name: sample.name,
    description: sample.description,
    kind: 'valid-fixture' as const,
    expectation: '201 Created',
    payload: restamp(sample.payload),
  }));

  const invalid = (samples.invalid_payloads as RawSample[]).map((sample) => {
    // The two timestamp fixtures are testing the ingestion window, so their
    // original timestamps must be preserved -- that is the whole point of them.
    const isTimestampCase = /timestamp/i.test(sample.name);
    return {
      id: `invalid-${slug(sample.name)}`,
      name: sample.name,
      description: sample.description,
      kind: 'invalid-fixture' as const,
      expectation: isTimestampCase ? '422 TIMESTAMP_OUT_OF_RANGE' : '422 SCHEMA_VALIDATION_FAILED',
      payload: isTimestampCase ? sample.payload : restamp(sample.payload),
    };
  });

  return [...valid, ...invalid];
}

export interface GeneratedScenarioOptions {
  seed: number;
  count: number;
  intervalMinutes: number;
  profile: ShipmentProfile;
  locationMethod: LocationMethod;
}

export function generatedScenario(options: GeneratedScenarioOptions): Scenario[] {
  const shipment = generateShipment({
    seed: options.seed,
    count: options.count,
    intervalMs: options.intervalMinutes * 60_000,
    profile: options.profile,
    locationMethod: options.locationMethod,
  });

  return shipment.payloads.map((payload, index) => ({
    id: `generated-${shipment.deviceImei}-${index}`,
    name: `${shipment.deviceName} reading ${index + 1}/${shipment.payloads.length}`,
    description: `${options.profile} shipment via ${options.locationMethod}`,
    kind: 'generated' as const,
    expectation: '201 Created',
    payload,
  }));
}

export const PROFILES: { value: ShipmentProfile; label: string }[] = [
  { value: 'nominal', label: 'Nominal cold chain' },
  { value: 'excursion', label: 'Temperature excursion' },
  { value: 'failing_device', label: 'Failing device' },
];

export const LOCATION_METHODS: { value: LocationMethod; label: string }[] = [
  { value: 'gps', label: 'GPS' },
  { value: 'wifi', label: 'WiFi' },
  { value: 'cell', label: 'Cellular' },
];

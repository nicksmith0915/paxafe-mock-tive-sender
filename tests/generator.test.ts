/**
 * The generator is the part of this app worth testing: if it produces payloads
 * the receiver would reject for the wrong reason, every result shown in the UI
 * is misleading. Its output is therefore validated against the *provided* Tive
 * schema, not against our own assumptions about it.
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { generateShipment } from '@/lib/generator';

const tiveSchema = JSON.parse(
  readFileSync(fileURLToPath(new URL('../schemas/tive-incoming-schema.json', import.meta.url)), 'utf8'),
);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateTive = ajv.compile(tiveSchema);

describe('schema conformance', () => {
  it('produces payloads that satisfy the provided Tive schema', () => {
    const { payloads } = generateShipment({ seed: 7, count: 10 });
    for (const payload of payloads) {
      const valid = validateTive(payload);
      expect(validateTive.errors ?? [], JSON.stringify(validateTive.errors)).toEqual([]);
      expect(valid).toBe(true);
    }
  });

  it('emits a 15-digit IMEI as DeviceId, as the schema pattern requires', () => {
    const { payloads } = generateShipment({ seed: 3, count: 3 });
    for (const payload of payloads) {
      expect(payload.DeviceId).toMatch(/^[0-9]{15}$/);
    }
  });

  it('keeps DeviceName and DeviceId distinct so the mapping is exercised', () => {
    const { payloads } = generateShipment({ seed: 5 });
    expect(payloads[0].DeviceName).not.toBe(payloads[0].DeviceId);
  });
});

describe('determinism', () => {
  it('produces identical output for the same seed', () => {
    const endAt = 1_770_000_000_000;
    const a = generateShipment({ seed: 42, count: 5, endAt });
    const b = generateShipment({ seed: 42, count: 5, endAt });
    expect(a).toEqual(b);
  });

  it('produces different output for a different seed', () => {
    const endAt = 1_770_000_000_000;
    const a = generateShipment({ seed: 1, count: 3, endAt });
    const b = generateShipment({ seed: 2, count: 3, endAt });
    expect(a.deviceImei).not.toBe(b.deviceImei);
  });
});

describe('shipment shape', () => {
  it('produces the requested number of readings', () => {
    expect(generateShipment({ count: 12 }).payloads).toHaveLength(12);
  });

  it('spaces readings by the requested interval, ending at endAt', () => {
    const endAt = 1_770_000_000_000;
    const intervalMs = 15 * 60_000;
    const { payloads } = generateShipment({ count: 4, intervalMs, endAt, seed: 9 });

    const timestamps = payloads.map((p) => p.EntryTimeEpoch as number);
    expect(timestamps[timestamps.length - 1]).toBe(endAt);
    for (let i = 1; i < timestamps.length; i += 1) {
      expect(timestamps[i] - timestamps[i - 1]).toBe(intervalMs);
    }
  });

  it('defaults to a recent timestamp so payloads land inside the ingestion window', () => {
    const { payloads } = generateShipment({ count: 1 });
    const timestamp = payloads[0].EntryTimeEpoch as number;
    expect(Math.abs(Date.now() - timestamp)).toBeLessThan(5_000);
  });

  it('keeps EntryTimeUtc consistent with EntryTimeEpoch', () => {
    const { payloads } = generateShipment({ count: 3, seed: 11 });
    for (const payload of payloads) {
      expect(Date.parse(payload.EntryTimeUtc as string)).toBe(payload.EntryTimeEpoch);
    }
  });

  it('moves the device along the route', () => {
    const { payloads } = generateShipment({ count: 8, seed: 4 });
    const first = payloads[0].Location as { Latitude: number };
    const last = payloads[payloads.length - 1].Location as { Latitude: number };
    // Default route runs south to north.
    expect(last.Latitude).toBeGreaterThan(first.Latitude);
  });

  it('stays inside valid coordinate ranges', () => {
    const { payloads } = generateShipment({ count: 20, seed: 8 });
    for (const payload of payloads) {
      const location = payload.Location as { Latitude: number; Longitude: number };
      expect(location.Latitude).toBeGreaterThanOrEqual(-90);
      expect(location.Latitude).toBeLessThanOrEqual(90);
      expect(location.Longitude).toBeGreaterThanOrEqual(-180);
      expect(location.Longitude).toBeLessThanOrEqual(180);
    }
  });
});

describe('profiles', () => {
  function temperatures(profile: 'nominal' | 'excursion' | 'failing_device') {
    return generateShipment({ count: 20, seed: 21, profile }).payloads.map(
      (p) => (p.Temperature as { Celsius: number }).Celsius,
    );
  }

  it('excursion rises above the nominal cold chain band', () => {
    expect(Math.max(...temperatures('excursion'))).toBeGreaterThan(
      Math.max(...temperatures('nominal')),
    );
  });

  it('failing_device drains the battery toward empty', () => {
    const { payloads } = generateShipment({ count: 15, seed: 6, profile: 'failing_device' });
    const battery = payloads.map((p) => (p.Battery as { Percentage: number }).Percentage);
    expect(battery[battery.length - 1]).toBeLessThan(battery[0]);
    expect(battery[battery.length - 1]).toBeGreaterThanOrEqual(1);
  });

  it('reports coarser accuracy for cell than for GPS', () => {
    const gps = generateShipment({ count: 5, seed: 2, locationMethod: 'gps' });
    const cell = generateShipment({ count: 5, seed: 2, locationMethod: 'cell' });
    const metersOf = (s: typeof gps) =>
      (s.payloads[0].Location as { Accuracy: { Meters: number } }).Accuracy.Meters;
    expect(metersOf(cell)).toBeGreaterThan(metersOf(gps));
  });

  it('keeps battery percentage an integer within 0-100', () => {
    const { payloads } = generateShipment({ count: 10, seed: 13 });
    for (const payload of payloads) {
      const percentage = (payload.Battery as { Percentage: number }).Percentage;
      expect(Number.isInteger(percentage)).toBe(true);
      expect(percentage).toBeGreaterThanOrEqual(0);
      expect(percentage).toBeLessThanOrEqual(100);
    }
  });
});

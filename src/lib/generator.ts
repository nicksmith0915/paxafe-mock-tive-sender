/**
 * Tive payload generator.
 *
 * Pure and deterministic: given a seed, the same shipment comes out every time.
 * That matters for two reasons -- a failing send can be reproduced exactly, and
 * the generator itself can be unit tested rather than eyeballed.
 *
 * The generator simulates a *shipment*, not just a payload. A single well-formed
 * payload proves very little; a sequence with moving coordinates, draining
 * battery and drifting temperature is what actually exercises an integration:
 * idempotency on replay, ordering, excursion handling and time-series storage.
 */

/** Mulberry32: small, fast, and seedable -- Math.random is none of those. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Waypoint {
  latitude: number;
  longitude: number;
  address: string;
}

export type LocationMethod = 'gps' | 'wifi' | 'cell';

export type ShipmentProfile =
  /** Stays inside the 2-8C cold chain band throughout. */
  | 'nominal'
  /** Develops a temperature excursion partway through the route. */
  | 'excursion'
  /** Battery drains to single digits; signal degrades. */
  | 'failing_device';

export interface ShipmentOptions {
  seed?: number;
  /** Number of telemetry readings to produce. */
  count?: number;
  /** Spacing between readings, in milliseconds. */
  intervalMs?: number;
  /**
   * Timestamp of the final reading. Defaults to now, so a generated shipment
   * always lands inside the receiver's ingestion window.
   */
  endAt?: number;
  profile?: ShipmentProfile;
  locationMethod?: LocationMethod;
  deviceImei?: string;
  deviceName?: string;
  origin?: Waypoint;
  destination?: Waypoint;
  carrier?: string;
  shipmentId?: string;
  accountId?: number;
}

const DEFAULT_ORIGIN: Waypoint = {
  latitude: 26.09891,
  longitude: -98.18494,
  address: '1460 E Hi Line Rd, Pharr, TX 78577, USA',
};

const DEFAULT_DESTINATION: Waypoint = {
  latitude: 40.815468,
  longitude: -73.8805,
  address: '772 Edgewater Rd, Bronx, NY 10474, USA',
};

/** Typical accuracy radius per location technology, in metres. */
const ACCURACY_BY_METHOD: Record<LocationMethod, [min: number, max: number]> = {
  gps: [3, 12],
  wifi: [15, 45],
  cell: [350, 900],
};

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** A plausible 15-digit IMEI. Not Luhn-checked; the receiver only checks shape. */
export function generateImei(random: () => number): string {
  let imei = '86';
  for (let i = 0; i < 13; i += 1) imei += Math.floor(random() * 10).toString();
  return imei;
}

export interface GeneratedShipment {
  shipmentId: string;
  deviceImei: string;
  deviceName: string;
  payloads: Record<string, unknown>[];
}

export function generateShipment(options: ShipmentOptions = {}): GeneratedShipment {
  const {
    seed = 1,
    count = 1,
    intervalMs = 15 * 60_000,
    endAt = Date.now(),
    profile = 'nominal',
    locationMethod = 'gps',
    origin = DEFAULT_ORIGIN,
    destination = DEFAULT_DESTINATION,
    carrier = 'EXCALIBUR',
    accountId = 478,
  } = options;

  const random = createRandom(seed);
  const deviceImei = options.deviceImei ?? generateImei(random);
  const deviceName = options.deviceName ?? `A${Math.floor(random() * 900000 + 100000)}`;
  const shipmentId = options.shipmentId ?? `PX-${Math.floor(random() * 90000 + 10000)}/COLD-CHAIN`;

  const payloads: Record<string, unknown>[] = [];
  let batteryLevel = profile === 'failing_device' ? 34 : 96;
  let temperature = 4.5;

  for (let index = 0; index < count; index += 1) {
    // Fraction of the route completed: 0 at the first reading, 1 at the last.
    const progress = count === 1 ? 1 : index / (count - 1);
    /**
     * Floored to whole seconds. Tive reports second-resolution epochs -- every
     * timestamp in the provided samples ends in 000 -- and EntryTimeUtc is an
     * ISO string with no milliseconds, so keeping sub-second precision here
     * would make the two fields disagree with each other.
     */
    const timestamp = Math.floor((endAt - (count - 1 - index) * intervalMs) / 1000) * 1000;

    // Linear interpolation with a little lateral wander, so successive points
    // are not suspiciously collinear.
    const wander = (random() - 0.5) * 0.05;
    const latitude = round(
      origin.latitude + (destination.latitude - origin.latitude) * progress + wander,
      6,
    );
    const longitude = round(
      origin.longitude + (destination.longitude - origin.longitude) * progress + wander,
      6,
    );

    // Temperature: small random walk, plus a deliberate excursion partway
    // through the route for the profile that asks for one.
    temperature += (random() - 0.5) * 0.4;
    if (profile === 'excursion' && progress > 0.5 && progress < 0.85) {
      temperature += 1.6;
    }
    temperature = Math.min(Math.max(temperature, -25), 30);

    batteryLevel = Math.max(1, batteryLevel - (profile === 'failing_device' ? 2 : 0.3));

    const [accuracyMin, accuracyMax] = ACCURACY_BY_METHOD[locationMethod];
    const accuracyMeters = round(accuracyMin + random() * (accuracyMax - accuracyMin), 2);

    const dbm =
      profile === 'failing_device' ? round(-112 + random() * 8, 2) : round(-95 + random() * 25, 2);

    payloads.push({
      EntityName: deviceName,
      EntryTimeEpoch: timestamp,
      EntryTimeUtc: new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Cellular: { SignalStrength: signalStrengthFor(dbm), Dbm: dbm },
      Temperature: {
        Celsius: round(temperature, 6),
        Fahrenheit: round(temperature * 1.8 + 32, 6),
      },
      ProbeTemperature: null,
      Humidity: { Percentage: round(35 + random() * 25, 6) },
      Accelerometer: buildAccelerometer(random),
      Light: { Lux: profile === 'nominal' && random() > 0.9 ? round(random() * 250, 1) : 0 },
      Battery: {
        Percentage: Math.round(batteryLevel),
        Estimation: batteryLevel < 10 ? 'Days' : batteryLevel < 40 ? 'Weeks' : 'Months',
        IsCharging: false,
      },
      Shipment: {
        Id: shipmentId,
        Description: 'Simulated cold chain shipment',
        DeviceId: deviceImei,
        ShipFrom: {
          Latitude: origin.latitude,
          Longitude: origin.longitude,
          FormattedAddress: origin.address,
        },
        ShipTo: {
          Latitude: destination.latitude,
          Longitude: destination.longitude,
          FormattedAddress: destination.address,
        },
        Carrier: carrier,
      },
      AccountId: accountId,
      DeviceId: deviceImei,
      DeviceName: deviceName,
      ShipmentId: shipmentId,
      PublicShipmentId: publicShipmentId(random),
      Location: {
        Latitude: latitude,
        Longitude: longitude,
        FormattedAddress: progress > 0.98 ? destination.address : null,
        LocationMethod: locationMethod,
        Accuracy: {
          Meters: accuracyMeters,
          Kilometers: round(accuracyMeters / 1000, 6),
          Miles: round(accuracyMeters / 1609.344, 6),
        },
        GeolocationSourceName: locationMethod === 'gps' ? 'gnss' : 'skyhook',
        CellTowerUsedCount: locationMethod === 'cell' ? 3 : 1,
        WifiAccessPointUsedCount: locationMethod === 'wifi' ? Math.floor(random() * 8) + 1 : 0,
      },
    });
  }

  return { shipmentId, deviceImei, deviceName, payloads };
}

function buildAccelerometer(random: () => number) {
  const x = round((random() - 0.5) * 1.4, 4);
  const y = round((random() - 0.5) * 1.4, 4);
  const z = round(0.6 + random() * 0.5, 4);
  return { G: round(Math.sqrt(x * x + y * y + z * z), 6), X: x, Y: y, Z: z };
}

function signalStrengthFor(dbm: number): string {
  if (dbm >= -80) return 'Good';
  if (dbm >= -95) return 'Fair';
  if (dbm >= -110) return 'Poor';
  return 'No signal';
}

function publicShipmentId(random: () => number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 10; i += 1) id += alphabet[Math.floor(random() * alphabet.length)];
  return id;
}

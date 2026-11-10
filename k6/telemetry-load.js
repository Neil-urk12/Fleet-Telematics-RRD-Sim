// k6/telemetry-load.js
// Telematics ingestion load test: focuses specifically on the IoT telemetry
// ingestion and monitoring pipeline under high update frequencies.
//
// Usage:
//   k6 run k6/telemetry-load.js
//   k6 run -e BASE_URL=http://localhost:8000 k6/telemetry-load.js
import { sleep } from 'k6';
import {
  fleetLatestTelemetry,
  ingestBatchTelemetry,
  ingestTelemetry,
  latestTelemetry,
  telemetryHistory,
} from './scenarios.js';

export { setup } from './scenarios.js';

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // ramp up connected device load
    { duration: '2m', target: 40 },   // steady high-frequency telemetry ingestion
    { duration: '30s', target: 0 },   // ramp down
  ],
  thresholds: {
    // Ingestion should be quick and highly reliable
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<150'],
    checks: ['rate>0.99'],
  },
};

export default function ({ vehicleIds }) {
  const roll = Math.random();
  if (roll < 0.50) {
    // 50% single telematics event ingestion
    ingestTelemetry(vehicleIds);
  } else if (roll < 0.70) {
    // 20% batch telematics event ingestion
    ingestBatchTelemetry(vehicleIds);
  } else if (roll < 0.85) {
    // 15% fleet-wide latest telemetry status
    fleetLatestTelemetry();
  } else if (roll < 0.95) {
    // 10% single vehicle latest telemetry
    latestTelemetry(vehicleIds);
  } else {
    // 5% vehicle telemetry historical logs
    telemetryHistory(vehicleIds);
  }
  // Fast telemetry polling cadence (0.2s - 0.5s think time)
  sleep(0.3);
}

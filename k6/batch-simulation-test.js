// k6/batch-simulation-test.js
// Computational load test: stresses the route range degradation simulation
// engine with multi-vehicle batch evaluations and multi-config comparisons.
//
// Usage:
//   k6 run k6/batch-simulation-test.js
//   k6 run -e BASE_URL=http://localhost:8000 k6/batch-simulation-test.js
import { sleep } from 'k6';
import {
  batchSimulation,
  compareSimulation,
  listSimulationHistory,
  runSimulation,
} from './scenarios.js';

export { setup } from './scenarios.js';

export const options = {
  stages: [
    { duration: '30s', target: 10 },  // ramp up calculation load
    { duration: '1m30s', target: 25 }, // sustained batch & compare load
    { duration: '30s', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.02'],
    // Batch and compare operations perform multiple calculations per request
    http_req_duration: ['p(95)<350'],
    checks: ['rate>0.98'],
  },
};

export default function ({ vehicleIds }) {
  const roll = Math.random();
  if (roll < 0.40) {
    // 40% batch fleet simulation
    batchSimulation(vehicleIds);
  } else if (roll < 0.75) {
    // 35% multi-config driving comparison simulation
    compareSimulation(vehicleIds);
  } else if (roll < 0.90) {
    // 15% single route simulation
    runSimulation(vehicleIds);
  } else {
    // 10% simulation history retrieval
    listSimulationHistory(vehicleIds);
  }
  sleep(0.5);
}

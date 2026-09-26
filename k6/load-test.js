// k6/load-test.js
// Load test: ramp up to 50 VUs, hold, then ramp down.
//
// Usage:
//   k6 run k6/load-test.js
//   k6 run --out json=results.json k6/load-test.js
//   k6 run -e BASE_URL=http://localhost:8000 k6/load-test.js
import scenario from './scenarios.js';

export const options = {
  // ---- Config ----
  stages: [
    { duration: '1m', target: 50 }, // ramp-up
    { duration: '3m', target: 50 }, // steady state
    { duration: '1m', target: 0 },  // ramp-down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
    checks: ['rate==1'],
  },
};

export default function () {
  scenario();
}

// k6/smoke-test.js
// Smoke test: minimal load to sanity-check the setup and thresholds.
//
// Usage:
//   k6 run --out json=results-smoke.json k6/smoke-test.js
import scenario from './scenarios.js';

export const options = {
  vus: 1,
  duration: '20s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<200'],
    checks: ['rate==1'],
  },
};

export default function () {
  scenario();
}

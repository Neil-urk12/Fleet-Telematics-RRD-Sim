// k6/soak-test.js
// Soak (endurance) test: maintains a continuous, moderate load over an extended
// period to uncover memory leaks, database connection pool exhaustion, file
// descriptor leaks, and resource degradation over time.
//
// Usage:
//   k6 run k6/soak-test.js
//   k6 run -e BASE_URL=http://localhost:8000 k6/soak-test.js
import scenario from './scenarios.js';
export { setup } from './scenarios.js';

export const options = {
  stages: [
    { duration: '1m', target: 25 },   // ramp up to moderate load
    { duration: '10m', target: 25 },  // sustain load for 10 minutes
    { duration: '1m', target: 0 },    // smooth ramp down
  ],
  thresholds: {
    // Should remain rock solid across the entire duration
    http_req_failed: ['rate<0.01'],
    // 95% of requests within 250ms
    http_req_duration: ['p(95)<250'],
    checks: ['rate>0.99'],
  },
};

export default function (data) {
  scenario(data);
}

// k6/spike-test.js
// Spike test: simulates a sudden, violent surge in traffic (e.g. fleet dispatch
// shift start or route re-evaluation after unexpected road closures).
// Tests whether the backend recovers cleanly without crashing or hanging.
//
// Usage:
//   k6 run k6/spike-test.js
//   k6 run -e BASE_URL=http://localhost:8000 k6/spike-test.js
import scenario from './scenarios.js';
export { setup } from './scenarios.js';

export const options = {
  stages: [
    { duration: '15s', target: 5 },   // baseline low load
    { duration: '10s', target: 80 },  // sudden aggressive spike
    { duration: '1m', target: 80 },   // sustain the surge
    { duration: '10s', target: 5 },   // rapid recovery to baseline
    { duration: '30s', target: 5 },   // observe system recovery post-spike
    { duration: '10s', target: 0 },   // ramp down
  ],
  thresholds: {
    // Under sudden spike, allow at most 5% failure rate
    http_req_failed: ['rate<0.05'],
    // 95% of requests should complete within 600ms
    http_req_duration: ['p(95)<600'],
    checks: ['rate>0.95'],
  },
};

export default function (data) {
  scenario(data);
}

// k6/stress-test.js
// Stress test: pushes the backend beyond normal load levels to identify
// breaking points, capacity limits, and behavior under extreme concurrency.
//
// Usage:
//   k6 run k6/stress-test.js
//   k6 run -e BASE_URL=http://localhost:8000 k6/stress-test.js
import scenario from './scenarios.js';
export { setup } from './scenarios.js';

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // warm-up to light load
    { duration: '1m', target: 50 },   // ramp up to normal load
    { duration: '2m', target: 100 },  // push beyond standard capacity
    { duration: '1m', target: 150 },  // peak stress point
    { duration: '1m', target: 150 },  // sustain at peak stress
    { duration: '30s', target: 0 },   // ramp-down / recovery
  ],
  thresholds: {
    // Under extreme stress, allow at most 5% failure rate
    http_req_failed: ['rate<0.05'],
    // 95% of requests should complete within 500ms
    http_req_duration: ['p(95)<500'],
    checks: ['rate>0.95'],
  },
};

export default function (data) {
  scenario(data);
}

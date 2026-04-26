/**
 * P7-05 — Example read-heavy load test (k6).
 * No auth: public health endpoints only. Adjust BASE_URL to your target.
 *
 *   k6 run perf/k6-read-heavy.js
 *   BASE_URL=https://staging.example.com k6 run perf/k6-read-heavy.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '20s', target: 5 },
    { duration: '40s', target: 20 },
    { duration: '20s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export default function readHeavy() {
  let r = http.get(`${BASE}/api/health`);
  check(r, { 'liveness 200': (res) => res.status === 200 });
  sleep(0.05);

  r = http.get(`${BASE}/api/health/ready`);
  check(r, { 'readiness 200/503': (res) => res.status === 200 || res.status === 503 });
  sleep(0.1);
}

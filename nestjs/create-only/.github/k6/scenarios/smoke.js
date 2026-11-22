/**
 * Seeded by Lisa on first setup — this file is YOURS.
 * Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)
 */

import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 1,
  duration: "1m",
  thresholds: {
    http_req_failed: ["rate<0.01"], // http errors should be less than 1%
    http_req_duration: ["p(95)<300"], // 95% of requests should be below 300ms
  },
};

const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:3000";

export default function () {
  // Smoke test - minimal load to verify system is working
  const response = http.get(`${BASE_URL}/health`);

  check(response, {
    "status is 200": r => r.status === 200,
    "response time < 300ms": r => r.timings.duration < 300,
    // A failed request (refused, DNS, timeout) has a null body. Reading
    // `.length` on it throws, which ends the iteration before sleep(1) and
    // spins the VU at thousands of requests per second.
    "response has body": r => (r.body || "").length > 0,
  });

  sleep(1);
}

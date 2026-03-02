/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
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
    "response has body": r => r.body.length > 0,
  });

  sleep(1);
}

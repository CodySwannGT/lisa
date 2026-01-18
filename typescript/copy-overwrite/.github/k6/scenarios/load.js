import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const apiErrors = new Rate("api_errors");

export const options = {
  stages: [
    { duration: "2m", target: 10 }, // Ramp up to 10 users
    { duration: "5m", target: 10 }, // Stay at 10 users
    { duration: "2m", target: 0 }, // Ramp down to 0 users
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"], // http errors should be less than 5%
    http_req_duration: ["p(95)<500"], // 95% of requests should be below 500ms
    http_req_duration: ["p(99)<1000"], // 99% of requests should be below 1s
    errors: ["rate<0.05"], // custom errors should be less than 5%
    api_errors: ["rate<0.02"], // API errors should be less than 2%
  },
};

const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:3000";
const CUSTOM_HEADERS = __ENV.K6_CUSTOM_HEADERS
  ? JSON.parse(__ENV.K6_CUSTOM_HEADERS)
  : {};

export default function () {
  const headers = {
    "Content-Type": "application/json",
    ...CUSTOM_HEADERS,
  };

  // User flow simulation
  group("Homepage Load", () => {
    const homeResponse = http.get(`${BASE_URL}/`, {
      headers,
      tags: { name: "Home" },
    });
    check(homeResponse, {
      "homepage status is 200": r => r.status === 200,
      "homepage loads quickly": r => r.timings.duration < 300,
    }) || errorRate.add(1);
    sleep(1);
  });

  group("API Health Check", () => {
    const healthResponse = http.get(`${BASE_URL}/health`, {
      headers,
      tags: { name: "Health" },
    });
    check(healthResponse, {
      "health check is healthy": r => r.status === 200,
      "health check is fast": r => r.timings.duration < 100,
    }) || errorRate.add(1);
    sleep(0.5);
  });

  group("API Operations", () => {
    // GET request
    const getResponse = http.get(`${BASE_URL}/api/items`, {
      headers,
      tags: { name: "API_GET" },
    });

    const getCheck = check(getResponse, {
      "GET status is 200": r => r.status === 200,
      "GET response has data": r => {
        try {
          const body = JSON.parse(r.body);
          return body && (Array.isArray(body) || body.data);
        } catch (e) {
          return false;
        }
      },
      "GET response time OK": r => r.timings.duration < 500,
    });

    if (!getCheck) {
      apiErrors.add(1);
    }

    sleep(1);

    // POST request (if applicable)
    const payload = JSON.stringify({
      name: `Test Item ${Date.now()}`,
      value: Math.random() * 100,
    });

    const postResponse = http.post(`${BASE_URL}/api/items`, payload, {
      headers,
      tags: { name: "API_POST" },
    });

    const postCheck = check(postResponse, {
      "POST status is 201 or 200": r => r.status === 201 || r.status === 200,
      "POST returns created item": r => {
        try {
          const body = JSON.parse(r.body);
          return body && body.id;
        } catch (e) {
          return false;
        }
      },
      "POST response time OK": r => r.timings.duration < 800,
    });

    if (!postCheck) {
      apiErrors.add(1);
    }

    sleep(2);
  });

  // Simulate user think time between iterations
  sleep(Math.random() * 3 + 2); // 2-5 seconds
}

export function handleSummary(data) {
  return {
    "k6-results/load-summary.json": JSON.stringify(data),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}

function textSummary(data, options) {
  // Custom summary function for better console output
  const { metrics } = data;
  let summary = "\n=== Load Test Summary ===\n\n";

  if (metrics) {
    summary += `Total Requests: ${metrics.http_reqs?.values?.count || 0}\n`;
    summary += `Failed Requests: ${metrics.http_req_failed?.values?.passes || 0}\n`;
    summary += `Avg Response Time: ${Math.round(metrics.http_req_duration?.values?.avg || 0)}ms\n`;
    summary += `95th Percentile: ${Math.round(metrics.http_req_duration?.values["p(95)"] || 0)}ms\n`;
    summary += `99th Percentile: ${Math.round(metrics.http_req_duration?.values["p(99)"] || 0)}ms\n`;
  }

  return summary;
}

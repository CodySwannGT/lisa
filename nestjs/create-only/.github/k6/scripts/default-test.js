/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");

// Test configuration based on scenario
const scenarios = {
  smoke: {
    executor: "constant-vus",
    vus: 1,
    duration: "1m",
  },
  load: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "2m", target: 10 },
      { duration: "5m", target: 10 },
      { duration: "2m", target: 0 },
    ],
    gracefulStop: "30s",
  },
  stress: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "2m", target: 10 },
      { duration: "5m", target: 10 },
      { duration: "2m", target: 20 },
      { duration: "5m", target: 20 },
      { duration: "2m", target: 30 },
      { duration: "5m", target: 30 },
      { duration: "5m", target: 0 },
    ],
    gracefulStop: "30s",
  },
  spike: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "10s", target: 5 },
      { duration: "1m", target: 5 },
      { duration: "10s", target: 50 },
      { duration: "3m", target: 50 },
      { duration: "10s", target: 5 },
      { duration: "3m", target: 5 },
      { duration: "10s", target: 0 },
    ],
    gracefulStop: "30s",
  },
  soak: {
    executor: "constant-vus",
    vus: 10,
    duration: "30m",
  },
};

// Get configuration from environment
const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:3000";
const SCENARIO = __ENV.K6_SCENARIO || "smoke";
const CUSTOM_HEADERS = __ENV.K6_CUSTOM_HEADERS
  ? JSON.parse(__ENV.K6_CUSTOM_HEADERS)
  : {};

// Override duration if provided
if (__ENV.K6_DURATION && scenarios[SCENARIO]) {
  if (scenarios[SCENARIO].duration) {
    scenarios[SCENARIO].duration = __ENV.K6_DURATION;
  } else if (scenarios[SCENARIO].stages) {
    // For staged scenarios, scale the stages proportionally
    const totalDuration = scenarios[SCENARIO].stages.reduce((sum, stage) => {
      const duration = stage.duration;
      const value = parseInt(duration);
      const unit = duration.slice(-1);
      const multiplier = unit === "m" ? 60 : unit === "h" ? 3600 : 1;
      return sum + value * multiplier;
    }, 0);

    const newDuration = parseInt(__ENV.K6_DURATION);
    const newUnit = __ENV.K6_DURATION.slice(-1);
    const newMultiplier = newUnit === "m" ? 60 : newUnit === "h" ? 3600 : 1;
    const newTotalSeconds = newDuration * newMultiplier;
    const scale = newTotalSeconds / totalDuration;

    scenarios[SCENARIO].stages = scenarios[SCENARIO].stages.map(stage => ({
      ...stage,
      duration:
        Math.ceil(parseInt(stage.duration) * scale) + stage.duration.slice(-1),
    }));
  }
}

// Override VUs if provided
if (__ENV.K6_VUS) {
  const vus = parseInt(__ENV.K6_VUS);
  if (scenarios[SCENARIO].vus) {
    scenarios[SCENARIO].vus = vus;
  } else if (scenarios[SCENARIO].stages) {
    // Scale stages proportionally
    scenarios[SCENARIO].stages = scenarios[SCENARIO].stages.map(stage => ({
      ...stage,
      target: Math.ceil(stage.target * (vus / 10)), // Assuming base of 10 VUs
    }));
  }
}

export const options = {
  scenarios: {
    [SCENARIO]: scenarios[SCENARIO],
  },
  thresholds: {
    http_req_failed: ["rate<0.1"], // http errors should be less than 10%
    http_req_duration: ["p(95)<500"], // 95% of requests should be below 500ms
    errors: ["rate<0.1"], // custom error rate should be less than 10%
  },
};

// Default test function - can be overridden by custom scripts
export default function () {
  const headers = {
    "Content-Type": "application/json",
    ...CUSTOM_HEADERS,
  };

  // Example API endpoints to test
  const endpoints = [
    { name: "Home", url: "/", method: "GET" },
    { name: "Health", url: "/health", method: "GET" },
    { name: "API Status", url: "/api/status", method: "GET" },
  ];

  // Test each endpoint
  endpoints.forEach(endpoint => {
    const url = `${BASE_URL}${endpoint.url}`;
    const response = http.request(endpoint.method, url, null, {
      headers,
      tags: { name: endpoint.name },
    });

    // Check response
    const result = check(response, {
      [`${endpoint.name}: status is 200`]: r => r.status === 200,
      [`${endpoint.name}: response time < 500ms`]: r =>
        r.timings.duration < 500,
    });

    // Track errors
    errorRate.add(!result);
  });

  // Think time between iterations
  sleep(1);
}

// Setup function - runs once per VU
export function setup() {
  console.log(`Starting ${SCENARIO} test against ${BASE_URL}`);
  console.log(`Environment: ${__ENV.K6_ENVIRONMENT}`);

  // Verify base URL is accessible
  const response = http.get(BASE_URL);
  if (
    response.status !== 200 &&
    response.status !== 301 &&
    response.status !== 302
  ) {
    throw new Error(
      `Base URL ${BASE_URL} is not accessible. Status: ${response.status}`
    );
  }

  return {
    baseUrl: BASE_URL,
    scenario: SCENARIO,
    startTime: new Date().toISOString(),
  };
}

// Teardown function - runs once after all VUs finish
export function teardown(data) {
  console.log(`Completed ${data.scenario} test`);
  console.log(`Test duration: ${new Date() - new Date(data.startTime)}ms`);
}

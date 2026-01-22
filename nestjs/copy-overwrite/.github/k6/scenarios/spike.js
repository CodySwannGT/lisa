/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const spikeResponseTime = new Trend("spike_response_time");
const recoveryTime = new Trend("recovery_time");

export const options = {
  stages: [
    { duration: "30s", target: 5 }, // Baseline load
    { duration: "1m", target: 5 }, // Stay at baseline
    { duration: "30s", target: 100 }, // Spike to 100 users
    { duration: "3m", target: 100 }, // Stay at peak
    { duration: "30s", target: 5 }, // Drop back to baseline
    { duration: "2m", target: 5 }, // Recovery period
    { duration: "30s", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_failed: ["rate<0.15"], // Higher tolerance during spikes
    http_req_duration: ["p(95)<3000"], // 95% of requests under 3s
    errors: ["rate<0.2"], // 20% error rate threshold
    spike_response_time: ["p(95)<5000"], // Spike-specific metric
  },
};

const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:3000";
const CUSTOM_HEADERS = __ENV.K6_CUSTOM_HEADERS
  ? JSON.parse(__ENV.K6_CUSTOM_HEADERS)
  : {};

// Track test phases
let currentPhase = "baseline";
let phaseStartTime = Date.now();

export default function () {
  const headers = {
    "Content-Type": "application/json",
    ...CUSTOM_HEADERS,
  };

  // Determine current phase based on VU count
  const vuCount = __VU;
  let phase = "baseline";
  if (vuCount > 50) phase = "spike";
  else if (vuCount <= 10 && currentPhase === "spike") phase = "recovery";

  if (phase !== currentPhase) {
    const phaseDuration = Date.now() - phaseStartTime;
    if (currentPhase === "spike") {
      recoveryTime.add(phaseDuration);
    }
    currentPhase = phase;
    phaseStartTime = Date.now();
  }

  group(`Spike Test - ${phase} phase`, () => {
    // Critical user path that must handle spikes
    const criticalResponse = http.get(`${BASE_URL}/api/critical-endpoint`, {
      headers,
      tags: { name: "CriticalPath", phase: phase },
      timeout: "10s", // Longer timeout during spikes
    });

    const criticalCheck = check(criticalResponse, {
      "critical path available": r => r.status === 200 || r.status === 503,
      "response time acceptable": r =>
        r.timings.duration < (phase === "spike" ? 5000 : 1000),
    });

    if (!criticalCheck) {
      errorRate.add(1);
    }

    if (phase === "spike") {
      spikeResponseTime.add(criticalResponse.timings.duration);
    }

    // Simulate various user behaviors during spike
    if (Math.random() < 0.7) {
      // 70% read operations
      const readResponse = http.get(`${BASE_URL}/api/items`, {
        headers,
        tags: { name: "ReadOperation", phase: phase },
      });

      check(readResponse, {
        "read operation successful": r => r.status === 200,
      }) || errorRate.add(1);
    } else {
      // 30% write operations
      const writePayload = JSON.stringify({
        action: "spike_test",
        timestamp: Date.now(),
        phase: phase,
        vu: __VU,
      });

      const writeResponse = http.post(`${BASE_URL}/api/items`, writePayload, {
        headers,
        tags: { name: "WriteOperation", phase: phase },
      });

      check(writeResponse, {
        "write operation handled": r => [200, 201, 429, 503].includes(r.status),
      }) || errorRate.add(1);
    }
  });

  // Minimal sleep during spike phase, normal sleep otherwise
  sleep(phase === "spike" ? 0.1 : 1);
}

export function handleSummary(data) {
  const { metrics } = data;

  const summary = {
    timestamp: new Date().toISOString(),
    test_type: "spike",
    phases: {
      baseline: {
        avg_response_time: Math.round(
          metrics.http_req_duration?.values?.avg || 0
        ),
        error_rate: metrics.errors?.values?.rate || 0,
      },
      spike: {
        avg_response_time: Math.round(
          metrics.spike_response_time?.values?.avg || 0
        ),
        p95_response_time: Math.round(
          metrics.spike_response_time?.values["p(95)"] || 0
        ),
        max_response_time: Math.round(
          metrics.spike_response_time?.values?.max || 0
        ),
        error_rate: metrics.errors?.values?.rate || 0,
      },
      recovery: {
        time_to_normal: Math.round(metrics.recovery_time?.values?.avg || 0),
      },
    },
    total_requests: metrics.http_reqs?.values?.count || 0,
    failed_requests: metrics.http_req_failed?.values?.passes || 0,
    thresholds_passed: Object.entries(data.thresholds || {}).every(
      ([, value]) => value.ok
    ),
  };

  return {
    "k6-results/spike-summary.json": JSON.stringify(summary, null, 2),
    stdout: createSpikeSummary(summary),
  };
}

function createSpikeSummary(summary) {
  let text = "\n=== Spike Test Summary ===\n\n";
  text += `Timestamp: ${summary.timestamp}\n`;
  text += `Total Requests: ${summary.total_requests}\n`;
  text += `Failed Requests: ${summary.failed_requests}\n\n`;

  text += "Phase Analysis:\n";
  text += `  Baseline Phase:\n`;
  text += `    - Avg Response Time: ${summary.phases.baseline.avg_response_time}ms\n`;
  text += `    - Error Rate: ${(summary.phases.baseline.error_rate * 100).toFixed(2)}%\n`;

  text += `  Spike Phase:\n`;
  text += `    - Avg Response Time: ${summary.phases.spike.avg_response_time}ms\n`;
  text += `    - 95th Percentile: ${summary.phases.spike.p95_response_time}ms\n`;
  text += `    - Max Response Time: ${summary.phases.spike.max_response_time}ms\n`;
  text += `    - Error Rate: ${(summary.phases.spike.error_rate * 100).toFixed(2)}%\n`;

  text += `  Recovery Phase:\n`;
  text += `    - Time to Normal: ${summary.phases.recovery.time_to_normal}ms\n\n`;

  text += `All Thresholds Passed: ${summary.thresholds_passed ? "✅ YES" : "❌ NO"}\n`;

  return text;
}

/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const responseTime = new Trend("custom_response_time");
const throughput = new Rate("throughput");

export const options = {
  stages: [
    { duration: "2m", target: 10 }, // Warm up
    { duration: "5m", target: 10 }, // Normal load
    { duration: "2m", target: 20 }, // Increase to 20 users
    { duration: "5m", target: 20 }, // Stay at 20 users
    { duration: "2m", target: 30 }, // Increase to 30 users
    { duration: "5m", target: 30 }, // Stay at 30 users
    { duration: "5m", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_failed: [
      {
        threshold: "rate<0.1",
        abortOnFail: true,
        delayAbortEval: "30s",
      },
    ], // Abort if error rate > 10%
    http_req_duration: ["p(95)<1000", "p(99)<2000"], // More relaxed for stress
    errors: ["rate<0.15"], // Allow up to 15% errors under stress
    throughput: ["rate>0.8"], // At least 80% of requests should complete
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

  // Stress test focuses on system behavior under high load
  group("Concurrent API Calls", () => {
    const batch = http.batch([
      [
        "GET",
        `${BASE_URL}/api/items`,
        null,
        { headers, tags: { name: "BatchGet1" } },
      ],
      [
        "GET",
        `${BASE_URL}/api/items?page=2`,
        null,
        { headers, tags: { name: "BatchGet2" } },
      ],
      [
        "GET",
        `${BASE_URL}/api/status`,
        null,
        { headers, tags: { name: "BatchStatus" } },
      ],
    ]);

    batch.forEach((response, index) => {
      const isOk = check(response, {
        "batch request succeeded": r => r.status === 200,
      });

      if (!isOk) {
        errorRate.add(1);
      } else {
        throughput.add(1);
      }

      responseTime.add(response.timings.duration);
    });
  });

  // Heavy operations
  group("Resource Intensive Operations", () => {
    // Simulate large payload
    const largePayload = JSON.stringify({
      data: Array(100)
        .fill(null)
        .map((_, i) => ({
          id: i,
          name: `Item ${i}`,
          description:
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit".repeat(
              10
            ),
          metadata: {
            created: new Date().toISOString(),
            tags: Array(20)
              .fill(null)
              .map((_, j) => `tag${j}`),
          },
        })),
    });

    const heavyResponse = http.post(
      `${BASE_URL}/api/bulk-process`,
      largePayload,
      {
        headers,
        tags: { name: "HeavyOperation" },
        timeout: "30s",
      }
    );

    const heavyCheck = check(heavyResponse, {
      "heavy operation completed": r => r.status === 200 || r.status === 202,
      "heavy operation within timeout": r => r.timings.duration < 30000,
    });

    if (!heavyCheck) {
      errorRate.add(1);
    } else {
      throughput.add(1);
    }
  });

  // Rapid fire requests (no sleep)
  group("Rapid Requests", () => {
    for (let i = 0; i < 5; i++) {
      const rapidResponse = http.get(
        `${BASE_URL}/api/items/${Math.floor(Math.random() * 100)}`,
        {
          headers,
          tags: { name: "RapidFire" },
        }
      );

      check(rapidResponse, {
        "rapid request handled": r => r.status === 200 || r.status === 404,
      }) || errorRate.add(1);
    }
  });

  // Minimal think time to maintain pressure
  sleep(Math.random() * 0.5);
}

export function handleSummary(data) {
  const { metrics } = data;

  // Calculate stress test specific metrics
  const totalRequests = metrics.http_reqs?.values?.count || 0;
  const failedRequests = metrics.http_req_failed?.values?.passes || 0;
  const errorPercentage =
    totalRequests > 0 ? ((failedRequests / totalRequests) * 100).toFixed(2) : 0;

  const summary = {
    timestamp: new Date().toISOString(),
    test_type: "stress",
    total_requests: totalRequests,
    failed_requests: failedRequests,
    error_percentage: parseFloat(errorPercentage),
    avg_response_time: Math.round(metrics.http_req_duration?.values?.avg || 0),
    p95_response_time: Math.round(
      metrics.http_req_duration?.values["p(95)"] || 0
    ),
    p99_response_time: Math.round(
      metrics.http_req_duration?.values["p(99)"] || 0
    ),
    max_response_time: Math.round(metrics.http_req_duration?.values?.max || 0),
    custom_metrics: {
      error_rate: metrics.errors?.values?.rate || 0,
      throughput_rate: metrics.throughput?.values?.rate || 0,
      avg_custom_response_time: Math.round(
        metrics.custom_response_time?.values?.avg || 0
      ),
    },
    thresholds_passed: Object.entries(data.thresholds || {}).every(
      ([, value]) => value.ok
    ),
  };

  return {
    "k6-results/stress-summary.json": JSON.stringify(summary, null, 2),
    stdout: createTextSummary(summary),
  };
}

function createTextSummary(summary) {
  let text = "\n=== Stress Test Summary ===\n\n";
  text += `Test Type: ${summary.test_type}\n`;
  text += `Timestamp: ${summary.timestamp}\n\n`;
  text += `Total Requests: ${summary.total_requests}\n`;
  text += `Failed Requests: ${summary.failed_requests} (${summary.error_percentage}%)\n`;
  text += `Average Response Time: ${summary.avg_response_time}ms\n`;
  text += `95th Percentile: ${summary.p95_response_time}ms\n`;
  text += `99th Percentile: ${summary.p99_response_time}ms\n`;
  text += `Max Response Time: ${summary.max_response_time}ms\n\n`;
  text += `Custom Metrics:\n`;
  text += `  Error Rate: ${(summary.custom_metrics.error_rate * 100).toFixed(2)}%\n`;
  text += `  Throughput Rate: ${(summary.custom_metrics.throughput_rate * 100).toFixed(2)}%\n`;
  text += `  Avg Custom Response Time: ${summary.custom_metrics.avg_custom_response_time}ms\n\n`;
  text += `All Thresholds Passed: ${summary.thresholds_passed ? "✅ YES" : "❌ NO"}\n`;

  return text;
}

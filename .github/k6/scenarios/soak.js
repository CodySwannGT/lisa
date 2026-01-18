import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// Custom metrics for soak testing
const errorRate = new Rate("errors");
const memoryLeakIndicator = new Trend("response_time_degradation");
const requestsPerMinute = new Counter("requests_per_minute");
const degradationRate = new Trend("degradation_rate");

export const options = {
  vus: 10,
  duration: __ENV.K6_DURATION || "30m", // Default 30 minutes, can override
  thresholds: {
    http_req_failed: ["rate<0.02"], // Very low error tolerance for soak
    http_req_duration: ["p(95)<1000"], // Consistent performance expected
    errors: ["rate<0.02"],
    degradation_rate: ["value<0.1"], // Performance shouldn't degrade > 10%
  },
};

const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:3000";
const CUSTOM_HEADERS = __ENV.K6_CUSTOM_HEADERS
  ? JSON.parse(__ENV.K6_CUSTOM_HEADERS)
  : {};

// Track performance over time
const performanceHistory = [];
const historyInterval = 60; // Track every 60 seconds
let lastHistoryUpdate = Date.now();
let baselineResponseTime = null;

export default function () {
  const headers = {
    "Content-Type": "application/json",
    ...CUSTOM_HEADERS,
  };

  const iterationStart = Date.now();

  group("Soak Test Operations", () => {
    // Standard operations that run continuously
    group("Read Operations", () => {
      const endpoints = [
        "/api/items",
        "/api/status",
        "/api/health",
        "/api/metrics",
      ];

      endpoints.forEach(endpoint => {
        const response = http.get(`${BASE_URL}${endpoint}`, {
          headers,
          tags: { name: `GET ${endpoint}`, operation: "read" },
        });

        const isOk = check(response, {
          [`${endpoint} status OK`]: r => r.status === 200,
          [`${endpoint} response time OK`]: r => r.timings.duration < 1000,
        });

        if (!isOk) {
          errorRate.add(1);
        }

        // Track response time degradation
        if (endpoint === "/api/items") {
          memoryLeakIndicator.add(response.timings.duration);

          // Set baseline on first successful request
          if (baselineResponseTime === null && response.status === 200) {
            baselineResponseTime = response.timings.duration;
          }

          // Calculate degradation
          if (baselineResponseTime !== null) {
            const degradation =
              (response.timings.duration - baselineResponseTime) /
              baselineResponseTime;
            degradationRate.add(degradation);
          }
        }
      });
    });

    group("Write Operations", () => {
      // Periodic write operations to test resource cleanup
      if (__ITER % 10 === 0) {
        // Every 10th iteration
        const payload = JSON.stringify({
          test: "soak",
          iteration: __ITER,
          timestamp: Date.now(),
          vu: __VU,
          data: Array(100).fill("x").join(""), // Small payload
        });

        const writeResponse = http.post(`${BASE_URL}/api/items`, payload, {
          headers,
          tags: { name: "POST /api/items", operation: "write" },
        });

        check(writeResponse, {
          "write status OK": r => r.status === 201 || r.status === 200,
          "write response time OK": r => r.timings.duration < 2000,
        }) || errorRate.add(1);

        // Test cleanup - delete old items periodically
        if (__ITER % 50 === 0) {
          const deleteResponse = http.del(`${BASE_URL}/api/items/old`, {
            headers,
            tags: { name: "DELETE old items", operation: "cleanup" },
          });

          check(deleteResponse, {
            "cleanup successful": r => r.status === 200 || r.status === 204,
          });
        }
      }
    });

    group("Complex Operations", () => {
      // Simulate complex user workflows
      if (__ITER % 5 === 0) {
        // Every 5th iteration
        const searchResponse = http.get(
          `${BASE_URL}/api/search?q=test&limit=100`,
          {
            headers,
            tags: { name: "Complex Search", operation: "search" },
          }
        );

        check(searchResponse, {
          "search completed": r => r.status === 200,
          "search performance OK": r => r.timings.duration < 3000,
        }) || errorRate.add(1);
      }
    });
  });

  // Track requests per minute
  requestsPerMinute.add(1);

  // Update performance history
  const now = Date.now();
  if (now - lastHistoryUpdate > historyInterval * 1000) {
    performanceHistory.push({
      timestamp: now,
      avgResponseTime: memoryLeakIndicator.value,
      errorRate: errorRate.value,
    });
    lastHistoryUpdate = now;
  }

  // Consistent pacing for soak test
  const iterationDuration = Date.now() - iterationStart;
  const targetPace = 1000; // 1 request per second per VU
  const sleepTime = Math.max(0, targetPace - iterationDuration) / 1000;
  sleep(sleepTime);
}

export function handleSummary(data) {
  const { metrics } = data;
  const duration = parseInt(__ENV.K6_DURATION || "30m");

  const summary = {
    timestamp: new Date().toISOString(),
    test_type: "soak",
    duration: __ENV.K6_DURATION || "30m",
    total_requests: metrics.http_reqs?.values?.count || 0,
    failed_requests: metrics.http_req_failed?.values?.passes || 0,
    error_rate: metrics.errors?.values?.rate || 0,
    performance: {
      baseline_response_time: baselineResponseTime,
      final_avg_response_time: Math.round(
        metrics.http_req_duration?.values?.avg || 0
      ),
      p95_response_time: Math.round(
        metrics.http_req_duration?.values["p(95)"] || 0
      ),
      p99_response_time: Math.round(
        metrics.http_req_duration?.values["p(99)"] || 0
      ),
      degradation_percentage:
        (metrics.degradation_rate?.values?.avg || 0) * 100,
    },
    resource_usage: {
      requests_per_minute: Math.round(
        (metrics.http_reqs?.values?.count || 0) / (duration / 60)
      ),
      avg_data_sent: Math.round(metrics.data_sent?.values?.avg || 0),
      avg_data_received: Math.round(metrics.data_received?.values?.avg || 0),
    },
    stability: {
      consistent_performance: metrics.degradation_rate?.values?.avg < 0.1,
      low_error_rate: metrics.errors?.values?.rate < 0.02,
      thresholds_passed: Object.entries(data.thresholds || {}).every(
        ([, value]) => value.ok
      ),
    },
    performance_history: performanceHistory,
  };

  return {
    "k6-results/soak-summary.json": JSON.stringify(summary, null, 2),
    stdout: createSoakSummary(summary),
  };
}

function createSoakSummary(summary) {
  let text = "\n=== Soak Test Summary ===\n\n";
  text += `Test Duration: ${summary.duration}\n`;
  text += `Timestamp: ${summary.timestamp}\n\n`;

  text += "Overall Statistics:\n";
  text += `  Total Requests: ${summary.total_requests}\n`;
  text += `  Failed Requests: ${summary.failed_requests}\n`;
  text += `  Error Rate: ${(summary.error_rate * 100).toFixed(2)}%\n\n`;

  text += "Performance Analysis:\n";
  text += `  Baseline Response Time: ${summary.performance.baseline_response_time}ms\n`;
  text += `  Final Avg Response Time: ${summary.performance.final_avg_response_time}ms\n`;
  text += `  95th Percentile: ${summary.performance.p95_response_time}ms\n`;
  text += `  99th Percentile: ${summary.performance.p99_response_time}ms\n`;
  text += `  Performance Degradation: ${summary.performance.degradation_percentage.toFixed(2)}%\n\n`;

  text += "Resource Usage:\n";
  text += `  Requests/Minute: ${summary.resource_usage.requests_per_minute}\n`;
  text += `  Avg Data Sent: ${(summary.resource_usage.avg_data_sent / 1024).toFixed(2)} KB\n`;
  text += `  Avg Data Received: ${(summary.resource_usage.avg_data_received / 1024).toFixed(2)} KB\n\n`;

  text += "Stability Assessment:\n";
  text += `  Consistent Performance: ${summary.stability.consistent_performance ? "✅ YES" : "❌ NO"}\n`;
  text += `  Low Error Rate: ${summary.stability.low_error_rate ? "✅ YES" : "❌ NO"}\n`;
  text += `  All Thresholds Passed: ${summary.stability.thresholds_passed ? "✅ YES" : "❌ NO"}\n`;

  if (!summary.stability.consistent_performance) {
    text +=
      "\n⚠️  WARNING: Performance degradation detected over time. Possible memory leak or resource exhaustion.\n";
  }

  return text;
}

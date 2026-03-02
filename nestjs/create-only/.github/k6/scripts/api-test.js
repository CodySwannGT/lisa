/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

import http from "k6/http";
import { check, group, sleep, fail } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";
import {
  randomString,
  randomIntBetween,
} from "https://jslib.k6.io/k6-utils/1.2.0/index.js";

// Custom metrics
const errorRate = new Rate("errors");
const apiErrors = new Rate("api_errors");
const successfulRequests = new Counter("successful_requests");
const createLatency = new Trend("create_latency");
const readLatency = new Trend("read_latency");
const updateLatency = new Trend("update_latency");
const deleteLatency = new Trend("delete_latency");

// Get configuration from environment
const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:3000";
const API_VERSION = __ENV.API_VERSION || "v1";
const CUSTOM_HEADERS = __ENV.K6_CUSTOM_HEADERS
  ? JSON.parse(__ENV.K6_CUSTOM_HEADERS)
  : {};

export const options = {
  scenarios: {
    api_test: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 5 },
        { duration: "3m", target: 5 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.1"],
    http_req_duration: ["p(95)<2000"],
    api_errors: ["rate<0.05"],
    errors: ["rate<0.1"],
    create_latency: ["p(95)<1000"],
    read_latency: ["p(95)<500"],
    update_latency: ["p(95)<1000"],
    delete_latency: ["p(95)<1000"],
  },
};

// Helper function to build API URL
function apiUrl(endpoint) {
  return `${BASE_URL}/api/${API_VERSION}${endpoint}`;
}

// Helper function to make authenticated requests
function makeRequest(method, endpoint, payload, params = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Request-ID": randomString(16),
    ...CUSTOM_HEADERS,
    ...params.headers,
  };

  const url = apiUrl(endpoint);
  let response;

  switch (method.toUpperCase()) {
    case "GET":
      response = http.get(url, { headers, ...params });
      break;
    case "POST":
      response = http.post(url, JSON.stringify(payload), {
        headers,
        ...params,
      });
      break;
    case "PUT":
      response = http.put(url, JSON.stringify(payload), { headers, ...params });
      break;
    case "PATCH":
      response = http.patch(url, JSON.stringify(payload), {
        headers,
        ...params,
      });
      break;
    case "DELETE":
      response = http.del(url, { headers, ...params });
      break;
    default:
      fail(`Unsupported method: ${method}`);
  }

  // Log errors for debugging
  if (response.status >= 400) {
    console.error(
      `API Error: ${method} ${url} - Status: ${response.status} - Body: ${response.body}`
    );
    apiErrors.add(1);
  }

  return response;
}

// Test data generator
function generateTestData() {
  return {
    name: `Test Item ${randomString(8)}`,
    description: `Description for test item created at ${new Date().toISOString()}`,
    quantity: randomIntBetween(1, 100),
    price: randomIntBetween(10, 1000) / 100,
    category: ["electronics", "books", "clothing", "food"][
      randomIntBetween(0, 3)
    ],
    tags: Array.from({ length: randomIntBetween(1, 3) }, () => randomString(5)),
    metadata: {
      source: "k6-test",
      environment: __ENV.K6_ENVIRONMENT || "test",
      iteration: __ITER,
      vu: __VU,
    },
  };
}

export default function () {
  let createdItemId = null;

  group("API CRUD Operations", () => {
    // CREATE
    group("Create Item", () => {
      const createData = generateTestData();
      const createStart = Date.now();

      const createResponse = makeRequest("POST", "/items", createData, {
        tags: { name: "CreateItem" },
      });

      createLatency.add(Date.now() - createStart);

      const createCheck = check(createResponse, {
        "create status is 201": r => r.status === 201,
        "create returns id": r => {
          try {
            const body = JSON.parse(r.body);
            createdItemId = body.id || body.data?.id;
            return createdItemId !== undefined;
          } catch (e) {
            return false;
          }
        },
        "create returns created item": r => {
          try {
            const body = JSON.parse(r.body);
            const item = body.data || body;
            return item.name === createData.name;
          } catch (e) {
            return false;
          }
        },
      });

      if (!createCheck) {
        errorRate.add(1);
      } else {
        successfulRequests.add(1);
      }
    });

    // READ
    if (createdItemId) {
      group("Read Item", () => {
        const readStart = Date.now();

        const readResponse = makeRequest(
          "GET",
          `/items/${createdItemId}`,
          null,
          {
            tags: { name: "ReadItem" },
          }
        );

        readLatency.add(Date.now() - readStart);

        const readCheck = check(readResponse, {
          "read status is 200": r => r.status === 200,
          "read returns correct item": r => {
            try {
              const body = JSON.parse(r.body);
              const item = body.data || body;
              return item.id === createdItemId;
            } catch (e) {
              return false;
            }
          },
        });

        if (!readCheck) {
          errorRate.add(1);
        } else {
          successfulRequests.add(1);
        }
      });

      // UPDATE
      group("Update Item", () => {
        const updateData = {
          name: `Updated ${randomString(8)}`,
          quantity: randomIntBetween(1, 50),
          metadata: {
            ...generateTestData().metadata,
            updated: true,
            updateTime: new Date().toISOString(),
          },
        };

        const updateStart = Date.now();

        const updateResponse = makeRequest(
          "PUT",
          `/items/${createdItemId}`,
          updateData,
          {
            tags: { name: "UpdateItem" },
          }
        );

        updateLatency.add(Date.now() - updateStart);

        const updateCheck = check(updateResponse, {
          "update status is 200": r => r.status === 200,
          "update returns updated item": r => {
            try {
              const body = JSON.parse(r.body);
              const item = body.data || body;
              return item.name === updateData.name;
            } catch (e) {
              return false;
            }
          },
        });

        if (!updateCheck) {
          errorRate.add(1);
        } else {
          successfulRequests.add(1);
        }
      });

      // DELETE
      group("Delete Item", () => {
        const deleteStart = Date.now();

        const deleteResponse = makeRequest(
          "DELETE",
          `/items/${createdItemId}`,
          null,
          {
            tags: { name: "DeleteItem" },
          }
        );

        deleteLatency.add(Date.now() - deleteStart);

        const deleteCheck = check(deleteResponse, {
          "delete status is 204 or 200": r =>
            r.status === 204 || r.status === 200,
        });

        if (!deleteCheck) {
          errorRate.add(1);
        } else {
          successfulRequests.add(1);
        }

        // Verify deletion
        const verifyResponse = makeRequest(
          "GET",
          `/items/${createdItemId}`,
          null,
          {
            tags: { name: "VerifyDeletion" },
          }
        );

        check(verifyResponse, {
          "item is deleted (404)": r => r.status === 404,
        });
      });
    }

    // LIST
    group("List Items", () => {
      const listResponse = makeRequest(
        "GET",
        "/items?limit=10&offset=0",
        null,
        {
          tags: { name: "ListItems" },
        }
      );

      const listCheck = check(listResponse, {
        "list status is 200": r => r.status === 200,
        "list returns array": r => {
          try {
            const body = JSON.parse(r.body);
            const items = body.data || body.items || body;
            return Array.isArray(items);
          } catch (e) {
            return false;
          }
        },
        "list has pagination info": r => {
          try {
            const body = JSON.parse(r.body);
            return body.total !== undefined || body.pagination !== undefined;
          } catch (e) {
            return true; // Pagination is optional
          }
        },
      });

      if (!listCheck) {
        errorRate.add(1);
      } else {
        successfulRequests.add(1);
      }
    });

    // SEARCH
    group("Search Items", () => {
      const searchQuery = randomString(3);
      const searchResponse = makeRequest(
        "GET",
        `/items/search?q=${searchQuery}`,
        null,
        {
          tags: { name: "SearchItems" },
        }
      );

      const searchCheck = check(searchResponse, {
        "search status is 200": r => r.status === 200,
        "search returns results": r => {
          try {
            const body = JSON.parse(r.body);
            const results = body.data || body.results || body;
            return Array.isArray(results);
          } catch (e) {
            return false;
          }
        },
      });

      if (!searchCheck) {
        errorRate.add(1);
      } else {
        successfulRequests.add(1);
      }
    });
  });

  // Batch operations
  group("Batch Operations", () => {
    const batchData = Array.from({ length: 5 }, () => generateTestData());

    const batchResponse = makeRequest(
      "POST",
      "/items/batch",
      { items: batchData },
      {
        tags: { name: "BatchCreate" },
      }
    );

    check(batchResponse, {
      "batch create status is 200 or 201": r =>
        r.status === 200 || r.status === 201,
      "batch create returns all items": r => {
        try {
          const body = JSON.parse(r.body);
          const items = body.data || body.items || body;
          return Array.isArray(items) && items.length === batchData.length;
        } catch (e) {
          return false;
        }
      },
    }) || errorRate.add(1);
  });

  sleep(randomIntBetween(1, 3));
}

export function handleSummary(data) {
  const { metrics } = data;

  const summary = {
    timestamp: new Date().toISOString(),
    test_type: "api",
    total_requests: metrics.http_reqs?.values?.count || 0,
    successful_requests: metrics.successful_requests?.values?.count || 0,
    failed_requests: metrics.http_req_failed?.values?.passes || 0,
    api_errors: metrics.api_errors?.values?.rate || 0,
    operation_latencies: {
      create: {
        avg: Math.round(metrics.create_latency?.values?.avg || 0),
        p95: Math.round(metrics.create_latency?.values["p(95)"] || 0),
      },
      read: {
        avg: Math.round(metrics.read_latency?.values?.avg || 0),
        p95: Math.round(metrics.read_latency?.values["p(95)"] || 0),
      },
      update: {
        avg: Math.round(metrics.update_latency?.values?.avg || 0),
        p95: Math.round(metrics.update_latency?.values["p(95)"] || 0),
      },
      delete: {
        avg: Math.round(metrics.delete_latency?.values?.avg || 0),
        p95: Math.round(metrics.delete_latency?.values["p(95)"] || 0),
      },
    },
    thresholds_passed: Object.entries(data.thresholds || {}).every(
      ([, value]) => value.ok
    ),
  };

  return {
    "k6-results/api-test-summary.json": JSON.stringify(summary, null, 2),
    stdout: createApiSummary(summary),
  };
}

function createApiSummary(summary) {
  let text = "\n=== API Test Summary ===\n\n";
  text += `Timestamp: ${summary.timestamp}\n`;
  text += `Total Requests: ${summary.total_requests}\n`;
  text += `Successful Requests: ${summary.successful_requests}\n`;
  text += `Failed Requests: ${summary.failed_requests}\n`;
  text += `API Error Rate: ${(summary.api_errors * 100).toFixed(2)}%\n\n`;

  text += "Operation Latencies:\n";
  Object.entries(summary.operation_latencies).forEach(([op, latency]) => {
    text += `  ${op.toUpperCase()}:\n`;
    text += `    Average: ${latency.avg}ms\n`;
    text += `    95th Percentile: ${latency.p95}ms\n`;
  });

  text += `\nAll Thresholds Passed: ${summary.thresholds_passed ? "✅ YES" : "❌ NO"}\n`;

  return text;
}

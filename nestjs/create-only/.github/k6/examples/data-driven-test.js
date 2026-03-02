/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

import http from "k6/http";
import { check, group } from "k6";
import { SharedArray } from "k6/data";
import papaparse from "https://jslib.k6.io/papaparse/5.1.1/index.js";
import { randomItem } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";

// Load test data from CSV file
const testUsers = new SharedArray("users", function () {
  // In a real scenario, this would load from a CSV file
  // For this example, we'll create sample data
  return [
    { username: "user1", password: "pass1", role: "admin" },
    { username: "user2", password: "pass2", role: "user" },
    { username: "user3", password: "pass3", role: "user" },
    { username: "user4", password: "pass4", role: "moderator" },
    { username: "user5", password: "pass5", role: "user" },
  ];
});

// Load test scenarios from JSON
const testScenarios = new SharedArray("scenarios", function () {
  return [
    {
      name: "Browse Products",
      endpoints: ["/products", "/products/featured", "/products/categories"],
      expectedStatus: 200,
    },
    {
      name: "Search Products",
      endpoints: ["/search?q=laptop", "/search?q=phone", "/search?q=tablet"],
      expectedStatus: 200,
    },
    {
      name: "View Product Details",
      endpoints: ["/products/1", "/products/2", "/products/3"],
      expectedStatus: 200,
    },
    {
      name: "Add to Cart",
      endpoints: ["/cart/add"],
      method: "POST",
      expectedStatus: 201,
    },
  ];
});

// Environment-specific configuration
const environments = {
  dev: {
    baseUrl: "https://dev.example.com",
    timeout: "30s",
    thinkTime: 1,
  },
  staging: {
    baseUrl: "https://staging.example.com",
    timeout: "20s",
    thinkTime: 2,
  },
  production: {
    baseUrl: "https://api.example.com",
    timeout: "10s",
    thinkTime: 3,
  },
};

const ENV = __ENV.K6_ENVIRONMENT || "staging";
const config = environments[ENV];

export const options = {
  scenarios: {
    data_driven: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1m",
      preAllocatedVUs: 10,
      maxVUs: 50,
      stages: [
        { duration: "2m", target: 30 },
        { duration: "5m", target: 30 },
        { duration: "2m", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.1"],
    http_req_duration: [`p(95)<${parseInt(config.timeout) * 100}`],
  },
};

// Helper function to login and get auth token
function authenticateUser(user) {
  const loginResponse = http.post(
    `${config.baseUrl}/auth/login`,
    JSON.stringify({
      username: user.username,
      password: user.password,
    }),
    {
      headers: { "Content-Type": "application/json" },
      timeout: config.timeout,
    }
  );

  if (check(loginResponse, { "login successful": r => r.status === 200 })) {
    const body = JSON.parse(loginResponse.body);
    return body.token || body.access_token;
  }

  return null;
}

export default function () {
  // Select random user and scenario
  const user = randomItem(testUsers);
  const scenario = randomItem(testScenarios);

  // Authenticate if needed
  let authToken = null;
  if (user.role !== "guest") {
    authToken = authenticateUser(user);

    if (!authToken) {
      console.error(`Failed to authenticate user: ${user.username}`);
      return;
    }
  }

  // Execute scenario
  group(`${scenario.name} - ${user.role}`, () => {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": `k6-test/${ENV}`,
    };

    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    scenario.endpoints.forEach(endpoint => {
      const method = scenario.method || "GET";
      const url = `${config.baseUrl}${endpoint}`;

      let response;
      if (method === "POST") {
        // Generate dynamic payload based on endpoint
        const payload = generatePayload(endpoint, user);
        response = http.post(url, JSON.stringify(payload), {
          headers,
          timeout: config.timeout,
        });
      } else {
        response = http.get(url, { headers, timeout: config.timeout });
      }

      check(response, {
        [`${scenario.name} - status is ${scenario.expectedStatus}`]: r =>
          r.status === scenario.expectedStatus,
        "response time acceptable": r =>
          r.timings.duration < parseInt(config.timeout) * 100,
      });

      // Custom validation based on role
      if (user.role === "admin") {
        check(response, {
          "admin data present": r => {
            try {
              const body = JSON.parse(r.body);
              return (
                body.adminData !== undefined || body.permissions !== undefined
              );
            } catch (e) {
              return true; // Skip check if not JSON
            }
          },
        });
      }
    });
  });

  // Dynamic think time based on environment
  sleep(config.thinkTime + Math.random() * 2);
}

// Generate dynamic payload based on endpoint and user
function generatePayload(endpoint, user) {
  if (endpoint.includes("/cart/add")) {
    return {
      productId: Math.floor(Math.random() * 100) + 1,
      quantity: Math.floor(Math.random() * 3) + 1,
      userId: user.username,
    };
  }

  if (endpoint.includes("/order")) {
    return {
      items: [
        {
          productId: Math.floor(Math.random() * 100) + 1,
          quantity: Math.floor(Math.random() * 3) + 1,
        },
      ],
      shippingAddress: {
        street: "123 Test St",
        city: "Test City",
        country: "Test Country",
      },
      paymentMethod: "test_card",
    };
  }

  return {};
}

export function handleSummary(data) {
  const { metrics } = data;

  // Group results by user role
  const roleMetrics = {};
  testUsers.forEach(user => {
    // This is simplified - in reality, you'd parse metrics by tags
    roleMetrics[user.role] = {
      requests: Math.floor(
        (metrics.http_reqs?.values?.count || 0) / testUsers.length
      ),
      errors: Math.floor(
        (metrics.http_req_failed?.values?.passes || 0) / testUsers.length
      ),
    };
  });

  const summary = {
    environment: ENV,
    timestamp: new Date().toISOString(),
    total_requests: metrics.http_reqs?.values?.count || 0,
    failed_requests: metrics.http_req_failed?.values?.passes || 0,
    avg_response_time: Math.round(metrics.http_req_duration?.values?.avg || 0),
    by_role: roleMetrics,
    scenarios_tested: testScenarios.length,
    users_tested: testUsers.length,
  };

  return {
    "k6-results/data-driven-summary.json": JSON.stringify(summary, null, 2),
    stdout: createDataDrivenSummary(summary),
  };
}

function createDataDrivenSummary(summary) {
  let text = "\n=== Data-Driven Test Summary ===\n\n";
  text += `Environment: ${summary.environment}\n`;
  text += `Timestamp: ${summary.timestamp}\n`;
  text += `Scenarios Tested: ${summary.scenarios_tested}\n`;
  text += `Users Tested: ${summary.users_tested}\n\n`;

  text += "Overall Results:\n";
  text += `  Total Requests: ${summary.total_requests}\n`;
  text += `  Failed Requests: ${summary.failed_requests}\n`;
  text += `  Avg Response Time: ${summary.avg_response_time}ms\n\n`;

  text += "Results by Role:\n";
  Object.entries(summary.by_role).forEach(([role, metrics]) => {
    text += `  ${role}:\n`;
    text += `    Requests: ${metrics.requests}\n`;
    text += `    Errors: ${metrics.errors}\n`;
  });

  return text;
}

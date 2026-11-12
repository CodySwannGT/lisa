import http from "k6/http";
import { check } from "k6";

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ["rate==1"], http_req_failed: ["rate==0"] },
};

/**
 * Send one request and evaluate the two independent response checks.
 */
export default function () {
  const response = http.get("http://127.0.0.1:18765/health");
  check(response, {
    "health status": result => result.status === 200,
    "health body": result => result.body === "ok\n",
  });
}

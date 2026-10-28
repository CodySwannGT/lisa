/** Captured refusal/historical outcomes remain evidence, not acceptance verdicts. */
import { describe, expect, it } from "vitest";

import { validateTypedBytes } from "../../../all/copy-overwrite/scripts/lib/completion-proof-content.mjs";

const encoded = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("typed completion attachment structure", () => {
  it.each([
    [
      "cli-output",
      {
        observations: [
          {
            command: ["synthetic-check", "refuse"],
            stdout: "Expected refusal",
            stderr: "",
            exit_code: 2,
          },
        ],
      },
    ],
    [
      "http-transcript",
      {
        request: { method: "HEAD", url: "https://example.invalid/health" },
        response: { status: 200 },
      },
    ],
    [
      "http-transcript",
      {
        request: { method: "DELETE", url: "https://example.invalid/resource" },
        response: { status: 204 },
      },
    ],
    [
      "db-query-output",
      { query: "SELECT id FROM synthetic_fixture WHERE FALSE", rows: [] },
    ],
    [
      "perf-trace",
      {
        methodology: "Clocked synthetic fixture with explicit units",
        measurements: [{ metric: "elapsed", value: 0.1, unit: "ms" }],
      },
    ],
    [
      "state-dump",
      { source: "synthetic-provider", state: { lifecycle: "pending" } },
    ],
    ["deploy-log", { id: 12, status: "completed", conclusion: "failure" }],
    [
      "log-snippet",
      { source: "synthetic-service", lines: ["Actual captured fixture line"] },
    ],
  ])(
    "accepts actual %s capture independently of current gate outcome (variant %#)",
    (kind, value) => {
      expect(() =>
        validateTypedBytes(kind, encoded(value), "synthetic-artifact")
      ).not.toThrow();
    }
  );

  it("retains a named historical RED test log as a valid typed capture", () => {
    const bytes = Buffer.from(
      "FAIL synthetic fixture > refuses a premature write\nTests 3 failed | 1 passed\n"
    );
    expect(() =>
      validateTypedBytes("test-run-log", bytes, "historical-red")
    ).not.toThrow();
  });

  it("checks actual image headers instead of trusting a screenshot filename", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pAAAAABJRU5ErkJggg==",
      "base64"
    );
    expect(() =>
      validateTypedBytes("screenshot", png, "synthetic-pixel")
    ).not.toThrow();
    expect(() =>
      validateTypedBytes(
        "screenshot",
        Buffer.from("screenshot.png"),
        "fake-extension"
      )
    ).toThrow();
  });

  it.each([
    "cli-output",
    "test-run-log",
    "perf-trace",
    "recording",
    "deploy-log",
    "state-dump",
  ])("rejects status-only %s without actual capture structure", kind => {
    expect(() =>
      validateTypedBytes(kind, encoded({ status: "pass" }), "status-only")
    ).toThrow();
  });
});

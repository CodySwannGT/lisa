/**
 * Pins the typed-capture examples in the completion-proof contract to the real
 * validator (CodySwannGT/lisa#4698).
 *
 * The validator deliberately refuses plain-text captures for the structured
 * evidence kinds (608cbc6670, #4543), but the contract never said what shape
 * those kinds need, so authors met the refusal with no way to satisfy it. The
 * contract now carries one example per kind, each tagged with an HTML comment
 * `<!-- capture-example: <kind> -->` directly above its fenced block. This test
 * extracts those examples and runs them through `validateTypedBytes`, so a
 * documented shape that stops passing (or a kind that loses its example) fails
 * here instead of in someone's completion pass. It also asserts the plain-text
 * form of every structured kind is still refused, so the guard cannot be quietly
 * relaxed to make the docs "work".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { validateTypedBytes } from "../../../all/copy-overwrite/scripts/lib/completion-proof-content.mjs";

const CONTRACT = path.resolve(
  __dirname,
  "../../../plugins/src/base/skills/lisa-tracker-evidence/references/completion-authorization.md"
);

const HTTP = "http-transcript";

/** Kinds whose capture must be structured JSON (plain text is refused). */
const JSON_KINDS = [
  HTTP,
  "db-query-output",
  "state-dump",
  "cli-output",
  "deploy-log",
  "perf-trace",
] as const;

/** Kinds that accept a plain-text capture. */
const TEST_RUN = "test-run-log";
const LOG = "log-snippet";
const TEXT_KINDS = [TEST_RUN, LOG] as const;

/** The plain-text form an author would naturally capture for each JSON kind. */
const PLAIN_TEXT: Record<(typeof JSON_KINDS)[number], string> = {
  [HTTP]: [
    "$ curl -i https://example.invalid/health",
    "HTTP/1.1 200 OK",
    "content-type: application/json",
    "",
    '{"ok":true}',
  ].join("\n"),
  "db-query-output": [
    "SELECT id, status FROM orders WHERE id = 42;",
    " id | status",
    "----+---------",
    " 42 | shipped",
    "(1 row)",
  ].join("\n"),
  "state-dump": "order 42 status=shipped (read from orders service)",
  "cli-output": "$ synthetic-check --strict\nall checks passed\nexit code: 0",
  "deploy-log": "deploy finished; health check healthy; release v1.2.3 live",
  "perf-trace": "p95 latency 120 ms over 500 requests on staging",
};

/** Extract every `<!-- capture-example: kind -->` fenced block from the doc. */
function captureExamples(markdown: string): Map<string, string> {
  const pattern =
    /<!--\s*capture-example:\s*([a-z-]+)\s*-->\s*\n```[a-z]*\n([\s\S]*?)\n```/g;
  return new Map(
    [...markdown.matchAll(pattern)].map(
      ([, kind, body]) => [kind ?? "", body ?? ""] as const
    )
  );
}

const contract = readFileSync(CONTRACT, "utf8");
const examples = captureExamples(contract);

/** Validate one in-memory capture, serializing non-string values as JSON. */
const check = (kind: string, value: unknown) => () =>
  validateTypedBytes(
    kind,
    Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
    kind
  );

/** Wrap a value in `levels` nested `{ inner: ... }` objects. */
const nest = (value: unknown, levels: number): unknown =>
  Array.from({ length: levels }).reduce<unknown>(inner => ({ inner }), value);

const HTTP_REQUEST = { method: "GET", url: "https://example.invalid/health" };

describe("completion-proof contract typed capture examples", () => {
  it("has no duplicate or unparsed capture-example tags", () => {
    const tags = contract.match(/<!--\s*capture-example:/g) ?? [];
    expect(tags).toHaveLength(examples.size);
  });

  it("documents an example for every structured and text kind", () => {
    const byName = (a: string, b: string) => a.localeCompare(b);
    expect([...examples.keys()].sort(byName)).toEqual(
      [...JSON_KINDS, ...TEXT_KINDS].sort(byName)
    );
  });

  it.each(JSON_KINDS)(
    "the documented %s example is JSON the validator accepts",
    kind => {
      const example = examples.get(kind);
      expect(example, `no capture-example for ${kind}`).toBeDefined();
      expect(() => JSON.parse(example ?? "")).not.toThrow();
      expect(() =>
        validateTypedBytes(kind, Buffer.from(example ?? ""), kind)
      ).not.toThrow();
    }
  );

  it.each(TEXT_KINDS)(
    "the documented %s example is plain text the validator accepts",
    kind => {
      const example = examples.get(kind);
      expect(example, `no capture-example for ${kind}`).toBeDefined();
      expect(() =>
        validateTypedBytes(kind, Buffer.from(example ?? ""), kind)
      ).not.toThrow();
    }
  );

  it.each(JSON_KINDS)("still refuses a plain-text %s capture", kind => {
    expect(() =>
      validateTypedBytes(kind, Buffer.from(PLAIN_TEXT[kind]), kind)
    ).toThrow(`does not contain actual ${kind} capture structure`);
  });

  it("accepts a wrapper that carries raw text and provenance beside the typed object", () => {
    const http = JSON.parse(examples.get(HTTP) ?? "null");
    const wrapped = {
      raw: PLAIN_TEXT[HTTP],
      provenance: { command: "curl -i https://example.invalid/health" },
      capture: http,
    };
    expect(() =>
      validateTypedBytes(HTTP, Buffer.from(JSON.stringify(wrapped)), "wrapped")
    ).not.toThrow();
  });

  it.each([
    [
      "http-transcript with status 204 and no body",
      HTTP,
      { request: HTTP_REQUEST, response: { status: 204 } },
    ],
    [
      "db-query-output with an empty rows list",
      "db-query-output",
      { query: "SELECT id FROM orders WHERE FALSE", rows: [] },
    ],
    [
      "a typed object nested 12 levels deep",
      HTTP,
      nest({ request: HTTP_REQUEST, response: { status: 204 } }, 12),
    ],
    [
      "a TAP test-run-log",
      TEST_RUN,
      "TAP version 13\nok 1 - health returns 200\n# pass 1\n# fail 0",
    ],
    [
      "a log-snippet with a space between date and time",
      LOG,
      "2026-11-13 08:00:01 INFO orders ready",
    ],
  ])("accepts the documented edge case: %s", (_label, kind, value) => {
    expect(check(kind, value)).not.toThrow();
  });

  it.each([
    [
      "http-transcript with status 200 and no body",
      HTTP,
      { request: HTTP_REQUEST, response: { status: 200 } },
    ],
    [
      "state-dump with only state and no provenance",
      "state-dump",
      { state: { id: 42, status: "shipped" } },
    ],
    [
      "cli-output whose exit_code is a string",
      "cli-output",
      { command: "bun run check", stdout: "ok", stderr: "", exit_code: "0" },
    ],
    [
      "deploy-log written as a state-dump",
      "deploy-log",
      { source: "deploy pipeline", state: { deployed: true } },
    ],
    [
      "a typed object nested 13 levels deep",
      HTTP,
      nest({ request: HTTP_REQUEST, response: { status: 204 } }, 13),
    ],
    [
      "a test-run-log whose only count is zero",
      TEST_RUN,
      " ✓ health > returns 200\n Tests  0 passed (0)",
    ],
    [
      "a log-snippet with a syslog-style timestamp",
      LOG,
      "Nov 13 08:00:01 host orders: ready",
    ],
    [
      "a log-snippet with an epoch timestamp",
      LOG,
      "1763020801 INFO orders ready",
    ],
  ])("refuses the documented edge case: %s", (_label, kind, value) => {
    expect(check(kind, value)).toThrow(
      `does not contain actual ${kind} capture structure`
    );
  });
});

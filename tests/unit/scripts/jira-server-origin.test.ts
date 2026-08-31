/**
 * Credential trust keys must name exactly one canonical HTTPS origin.
 *
 * The trust key is also the request base, so anything the key silently discards
 * is a component the request would carry but validation never approved. That is
 * why the accepted grammar is root-only: userinfo, a query, a fragment, or any
 * path is rejected outright rather than normalized away.
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const PARSER = path.resolve(
  "plugins/src/base/skills/lisa-jira-journey/scripts/parse-plan.py"
);
const JIRA_ORIGIN = "https://jira.example";
const JIRA_ORIGIN_PORT = "https://jira.example:8443";

const ORIGIN_PROGRAM = [
  "import importlib.util, json, sys",
  "spec = importlib.util.spec_from_file_location('parse_plan', sys.argv[1])",
  "module = importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(module)",
  "print(json.dumps([module.server_origin(value) for value in sys.argv[2:]]))",
].join("; ");

/**
 * Normalize a batch of configured server values through the parser.
 * @param values Configured server strings to normalize.
 * @returns One canonical origin per input, empty string where rejected.
 */
function serverOrigins(values: readonly string[]): readonly string[] {
  const result = boundedSpawnSync({
    args: ["-c", ORIGIN_PROGRAM, PARSER, ...values],
    command: "python3",
    label: "parse Jira server origins",
  });

  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as readonly string[];
}

describe("jira journey server origin", () => {
  it("rejects port zero while preserving valid HTTPS origins", () => {
    expect(
      serverOrigins([
        "https://jira.example:0",
        JIRA_ORIGIN,
        "https://jira.example:443",
        JIRA_ORIGIN_PORT,
      ])
    ).toEqual(["", JIRA_ORIGIN, JIRA_ORIGIN, JIRA_ORIGIN_PORT]);
  });

  it("canonicalizes the accepted root-only HTTPS forms", () => {
    expect(
      serverOrigins([
        JIRA_ORIGIN,
        "https://jira.example/",
        "https://jira.example:443/",
        "HTTPS://JIRA.EXAMPLE",
        "https://jira.example:8443/",
        "https://192.0.2.10",
        "https://192.0.2.10:8443",
        "https://[2001:db8::1]",
        "https://[2001:db8::1]:8443",
      ])
    ).toEqual([
      JIRA_ORIGIN,
      JIRA_ORIGIN,
      JIRA_ORIGIN,
      JIRA_ORIGIN,
      JIRA_ORIGIN_PORT,
      "https://192.0.2.10",
      "https://192.0.2.10:8443",
      "https://[2001:db8::1]",
      "https://[2001:db8::1]:8443",
    ]);
  });

  it("rejects userinfo rather than normalizing it away", () => {
    expect(
      serverOrigins([
        "https://operator:token@jira.example",
        "https://operator@jira.example",
        "https://@jira.example",
        "https://operator:token@jira.example/",
      ])
    ).toEqual(["", "", "", ""]);
  });

  it("rejects query and fragment delimiters even when they carry nothing", () => {
    expect(
      serverOrigins([
        "https://jira.example?",
        "https://jira.example?redirect=elsewhere.example",
        "https://jira.example#",
        "https://jira.example#section",
        "https://jira.example/?redirect=elsewhere.example",
      ])
    ).toEqual(["", "", "", "", ""]);
  });

  it("rejects every path form other than empty or a single slash", () => {
    expect(
      serverOrigins([
        "https://jira.example/jira",
        "https://jira.example/jira/",
        "https://jira.example//",
        "https://jira.example/.",
        "https://jira.example/..",
        "https://jira.example/./",
        "https://jira.example/%2e",
        "https://jira.example:8443/jira",
      ])
    ).toEqual(["", "", "", "", "", "", "", ""]);
  });

  it("rejects hostnames outside the ASCII DNS, IPv4 and bracketed IPv6 forms", () => {
    expect(
      serverOrigins([
        "https://jira.example.",
        "https://jira.exa%6dple",
        "https://jira.exämple",
        "https://jira..example",
        "https://-jira.example",
        "https://jira.example-",
        "https://",
        "https://[2001:db8::1",
        "https://[not-an-address]",
      ])
    ).toEqual(["", "", "", "", "", "", "", "", ""]);
  });

  it("rejects surrounding whitespace and control characters", () => {
    expect(
      serverOrigins([
        ` ${JIRA_ORIGIN}`,
        `${JIRA_ORIGIN} `,
        `${JIRA_ORIGIN}\t`,
        `${JIRA_ORIGIN}\n`,
        "https://jira\t.example",
      ])
    ).toEqual(["", "", "", "", ""]);
  });

  it("rejects non-HTTPS schemes, missing schemes and out-of-range ports", () => {
    expect(
      serverOrigins([
        "http://jira.example",
        "ftp://jira.example",
        "jira.example",
        "//jira.example",
        "https://jira.example:99999",
        "https://jira.example:-1",
        "https://jira.example:https",
        "",
      ])
    ).toEqual(["", "", "", "", "", "", "", ""]);
  });
});

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const VALIDATE_SCRIPT = path.resolve(
  "plugins/src/wiki/scripts/validate-config.mjs"
);
const LINT_SCRIPT = path.resolve("plugins/src/wiki/scripts/lint-wiki.mjs");

let fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures) {
    rmSync(fixture, { recursive: true, force: true });
  }
  fixtures = [];
});

/**
 * Creates a minimal wiki tree for redaction policy script tests.
 *
 * @returns Paths for the temporary repo, wiki root, and config file.
 */
function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-wiki-redaction-"));
  const wikiRoot = path.join(root, "wiki");
  const configPath = path.join(wikiRoot, "lisa-wiki.config.json");

  fixtures.push(root);
  mkdirSync(path.join(wikiRoot, "schema"), { recursive: true });
  mkdirSync(path.join(wikiRoot, "sources"), { recursive: true });
  mkdirSync(path.join(wikiRoot, "state"), { recursive: true });
  mkdirSync(path.join(wikiRoot, "concepts"), { recursive: true });
  writeFileSync(path.join(wikiRoot, "index.md"), "# Index\n");
  writeFileSync(path.join(wikiRoot, "start-here.md"), "# Start here\n");
  writeFileSync(
    path.join(wikiRoot, "schema", "llm-wiki-contract.md"),
    "# Contract\n"
  );
  writeFileSync(
    path.join(wikiRoot, "log.md"),
    "| Date | Operation |\n| 2026-06-06 | test |\n"
  );
  return {
    root,
    wikiRoot,
    configPath,
  };
}

/**
 * Writes a valid wiki config with a caller-provided redaction policy.
 *
 * @param configPath Path to the fixture config file.
 * @param redaction Redaction policy object to place under sensitivity.
 */
function writeConfig(configPath: string, redaction: Record<string, unknown>) {
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        org: "Fixture",
        mode: "embedded",
        wikiRoot: "wiki",
        frontmatter: false,
        categories: ["concepts"],
        sensitivity: {
          enabled: true,
          default: "internal",
          redaction,
        },
        sourceRetention: "sanitized-note-only",
      },
      null,
      2
    )}\n`
  );
}

/**
 * Runs a Node script inside a fixture directory.
 *
 * @param script Absolute script path to execute.
 * @param args CLI arguments for the script.
 * @param cwd Working directory for the child process.
 * @returns The completed child-process result.
 */
function runNode(script: string, args: string[], cwd: string) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
  });
}

describe("wiki redaction policy config (#1170)", () => {
  // Test hardened to kill mutant M001 (Risk Factor: Data security / compliance).
  it("validates scanner selection, entity allowlists, and fail-closed review fields", () => {
    const fixture = makeFixture();
    writeConfig(fixture.configPath, {
      enabled: true,
      scanners: ["builtin"],
      failClosed: true,
      requireReview: true,
      allowedEntities: ["api_key"],
      blockedEntities: ["ssn", "private_key"],
    });

    const result = runNode(VALIDATE_SCRIPT, [fixture.configPath], fixture.root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("is valid");
  });

  // Test hardened to kill mutant M002 (Risk Factor: Data security / compliance).
  it("rejects unknown scanners and entity names", () => {
    const fixture = makeFixture();
    writeConfig(fixture.configPath, {
      enabled: true,
      scanners: ["external-dlp"],
      failClosed: true,
      requireReview: true,
      blockedEntities: ["unknown-secret"],
    });

    const result = runNode(VALIDATE_SCRIPT, [fixture.configPath], fixture.root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sensitivity.redaction.scanners[]");
    expect(result.stderr).toContain("sensitivity.redaction.blockedEntities[]");
  });

  // Test hardened to kill mutant M003 (Risk Factor: Data security / compliance).
  it("rejects unknown redaction policy keys without crashing on wrong shapes", () => {
    const fixture = makeFixture();
    writeConfig(fixture.configPath, {
      enabled: true,
      scanners: { builtin: true },
      failClose: true,
      failClosed: true,
      requireReview: true,
      blockedEntites: ["ssn"],
      blockedEntities: { ssn: true },
    });

    const result = runNode(VALIDATE_SCRIPT, [fixture.configPath], fixture.root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sensitivity.redaction.failClose");
    expect(result.stderr).toContain("sensitivity.redaction.blockedEntites");
    expect(result.stderr).toContain("sensitivity.redaction.scanners");
    expect(result.stderr).toContain("sensitivity.redaction.blockedEntities");
    expect(result.stderr).not.toContain("TypeError");
  });

  // Test hardened to kill mutant M004 (Risk Factor: Data security / compliance).
  it("rejects unknown sensitivity policy keys", () => {
    const fixture = makeFixture();
    writeFileSync(
      fixture.configPath,
      `${JSON.stringify(
        {
          schemaVersion: "1.0.0",
          org: "Fixture",
          mode: "embedded",
          wikiRoot: "wiki",
          frontmatter: false,
          categories: ["concepts"],
          sensitivity: {
            enabled: true,
            default: "internal",
            redactoin: {
              enabled: false,
            },
          },
          sourceRetention: "sanitized-note-only",
        },
        null,
        2
      )}\n`
    );

    const result = runNode(VALIDATE_SCRIPT, [fixture.configPath], fixture.root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sensitivity.redactoin");
  });

  // Test hardened to kill mutant M005 (Risk Factor: Data security / compliance).
  it("fails closed when required scanners are unavailable", () => {
    const fixture = makeFixture();
    writeConfig(fixture.configPath, {
      enabled: true,
      scanners: ["presidio"],
      failClosed: true,
      requireReview: true,
      blockedEntities: ["ssn"],
    });

    const result = runNode(
      LINT_SCRIPT,
      ["--wiki", "wiki", "--config", fixture.configPath, "--json"],
      fixture.root
    );

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.items).toContainEqual(
      expect.objectContaining({
        group: "redaction-policy",
        id: "scanner-unavailable",
        status: "FAIL",
      })
    );
  });

  // Test hardened to kill mutant M006 (Risk Factor: Data security / compliance).
  it("fails when local config weakens committed redaction policy", () => {
    const fixture = makeFixture();
    writeConfig(fixture.configPath, {
      enabled: true,
      scanners: ["builtin"],
      failClosed: true,
      requireReview: true,
      blockedEntities: ["ssn"],
    });
    writeFileSync(
      path.join(fixture.wikiRoot, "lisa-wiki.config.local.json"),
      `${JSON.stringify(
        {
          sensitivity: {
            redaction: {
              enabled: false,
              failClosed: false,
              requireReview: false,
            },
          },
        },
        null,
        2
      )}\n`
    );

    const result = runNode(
      LINT_SCRIPT,
      ["--wiki", "wiki", "--config", fixture.configPath, "--json"],
      fixture.root
    );

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    const messages = report.items
      .filter(
        (item: { group?: string; id?: string; status?: string }) =>
          item.group === "redaction-policy" &&
          item.id === "unsafe-local-override" &&
          item.status === "FAIL"
      )
      .map((item: { message: string }) => item.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        "local config disables committed redaction policy",
        "local config disables committed redaction fail-closed policy",
        "local config disables committed redaction review requirement",
      ])
    );
  });

  // Test hardened to kill mutant M007 (Risk Factor: Data security / compliance).
  it("fails when local config downgrades scanners or entity policies", () => {
    const fixture = makeFixture();
    writeConfig(fixture.configPath, {
      enabled: true,
      scanners: ["builtin"],
      failClosed: true,
      requireReview: true,
      allowedEntities: ["api_key"],
      blockedEntities: ["ssn", "private_key"],
    });
    writeFileSync(
      path.join(fixture.wikiRoot, "lisa-wiki.config.local.json"),
      `${JSON.stringify(
        {
          sensitivity: {
            redaction: {
              scanners: [],
              allowedEntities: ["api_key", "oauth_token"],
              blockedEntities: ["ssn"],
            },
          },
        },
        null,
        2
      )}\n`
    );

    const result = runNode(
      LINT_SCRIPT,
      ["--wiki", "wiki", "--config", fixture.configPath, "--json"],
      fixture.root
    );

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    const messages = report.items
      .filter((item: { id: string }) => item.id === "unsafe-local-override")
      .map((item: { message: string }) => item.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        "local config removes committed redaction scanners",
        "local config expands committed redaction allowed entities",
        "local config removes committed redaction blocked entities",
      ])
    );
  });
});

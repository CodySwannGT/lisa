/**
 * Shared fixtures, constants, and helpers for the plugin-routing-validate unit
 * tests. Extracted from the test file to keep it under the max-lines budget and
 * to centralize repeated literals (mirrors `plugin-parity-drift-helpers.ts`).
 *
 * @module tests/unit/scripts/plugin-routing-validate-helpers
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import process from "node:process";

export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "plugin-routing-validate.mjs"
);
export const FIXTURE_ROOT = path.join(REPO_ROOT, "parity/fixtures/routing");
export const FIXTURE_CACHE = path.join(FIXTURE_ROOT, "cache");
export const VALID_DIR = path.join(FIXTURE_ROOT, "valid");
export const INVALID_DIR = path.join(FIXTURE_ROOT, "invalid");
export const ABSENT_DIR = path.join(FIXTURE_ROOT, "does-not-exist");

export const ROUTING_DIR_FLAG = "--routing-dir";
export const CACHE_FLAG = "--cache-root";
export const DEMO_MKT = "demo-marketplace";
export const PLUGIN_NAME = "has-manifest";
export const PLUGIN_ID = `${PLUGIN_NAME}@${DEMO_MKT}`;
export const VERSION = "1.2.3";
export const STAMP_ACTION = `scaffold Lisa-native skill stamped synced-from: ${PLUGIN_ID}@${VERSION}`;

/** A single per-file validation result. */
export interface FileResult {
  readonly file: string;
  readonly errors: readonly string[];
}

/** The machine-readable routing-validation report. */
export interface RoutingReport {
  readonly schemaVersion: number;
  readonly summary: {
    readonly scanned: number;
    readonly valid: number;
    readonly invalid: number;
  };
  readonly results: readonly FileResult[];
}

/**
 * Run the validator script and capture stdout + exit code. `execFileSync`
 * throws on a non-zero exit, exposing `status` and `stdout` on the error.
 *
 * @param args - CLI arguments after the script path.
 * @returns The exit code and parsed JSON report (empty when no stdout).
 */
export function runValidate(args: readonly string[]): {
  code: number;
  report: RoutingReport;
} {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
    });
    return { code: 0, report: JSON.parse(stdout) as RoutingReport };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    const stdout = e.stdout ?? "";
    return {
      code: typeof e.status === "number" ? e.status : -1,
      report: (stdout.trim() === ""
        ? {
            schemaVersion: 1,
            summary: { scanned: 0, valid: 0, invalid: 0 },
            results: [],
          }
        : JSON.parse(stdout)) as RoutingReport,
    };
  }
}

/** The validation context shape consumed by validateArtifact. */
export interface ValidateContext {
  readonly filename?: string;
  readonly cacheMax: string | null;
  readonly mdExists: boolean;
}

/** One agent's routing entry (mutable, so tests can trip a single gate). */
export interface RoutingEntry {
  outcome: unknown;
  actions: unknown;
  rationale: unknown;
}

/** A mutable routing artifact for gate tests. */
export interface Artifact {
  schemaVersion: unknown;
  plugin: unknown;
  pluginName: unknown;
  marketplace: unknown;
  upstreamVersion: unknown;
  analyzedAt: unknown;
  status: unknown;
  components: unknown[];
  routing: Record<string, RoutingEntry>;
}

/**
 * The default context for a valid artifact (cache resolves to VERSION, paired
 * `.md` present, filename matches the canonical id).
 *
 * @returns A fresh valid context.
 */
export function baseContext(): ValidateContext {
  return { cacheMax: VERSION, filename: `${PLUGIN_ID}.json`, mdExists: true };
}

/**
 * Build a fresh, fully-valid routing artifact object (new object each call so
 * per-test mutations never leak). Tests mutate one field to exercise one gate.
 *
 * @returns A valid artifact object.
 */
export function baseArtifact(): Artifact {
  const reimplement = (): RoutingEntry => ({
    outcome: "reimplement",
    actions: [STAMP_ACTION],
    rationale: "no equivalent plugin surface; reimplement as a Lisa skill",
  });
  return {
    schemaVersion: 1,
    plugin: PLUGIN_ID,
    pluginName: PLUGIN_NAME,
    marketplace: DEMO_MKT,
    upstreamVersion: VERSION,
    analyzedAt: "2026-05-30",
    status: "proposed",
    components: [
      {
        kind: "agent",
        id: PLUGIN_NAME,
        path: "agents/has-manifest.md",
        classification: "claude-agent",
        notes: "valid fixture component",
      },
    ],
    routing: {
      codex: reimplement(),
      cursor: {
        outcome: "claude-only",
        actions: [],
        rationale: "Cursor reads .claude-plugin/ natively",
      },
      agy: reimplement(),
      copilot: {
        outcome: "enable-vendor-equivalent",
        actions: [
          `enable the vendor's native agent equivalent for ${PLUGIN_NAME}`,
        ],
        rationale: "vendor ships a comparable capability",
      },
    },
  };
}

/**
 * Build a multi-kind (mcp + command) artifact for the coverage gate. codex + agy
 * cover both groups via the kind keywords; cursor stays claude-only (exempt);
 * copilot's actions are caller-supplied to exercise coverage. upstream is
 * "unknown" so no `synced-from` stamp is owed.
 *
 * @param copilotActions - copilot's action list.
 * @returns A multi-kind artifact.
 */
export function multiKind(copilotActions: readonly string[]): Artifact {
  const rePoint = (actions: readonly string[]): RoutingEntry => ({
    outcome: "re-point-mcp-lsp",
    actions: [...actions],
    rationale: "coverage fixture",
  });
  const coverBoth = ["re-point the mcp server and emit the command"];
  const base = baseArtifact();
  return {
    ...base,
    upstreamVersion: "unknown",
    components: [
      {
        kind: "mcp",
        id: "demo-mcp",
        path: ".mcp.json",
        classification: "mcp-server",
        notes: "",
      },
      {
        kind: "command",
        id: "demo-cmd",
        path: "commands/lisa/demo.md",
        classification: "claude-command",
        notes: "",
      },
    ],
    routing: {
      ...base.routing,
      codex: rePoint(coverBoth),
      agy: rePoint(coverBoth),
      copilot: rePoint(copilotActions),
    },
  };
}

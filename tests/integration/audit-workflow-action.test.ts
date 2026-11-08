/**
 * Exercise the actual workflow-owned runner against an older caller that has
 * neither the new script nor the ./audit export. Controlled transport fixtures
 * are not live advisory evidence. Dependency symlinks isolate loader behavior;
 * the action's exact npm-ci installation is proved separately in delivery.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { createAuditActionCheckout } from "../helpers/audit-action-fixture.js";
import { ensurePinnedRevision } from "../helpers/pinned-revision.js";
import { stepsIn } from "./quality-gate-facade-fixture.js";

useIoLatencyBudget();
const ACTION = ".github/actions/dependency-audit";
const PACKAGE_JSON = "package.json";
const roots: string[] = [];
const DEPS = [
  "esbuild",
  "semver",
  "jsonc-parser",
  "js-yaml",
  "@yarnpkg/lockfile",
];
const GHSA = "GHSA-aaaa-bbbb-cccc";
const DEV = "lint-tool/zod";

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Copy the real canonical source and runner without any caller-installed Lisa dependency.
 * @returns Isolated action checkout and older host paths
 */
function actionFixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-audit-workflow-"));
  const action = createAuditActionCheckout(root);
  const host = path.join(root, "older-caller");
  roots.push(root);
  fs.mkdirSync(path.join(host, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(host, PACKAGE_JSON),
    JSON.stringify({
      name: "controlled-older-audit-host",
      type: "module",
      dependencies: { "@codyswann/lisa": "4.69.1" },
    })
  );
  fs.writeFileSync(
    path.join(host, "bin/bun"),
    '#!/bin/sh\ncat "$AUDIT_FIXTURE_REPORT"\nexit 1\n',
    { mode: 0o755 }
  );
  return { root, action, host };
}

/**
 * Run the action's real bundler and live runner on controlled report/lock inputs.
 * @param kind - Covered or uncovered dependency-copy scenario
 * @returns The runner's terminal status and output
 */
function observe(kind: string) {
  const fixture = actionFixture();
  const packages = {
    [DEV]: ["zod@3.25.76"],
    zod: ["zod@4.6.7"],
    ...(kind === "alias" ? { "legacy-zod": ["zod@3.25.76"] } : {}),
  };
  const report = JSON.stringify({
    zod: [
      {
        severity: "high",
        url: `https://github.com/advisories/${GHSA}`,
        vulnerable_versions: "<4.6.6",
      },
    ],
  });
  fs.writeFileSync(
    path.join(fixture.host, "bun.lock"),
    kind === "malformed" ? "broken {{{" : JSON.stringify({ packages })
  );
  fs.writeFileSync(
    path.join(fixture.host, "audit.ignore.local.json"),
    JSON.stringify({
      exclusions: [
        {
          id: GHSA,
          package: "zod",
          versions: "3.x",
          paths: [DEV],
          reason: "Controlled lint-tool fixture",
        },
      ],
    })
  );
  fs.writeFileSync(path.join(fixture.host, "report.json"), report);
  return executeAction(fixture);
}

/**
 * Execute the prepared real action runner with controlled transport.
 * @param fixture - Prepared action checkout and caller
 * @returns The terminal process status and observed output
 */
function executeAction(fixture: ReturnType<typeof actionFixture>) {
  const result = boundedSpawnSync({
    label: "workflow-owned audit on older caller",
    command: process.execPath,
    args: [path.join(fixture.action, "run.mjs")],
    cwd: fixture.host,
    env: {
      ...process.env,
      GITHUB_WORKSPACE: fixture.host,
      LISA_AUDIT_ACTION_DIRECTORY: ".",
      LISA_AUDIT_ACTION_MANAGER: "bun",
      AUDIT_FIXTURE_REPORT: path.join(fixture.host, "report.json"),
      PATH: `${path.join(fixture.host, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      LISA_AUDIT_RETRY_DELAY: "0",
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("workflow-owned canonical audit on an older caller", () => {
  it("pins the exact canonical implementation and isolated runtime source being tested", () => {
    const audit = stepsIn("npm_security_scan").find(
      step => step.name === "🔒 Run security audit"
    );
    const revision = /@([0-9a-f]{40})$/u.exec(audit?.uses ?? "")?.[1];
    if (revision === undefined)
      throw new Error(
        "Audit action is not pinned to an immutable source commit"
      );
    // Hosted CI checks out at depth 1; fetch the pinned ancestor by SHA there.
    expect(
      ensurePinnedRevision(revision),
      `Pinned commit ${revision} is not on the remote`
    ).not.toBe("unavailable");
    const files = [
      ...fs
        .readdirSync("src/core")
        .filter(file => /^audit[-.]/u.test(file) && file.endsWith(".ts"))
        .map(file => `src/core/${file}`),
      ...["action.yml", "run.mjs", PACKAGE_JSON, "package-lock.json"].map(
        file => `${ACTION}/${file}`
      ),
    ];
    for (const file of files) {
      const pinned = boundedSpawnSync({
        label: "read pinned canonical audit source",
        command: "git",
        args: ["show", `${revision}:${file}`],
      });
      expect(
        pinned.status,
        `Pinned source unavailable: ${revision}:${file}`
      ).toBe(0);
      expect(
        pinned.stdout,
        `Refresh the immutable audit action source pin after changing ${file}`
      ).toBe(fs.readFileSync(file, "utf8"));
    }
  });
  it("passes covered copies without the caller's adapter or ./audit export", () => {
    const result = observe("covered");
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain(`excluded ${GHSA} for ${DEV}`);
  });
  it("fails and names an uncovered npm alias through the action's bundled matcher", () => {
    const result = observe("alias");
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("legacy-zod");
  });
  it("fails closed on malformed caller lock data without loading caller dependencies", () => {
    const result = observe("malformed");
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("Cannot parse bun.lock");
  });
  it("installs action-owned exact dependencies and bundles the one canonical source", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ACTION, PACKAGE_JSON), "utf8")
    );
    const source = fs.readFileSync(path.join(ACTION, "run.mjs"), "utf8");
    expect(
      Object.keys(manifest.dependencies).sort((a, b) => a.localeCompare(b))
    ).toEqual([...DEPS].sort((a, b) => a.localeCompare(b)));
    expect(
      Object.values(manifest.dependencies).every(
        value => typeof value === "string" && /^\d+\.\d+\.\d+$/u.test(value)
      )
    ).toBe(true);
    expect(fs.readFileSync(path.join(ACTION, "action.yml"), "utf8")).toContain(
      // No dependency lifecycle script runs inside the caller's CI job; the
      // bundler's platform binary arrives as an optional dependency.
      'npm ci --ignore-scripts --prefix "$GITHUB_ACTION_PATH"'
    );
    expect(source).toContain("../../../src/core/audit.ts");
    expect(source).toContain('nodePaths: [join(actionRoot, "node_modules")]');
    expect(source).toContain("Audit bundle retained an external dependency");
    expect(fs.existsSync(path.join(ACTION, "dist"))).toBe(false);
  });
});

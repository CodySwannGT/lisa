/** Browser-level proof for the deterministic `lisa ui` Health v1 consumer. */
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { runHealthCli } from "../../src/cli/health-cmd.ts";
import {
  runUi,
  type LisaVersionValue,
  type ProbeResult,
  type StatusProbe,
} from "../../src/cli/ui-cmd.ts";
import type { UiHealthDependencies } from "../../src/cli/ui-health.ts";
import type {
  HealthResult,
  PersistedHealthRun,
} from "../../src/health/index.ts";

interface LiveConsole {
  readonly base: string;
  readonly close: () => Promise<void>;
}

const createdDirs: string[] = [];
const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const builtCli = path.join(repositoryRoot, "dist", "index.js");

/** Run one built public Lisa command without the unrelated update probe. */
async function runBuiltLisa(
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv } = {}
): Promise<string> {
  const completed = await execFileAsync(
    process.execPath,
    [builtCli, "--no-update-check", ...args],
    {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      maxBuffer: 16 * 1024 * 1024,
    }
  );
  return completed.stdout;
}

/** Launch the built long-running UI command and resolve its bound origin. */
async function launchBuiltConsole(projectDir: string): Promise<LiveConsole> {
  const child = spawn(
    process.execPath,
    [
      builtCli,
      "--no-update-check",
      "ui",
      projectDir,
      "--port",
      "0",
      "--no-sync",
    ],
    { cwd: repositoryRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
  );
  let output = "";
  const base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Built lisa ui did not start: ${output}`)),
      20_000
    );
    const inspect = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", code => {
      clearTimeout(timer);
      reject(new Error(`Built lisa ui exited ${code}: ${output}`));
    });
  });
  return {
    base,
    close: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>(resolve => child.once("exit", () => resolve()));
    },
  };
}

/** Create a real, initially in-band host using only the built public CLI. */
async function createBuiltHost(): Promise<string> {
  const projectDir = await mkdtemp(
    path.join(tmpdir(), "lisa-ui-health-built-e2e-")
  );
  createdDirs.push(projectDir);
  await Promise.all([
    writeFile(
      path.join(projectDir, "package.json"),
      `${JSON.stringify({ name: "lisa-ui-health-built-e2e", private: true, devDependencies: { typescript: "latest" } }, null, 2)}\n`
    ),
    writeFile(path.join(projectDir, "tsconfig.json"), "{}\n"),
    writeFile(
      path.join(projectDir, ".lisa.config.json"),
      `${JSON.stringify({ harness: "codex", tracker: "github", github: { org: "example", repo: "lisa-ui-health-built-e2e" } }, null, 2)}\n`
    ),
  ]);
  await execFileAsync("git", ["init", "-q"], { cwd: projectDir });
  await execFileAsync("git", ["config", "user.name", "Lisa"], {
    cwd: projectDir,
  });
  await execFileAsync("git", ["config", "user.email", "lisa@example.test"], {
    cwd: projectDir,
  });
  await execFileAsync("git", ["add", "."], { cwd: projectDir });
  await execFileAsync("git", ["commit", "-qm", "initial fixture"], {
    cwd: projectDir,
  });
  await runBuiltLisa(["apply", projectDir, "-y"], {
    env: { ...process.env, LISA_BOOTSTRAP: "1" },
  });
  await execFileAsync("git", ["config", "core.hooksPath", ".husky"], {
    cwd: projectDir,
  });
  await writeFile(path.join(projectDir, "CLAUDE.md"), "@AGENTS.md\n");
  await runBuiltLisa(["sync", projectDir]);
  const baseline = JSON.parse(
    await runBuiltLisa(["health", projectDir])
  ) as HealthResult;
  expect(baseline.summary.verdict).toBe("in band");
  return projectDir;
}

test.beforeAll(async () => {
  await execFileAsync("bun", ["run", "build:dist"], {
    cwd: repositoryRoot,
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
});

function healthResult(
  status: "pass" | "fail",
  completedAt = "2026-07-21T03:40:01.000Z"
): HealthResult {
  const drift = status === "fail";
  return {
    schemaVersion: 1,
    runId: drift ? "browser-drift-run" : "browser-in-band-run",
    mode: "deterministic",
    startedAt: "2026-07-21T03:40:00.000Z",
    completedAt,
    findings: [
      {
        check: "templates.managed",
        layer: "deterministic",
        status,
        reason: drift
          ? "Managed files do not match templates: eslint.config.ts"
          : "Managed files match their ownership-aware templates.",
      },
    ],
    summary: {
      verdict: drift ? "drift detected" : "in band",
      counts: drift
        ? { pass: 0, warn: 0, fail: 1 }
        : { pass: 1, warn: 0, fail: 0 },
    },
  };
}

function persisted(result: HealthResult): PersistedHealthRun {
  return {
    writeOutcome: {
      status: "written",
      path: ".lisa/health/latest.json",
      result,
    },
    result,
    serialized: `${JSON.stringify(result, null, 2)}\n`,
  };
}

function lisaVersionProbe(): StatusProbe<LisaVersionValue> {
  const result: ProbeResult<LisaVersionValue> = {
    state: "value",
    value: { current: "2.275.0", latest: "2.275.0", outdated: false },
  };
  return { id: "lisa-version", timeoutMs: 1_000, run: async () => result };
}

async function launchConsole(
  health?: Partial<UiHealthDependencies>,
  projectDir?: string,
  probes: readonly StatusProbe[] = [lisaVersionProbe()]
): Promise<LiveConsole> {
  const dir =
    projectDir ?? (await mkdtemp(path.join(tmpdir(), "lisa-ui-health-e2e-")));
  if (projectDir === undefined) createdDirs.push(dir);
  const server: Server = await runUi(
    dir,
    { port: "0", sync: false },
    {
      probes,
      ...(health === undefined ? {} : { health }),
    }
  );
  const address = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

test.afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

test("Run deterministic health check renders the exact canonical finding fields and stamp", async ({
  page,
}) => {
  const projectDir = await mkdtemp(
    path.join(tmpdir(), "lisa-ui-health-real-e2e-")
  );
  createdDirs.push(projectDir);
  await Promise.all([
    writeFile(
      path.join(projectDir, "package.json"),
      `${JSON.stringify({ private: true, devDependencies: { typescript: "latest" } }, null, 2)}\n`
    ),
    writeFile(path.join(projectDir, "tsconfig.json"), "{}\n"),
    writeFile(
      path.join(projectDir, "eslint.config.ts"),
      "// deliberately drifted from Lisa's managed TypeScript template\nexport default [];\n"
    ),
  ]);
  let cliOutput = "";
  await runHealthCli(
    projectDir,
    {},
    { write: payload => (cliOutput = payload) }
  );
  const cliResult = JSON.parse(cliOutput) as HealthResult;
  expect(cliResult.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        check: "templates.managed",
        status: "fail",
        reason: expect.stringContaining("Managed files do not match templates"),
      }),
    ])
  );
  const ui = await launchConsole(undefined, projectDir);
  try {
    await page.goto(`${ui.base}/#health`);
    const button = page.getByRole("button", {
      name: "Run deterministic health check",
    });
    await expect(button).toBeEnabled();
    await button.click();

    const rows = page.locator("#healthResults tbody tr");
    await expect(rows).toHaveCount(cliResult.findings.length);
    for (const [index, finding] of cliResult.findings.entries()) {
      await expect(rows.nth(index).locator("td")).toHaveText([
        finding.check,
        finding.layer,
        finding.status,
        finding.reason,
      ]);
    }
    await expect(page.locator("#healthLastRun")).toContainText(
      cliResult.summary.verdict
    );
    await expect(page.locator("#healthChip")).toContainText(
      cliResult.summary.verdict
    );
    await expect(page.locator("#healthChip")).toContainText("2.275.0");
    await expect(page.locator("#healthChip .dot")).toHaveClass(/warn/);
    await expect(page.locator("#healthRunStatus")).toHaveAttribute(
      "role",
      "status"
    );
    await expect(page.locator("#healthRunStatus")).toHaveText(
      "Deterministic health check completed: drift detected"
    );
  } finally {
    await ui.close();
  }
});

test("built CLI and UI agree through real drift, revert, and in-band recovery", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const projectDir = await createBuiltHost();
  const managedFile = path.join(projectDir, "eslint.config.ts");
  const canonical = await readFile(managedFile, "utf8");
  await writeFile(
    managedFile,
    "// deliberately drifted by the built-public-boundary journey\nexport default [];\n"
  );
  const cliResult = JSON.parse(
    await runBuiltLisa(["health", projectDir])
  ) as HealthResult;
  expect(cliResult.summary.verdict).toBe("drift detected");

  const ui = await launchBuiltConsole(projectDir);
  try {
    await page.goto(`${ui.base}/#health`);
    await page
      .getByRole("button", { name: "Run deterministic health check" })
      .click();
    const rows = page.locator("#healthResults tbody tr");
    await expect(rows).toHaveCount(cliResult.findings.length);
    for (const [index, finding] of cliResult.findings.entries()) {
      await expect(rows.nth(index).locator("td")).toHaveText([
        finding.check,
        finding.layer,
        finding.status,
        finding.reason,
      ]);
    }
    await expect(page.locator("#healthChip")).toContainText("drift detected");

    await writeFile(managedFile, canonical);
    await page
      .getByRole("button", { name: "Run deterministic health check" })
      .click();
    await expect(page.locator("#healthChip")).toContainText("in band");
    await expect(page.locator("#healthChip .dot")).toHaveClass(/ok/);
    await expect(page.locator("#healthLastRun")).toContainText("in band");
  } finally {
    await ui.close();
  }
});

test("stored and in-flight state survive a delayed status-hydration rerender", async ({
  page,
}) => {
  const stored = healthResult("fail");
  const current = healthResult("pass", "2026-07-21T03:42:01.000Z");
  let release: ((run: PersistedHealthRun) => void) | undefined;
  const pending = new Promise<PersistedHealthRun>(resolve => {
    release = resolve;
  });
  let releaseStatus: ((result: ProbeResult<unknown>) => void) | undefined;
  const delayedStatus = new Promise<ProbeResult<unknown>>(resolve => {
    releaseStatus = resolve;
  });
  const ui = await launchConsole(
    {
      readLatest: async () => ({
        status: "available",
        result: stored,
        lastRun: stored.completedAt,
      }),
      runPersisted: async () => pending,
    },
    undefined,
    [
      lisaVersionProbe(),
      {
        id: "github-repo",
        timeoutMs: 5_000,
        run: async () => delayedStatus,
      },
    ]
  );
  try {
    await page.goto(`${ui.base}/#health`);
    await expect(page.locator("#healthChip")).toContainText("drift detected");
    await expect(page.locator("#healthLastRun")).toContainText(
      stored.completedAt
    );

    const button = page.getByRole("button", {
      name: "Run deterministic health check",
    });
    await button.click();
    await expect(page.getByRole("button", { name: "Running…" })).toBeDisabled();
    await expect(page.locator("#healthRunStatus")).toHaveAttribute(
      "role",
      "status"
    );
    await expect(page.locator("#healthRunStatus")).toHaveText(
      "Deterministic health check running"
    );
    await expect(page.locator("#healthChip")).toContainText(
      "health check running"
    );
    releaseStatus?.({
      state: "unknown",
      reason: "delayed-test",
      message: "Delayed status completed",
    });
    await expect(page.getByRole("button", { name: "Running…" })).toBeDisabled();
    await expect(page.locator("#healthLastRun")).toContainText(
      stored.completedAt
    );
    await expect(page.locator("#healthChip")).toContainText(
      "health check running"
    );
    release?.(persisted(current));

    await expect(
      page.getByRole("button", { name: "Run deterministic health check" })
    ).toBeEnabled();
    await expect(page.locator("#healthChip")).toContainText("in band");
    await expect(page.locator("#healthChip")).toContainText("2.275.0");
    await expect(page.locator("#healthChip .dot")).toHaveClass(/ok/);
    await expect(page.locator("#healthLastRun")).toContainText(
      current.completedAt
    );
    await expect(page.locator("#healthRunStatus")).toHaveText(
      "Deterministic health check completed: in band"
    );
  } finally {
    await ui.close();
  }
});

test("a failed run clears stale green findings and does not retry", async ({
  page,
}) => {
  const stored = healthResult("pass");
  let attempts = 0;
  const ui = await launchConsole({
    readLatest: async () => ({
      status: "available",
      result: stored,
      lastRun: stored.completedAt,
    }),
    runPersisted: async () => {
      attempts += 1;
      throw new Error("/private/project/.lisa/health/latest.json exploded");
    },
  });
  try {
    await page.goto(`${ui.base}/#health`);
    await expect(page.locator("#healthChip .dot")).toHaveClass(/ok/);
    await page
      .getByRole("button", { name: "Run deterministic health check" })
      .click();

    await expect(page.locator("#healthResults tbody tr")).toHaveCount(0);
    await expect(page.getByTestId("healthResults-empty")).toHaveText(
      "Unable to run Lisa health"
    );
    await expect(page.getByTestId("healthResults-empty")).not.toContainText(
      "/private/project"
    );
    await expect(page.locator("#healthChip")).toContainText(
      "health unavailable"
    );
    await expect(page.locator("#healthChip .dot")).not.toHaveClass(/ok/);
    await expect(page.locator("#healthLastRun")).toHaveText(
      "Run failed · no current verdict"
    );
    await expect(page.getByRole("alert")).toHaveText(
      "Unable to run Lisa health"
    );
    expect(attempts).toBe(1);
  } finally {
    await ui.close();
  }
});

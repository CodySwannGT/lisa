/**
 * @file doctor-nightly-e2e-guard-cli.test.ts
 * @description Built-CLI red legs for executable bypass discovery
 * @module tests/integration/doctor-nightly-e2e-guard-cli.test
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../..");
const TARGET = "scripts/check-nightly-e2e-health.mjs";
const DETERMINATE_ZERO = "determinate zero";
let projectRoot = "";

afterEach(async () => {
  if (projectRoot !== "") {
    await rm(projectRoot, { force: true, recursive: true });
    projectRoot = "";
  }
});

/**
 * Run built doctor against one active workflow and return its nightly row.
 * @param workflow - Complete active workflow source
 * @returns The bounded nightly guard check from JSON output
 */
async function doctor(workflow: string): Promise<{
  readonly status: string;
  readonly detail: string;
}> {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lisa-guard-cli-"));
  await mkdir(path.join(projectRoot, ".github", "workflows"), {
    recursive: true,
  });
  await mkdir(path.join(projectRoot, "scripts"));
  await writeFile(
    path.join(projectRoot, ".github", "workflows", "active.yml"),
    workflow
  );
  await writeFile(
    path.join(projectRoot, TARGET),
    await readFile(
      path.join(
        REPOSITORY_ROOT,
        "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs"
      )
    )
  );
  let stdout = "";
  try {
    stdout = (
      await execute(
        process.execPath,
        ["dist/index.js", "doctor", projectRoot, "--offline", "--json"],
        { cwd: REPOSITORY_ROOT, timeout: 20_000 }
      )
    ).stdout;
  } catch (error) {
    stdout = (error as { readonly stdout?: string }).stdout ?? "";
  }
  const payload = JSON.parse(stdout) as {
    readonly checks: readonly {
      readonly name: string;
      readonly status: string;
      readonly detail: string;
    }[];
  };
  const finding = payload.checks.find(
    check => check.name === "Nightly E2E bypass guard bounded?"
  );
  if (!finding) throw new Error("built doctor omitted the nightly guard row");
  return finding;
}

const header = `
'on': [pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
`;

describe("built doctor executable bypass discovery", () => {
  it.each(["NIGHTLY_E2E_BYPASS", "Nightly.E2E-Bypass"])(
    "fails a guard-skipping case/punctuation variant %s",
    async label => {
      const finding = await doctor(`${header.replace(
        "    runs-on:",
        `    if: \${{ !contains(github.event.pull_request.labels.*.name, '${label}') }}\n    runs-on:`
      )}    env:
      GATE_BYPASS: \${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}
    steps:
      - run: node ${TARGET}
`);
      expect(finding).toMatchObject({
        status: "fail",
        detail: expect.stringMatching(/discovery unavailable|if.*bypass/u),
      });
      expect(finding.detail).not.toContain(DETERMINATE_ZERO);
    }
  );

  it("fails quoted env-command bypass wiring instead of reporting zero", async () => {
    const finding = await doctor(`${header}    steps:
      - run: env "GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, 'Nightly_E2E.Bypass') }}" node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/env.*GATE_BYPASS|unsupported/u),
    });
    expect(finding.detail).not.toContain(DETERMINATE_ZERO);
  });

  it("fails quoted GITHUB_ENV bypass wiring instead of reporting zero", async () => {
    const finding = await doctor(`${header}    steps:
      - run: echo "GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, 'NIGHTLY_E2E_BYPASS') }}" >> "$GITHUB_ENV"
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/GITHUB_ENV|indirect|unsupported/u),
    });
    expect(finding.detail).not.toContain(DETERMINATE_ZERO);
  });

  it("fails an unsupported remote reusable carrying bypass input evidence", async () => {
    const finding = await doctor(`
'on': [pull_request]
jobs:
  gate:
    uses: example/tools/.github/workflows/gate.yml@v1
    with:
      bypass_label: nightly-e2e-bypass
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/remote reusable|bypass|unsupported/u),
    });
    expect(finding.detail).not.toContain(DETERMINATE_ZERO);
  });

  it("fails a guard invocation whose runner leaves shell semantics unknown", async () => {
    const finding = await doctor(`${header.replace(
      "ubuntu-latest",
      "windows-latest"
    )}    env:
      GATE_BYPASS: true
    steps:
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(/POSIX|runner|shell/u),
    });
  });

  it("fails a tee append into GITHUB_ENV before the guard", async () => {
    const finding = await doctor(`${header}    steps:
      - run: printf '%s\\n' "GATE_BYPASS=true" | tee -a "$GITHUB_ENV"
      - run: node ${TARGET}
`);
    expect(finding).toMatchObject({
      status: "fail",
      detail: expect.stringMatching(
        /GITHUB_ENV|environment.*file|unsupported/u
      ),
    });
  });

  it("keeps bypass_cache outside nightly bypass classification", async () => {
    const finding = await doctor(`${header}    if: \${{ !env.bypass_cache }}
    steps:
      - run: node scripts/ordinary.mjs
`);
    expect(finding).toMatchObject({
      status: "ok",
      detail: expect.stringContaining(DETERMINATE_ZERO),
    });
  });
});

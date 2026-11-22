/**
 * Scanner contract for the nightly-e2e guard doctor check: fail-closed syntax: guard targets and bypass-label wiring.
 *
 * Shared fixtures and the rationale for their generic workflow names live in
 * `doctor-nightly-e2e-guard-scan-fixtures.ts`.
 * @module tests/unit/cli/doctor-nightly-e2e-guard-scan-syntax-targets.test
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, it } from "vitest";

import {
  BYPASS_ENV_MAPPING,
  CANONICAL_GUARD,
  RUNS_ON_LINE,
  SHARED_REFERENCE,
  WORKFLOW_DIRECTORY_PREFIX,
  directCaller,
  expectUnavailable,
} from "./doctor-nightly-e2e-guard-scan-fixtures.js";

let projectRoot = "";

beforeEach(async () => {
  projectRoot = await mkdtemp(
    path.join(os.tmpdir(), WORKFLOW_DIRECTORY_PREFIX)
  );
  await mkdir(path.join(projectRoot, ".github", "workflows"), {
    recursive: true,
  });
});

afterEach(async () => {
  await rm(projectRoot, { force: true, recursive: true });
});

describe("nightly guard scanner: fail-closed syntax", () => {
  /**
   * Assert the active workflow fails closed with a matching reason.
   * @param source - Complete YAML document for the active workflow
   * @param reason - Pattern the joined failure reasons must match
   * @returns Resolves once the assertions have run
   */
  const unavailable = (source: string, reason: RegExp): Promise<void> =>
    expectUnavailable(projectRoot, source, reason);

  it("rejects an official guard_script expression", async () => {
    await unavailable(
      `
'on': [pull_request]
jobs:
  gate:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main
    with:
      guard_script: \${{ inputs.guard }}
`,
      /literal/u
    );
  });

  it("rejects a dynamic official reusable reference", async () => {
    await unavailable(
      `
'on': [pull_request]
jobs:
  gate:
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@\${{ inputs.ref }}
`,
      /official reusable reference|static literal/u
    );
  });

  it.each([
    ["dynamic expression", "node ${{ env.GUARD }}"],
    ["command substitution", "node $(printf scripts/guard.mjs)"],
    ["absolute path", "node /tmp/guard.mjs"],
    ["escaping path", "node ../guard.mjs"],
    ["multiple commands", "node scripts/guard.mjs && echo done"],
    ["unsupported extension", "node scripts/guard.ts"],
  ])("rejects %s in a bypass-bearing direct caller", async (_label, run) => {
    await unavailable(
      directCaller(CANONICAL_GUARD, run),
      /unsupported|relative|literal/u
    );
  });

  it("rejects an unresolved one-level environment path", async () => {
    await unavailable(
      directCaller(CANONICAL_GUARD, 'node "$GUARD"'),
      /GUARD|resolve/u
    );
  });

  it("rejects a single-quoted environment target because the shell keeps it literal", async () => {
    await unavailable(
      directCaller(CANONICAL_GUARD, "node '$GUARD'").replace(
        "    steps:",
        `      GUARD: ${CANONICAL_GUARD}\n    steps:`
      ),
      /single-quoted|literal.*\$GUARD|environment target/u
    );
  });

  it.each(["NIGHTLY_E2E_BYPASS", "Nightly.E2E-Bypass", "nightly e2e bypass"])(
    "normalizes the %s label comparison before rejecting a guard-skipping if",
    async label => {
      await unavailable(
        directCaller().replace(
          RUNS_ON_LINE,
          `    if: \${{ !contains(github.event.pull_request.labels.*.name, '${label}') }}\n    runs-on: ubuntu-latest`
        ),
        /if.*bypass|skip.*guard/u
      );
    }
  );

  it("normalizes a separator-free nightly E2E bypass label", async () => {
    await unavailable(
      directCaller().replace(
        RUNS_ON_LINE,
        "    if: ${{ !contains(github.event.pull_request.labels.*.name, 'NightlyE2EBypass') }}\n    runs-on: ubuntu-latest"
      ),
      /if.*bypass|skip.*guard/u
    );
  });

  it.each(["job", "step"])(
    "fails closed when a %s if condition can skip the guard by bypass label",
    async level => {
      const source =
        level === "job"
          ? directCaller().replace(
              RUNS_ON_LINE,
              "    if: ${{ !contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}\n    runs-on: ubuntu-latest"
            )
          : directCaller().replace(
              `      - run: node ${CANONICAL_GUARD}`,
              `      - if: \${{ !contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}\n        run: node ${CANONICAL_GUARD}`
            );
      await unavailable(source, /if.*bypass|skip.*guard/u);
    }
  );

  it("fails closed on constructed bypass-label logic around a guard", async () => {
    await unavailable(
      directCaller().replace(
        RUNS_ON_LINE,
        "    if: ${{ !contains(github.event.pull_request.labels.*.name, format('nightly-{0}-bypass', 'e2e')) }}\n    runs-on: ubuntu-latest"
      ),
      /if.*bypass|skip.*guard/u
    );
  });

  it("fails closed when a GitHub expression joins separated bypass vocabulary", async () => {
    await unavailable(
      directCaller().replace(
        RUNS_ON_LINE,
        `    if: \${{ !contains(github.event.pull_request.labels.*.name, join(fromJSON('["nightly","e2e","bypass"]'), '-')) }}\n    runs-on: ubuntu-latest`
      ),
      /if.*bypass|skip.*guard/u
    );
  });

  it.each([
    [
      "official reusable",
      `
'on': [pull_request]
jobs:
  gate:
    if: \${{ !contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}
    uses: CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main
`,
    ],
    [
      "local reusable",
      `
'on': [pull_request]
jobs:
  gate:
    if: \${{ !contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}
    uses: ${SHARED_REFERENCE}
`,
    ],
  ])(
    "fails closed when an %s job-level if can skip guard invocation",
    async (_label, source) => {
      await unavailable(source, /if.*bypass|skip.*guard/u);
    }
  );

  it.each([
    [
      "official reusable",
      "CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml@main",
    ],
    ["local reusable", SHARED_REFERENCE],
  ])(
    "fails closed on illegal bypass environment around an %s",
    async (_label, uses) => {
      await unavailable(
        `
'on': [pull_request]
jobs:
  gate:
    env:
      GATE_BYPASS: true
    uses: ${uses}
`,
        /environment|indirect|unsupported/u
      );
    }
  );

  it("fails closed on dynamic inline GATE_BYPASS wiring", async () => {
    await unavailable(
      directCaller()
        .replace(BYPASS_ENV_MAPPING, "")
        .replace(
          `node ${CANONICAL_GUARD}`,
          `GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }} node ${CANONICAL_GUARD}`
        ),
      /inline|GATE_BYPASS|unsupported/u
    );
  });

  it.each(["nightly-e2e-bypass", "NIGHTLY_E2E_BYPASS"])(
    "fails closed on quoted env-command bypass wiring for %s",
    async label => {
      await unavailable(
        directCaller()
          .replace(BYPASS_ENV_MAPPING, "")
          .replace(
            `node ${CANONICAL_GUARD}`,
            `env "GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, '${label}') }}" node ${CANONICAL_GUARD}`
          ),
        /inline|env.*GATE_BYPASS|unsupported/u
      );
    }
  );

  it("fails closed when a quoted bypass expression is written to GITHUB_ENV before the guard", async () => {
    await unavailable(
      directCaller()
        .replace(BYPASS_ENV_MAPPING, "")
        .replace(
          `      - run: node ${CANONICAL_GUARD}`,
          `      - run: echo "GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, 'Nightly_E2E.Bypass') }}" >> "$GITHUB_ENV"\n      - run: node ${CANONICAL_GUARD}`
        ),
      /GITHUB_ENV|indirect|unsupported/u
    );
  });

  it.each([
    [
      "single redirect",
      `echo "GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}" > "$GITHUB_ENV"`,
    ],
    [
      "tee append",
      `printf '%s\\n' "GATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}" | tee -a "$GITHUB_ENV"`,
    ],
    [
      "heredoc append",
      `cat <<'LISA_ENV' >> "$GITHUB_ENV"\nGATE_BYPASS=\${{ contains(github.event.pull_request.labels.*.name, 'nightly-e2e-bypass') }}\nLISA_ENV`,
    ],
  ])("fails closed on a %s environment-file sink", async (_label, sink) => {
    await unavailable(
      directCaller()
        .replace(BYPASS_ENV_MAPPING, "")
        .replace(
          `      - run: node ${CANONICAL_GUARD}`,
          `      - run: |\n${sink
            .split("\n")
            .map(line => `          ${line}`)
            .join("\n")}\n      - run: node ${CANONICAL_GUARD}`
        ),
      /GITHUB_ENV|environment.*file|indirect|unsupported/u
    );
  });
});

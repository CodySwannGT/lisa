/**
 * Scanner contract for the nightly-e2e guard doctor check: fail-closed syntax: GITHUB_ENV / GITHUB_PATH command files.
 *
 * Shared fixtures and the rationale for their generic workflow names live in
 * `doctor-nightly-e2e-guard-scan-fixtures.ts`.
 * @module tests/unit/cli/doctor-nightly-e2e-guard-scan-syntax-env-files.test
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanNightlyE2eGuardCallers } from "../../../src/cli/doctor-nightly-e2e-guard-scan.js";
import {
  ACTIVE_NAME,
  CANONICAL_GUARD,
  WORKFLOW_DIRECTORY_PREFIX,
  directCaller,
  expectUnavailable,
  writeWorkflow,
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

/**
 * Write one workflow fixture into the current temporary project.
 * @param name - File name beneath `.github/workflows`
 * @param source - Complete YAML document
 * @returns Resolves once the file is written
 */
const workflow = (name: string, source: string): Promise<void> =>
  writeWorkflow(projectRoot, name, source);

describe("nightly guard scanner: fail-closed syntax", () => {
  /**
   * Assert the active workflow fails closed with a matching reason.
   * @param source - Complete YAML document for the active workflow
   * @param reason - Pattern the joined failure reasons must match
   * @returns Resolves once the assertions have run
   */
  const unavailable = (source: string, reason: RegExp): Promise<void> =>
    expectUnavailable(projectRoot, source, reason);

  it.each([
    [
      "constructed name",
      `echo "NIGHTLY_\${{ inputs.kind }}_LABEL=nightly-e2e-bypass" >> "$GITHUB_ENV"`,
    ],
    ["unknown payload", `cat generated.env >> "$GITHUB_ENV"`],
    ["tee input redirect", `tee -a "$GITHUB_ENV" < generated.env`],
    ["unrecognized command argument", `cp generated.env "$GITHUB_ENV"`],
  ])(
    "fails closed when a GITHUB_ENV write has an unknown %s before the guard",
    async (_label, sink) => {
      await unavailable(
        directCaller().replace(
          `      - run: node ${CANONICAL_GUARD}`,
          `      - run: ${sink}\n      - run: node ${CANONICAL_GUARD}`
        ),
        /GITHUB_ENV|environment.*file|unknown|unsafe/u
      );
    }
  );

  it("allows a statically safe GITHUB_ENV assignment before the guard", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: echo "CACHE_MODE=warm" >> "$GITHUB_ENV"\n      - run: node ${CANONICAL_GUARD}`
      )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ target: CANONICAL_GUARD }],
    });
  });

  it("fails closed on a dynamic tee prefix before a safe environment payload", async () => {
    await unavailable(
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: echo "CACHE_MODE=warm" | LC_ALL=$(./write-bypass) tee -a "$GITHUB_ENV"\n      - run: node ${CANONICAL_GUARD}`
      ),
      /GITHUB_ENV|environment.*file|unsupported/u
    );
  });

  it("fails closed on a quoted dynamic tee assignment prefix", async () => {
    await unavailable(
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: echo "CACHE_MODE=warm" | LC_ALL="$(./write-bypass)" tee -a "$GITHUB_ENV"\n      - run: node ${CANONICAL_GUARD}`
      ),
      /GITHUB_ENV|environment.*file|unsupported/u
    );
  });

  it.each([
    ["unknown file payload", `SAFE=present cat generated.env >> "$GITHUB_ENV"`],
    [
      "dynamically constructed name",
      `SAFE=present echo "NIGHTLY_\${{ inputs.bypass_suffix }}=true" >> "$GITHUB_ENV"`,
    ],
  ])("does not let an unrelated assignment mask a %s", async (_label, sink) => {
    await unavailable(
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: ${sink}\n      - run: node ${CANONICAL_GUARD}`
      ),
      /GITHUB_ENV|environment.*file|unknown/u
    );
  });

  it("fails closed when GITHUB_PATH changes command resolution before the guard", async () => {
    await unavailable(
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: echo "./fake-bin" >> "$GITHUB_PATH"\n      - run: node ${CANONICAL_GUARD}`
      ),
      /GITHUB_PATH|command.*path|execution/u
    );
  });

  it.each([
    ["clobber redirect", `echo "./fake-bin" >| "$GITHUB_PATH"`],
    ["tee replacement", `echo "./fake-bin" | tee "$GITHUB_PATH"`],
    [
      "assignment-prefixed tee",
      `echo "./fake-bin" | LC_ALL=C tee "$GITHUB_PATH"`,
    ],
    ["command-prefixed tee", `echo "./fake-bin" | command tee "$GITHUB_PATH"`],
    [
      "unresolved custom tee prefix",
      `echo "./fake-bin" | custom tee "$GITHUB_PATH"`,
    ],
  ])("fails closed on a GITHUB_PATH %s", async (_label, sink) => {
    await unavailable(
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: ${sink}\n      - run: node ${CANONICAL_GUARD}`
      ),
      /GITHUB_PATH|command.*path|execution|unsupported/u
    );
  });

  it.each([
    ["GITHUB_PATH", `echo "./fake-bin"`],
    ["GITHUB_ENV", "cat generated.env"],
  ])(
    "fails closed on a one-level %s redirect alias before the guard",
    async (file, emitter) => {
      await unavailable(
        directCaller().replace(
          `      - run: node ${CANONICAL_GUARD}`,
          `      - run: |\n          FILE="$${file}"\n          ${emitter} >> "$FILE"\n      - run: node ${CANONICAL_GUARD}`
        ),
        new RegExp(`${file}|alias|indirect|command.*file`, "u")
      );
    }
  );

  it("resolves a safe one-level GITHUB_ENV alias", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: |\n          FILE="$GITHUB_ENV"\n          echo "CACHE_MODE=warm" >> "$FILE"\n      - run: node ${CANONICAL_GUARD}`
      )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ target: CANONICAL_GUARD }],
    });
  });

  it("fails closed on a deeper indirect command-file alias", async () => {
    await unavailable(
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: |\n          FILE="$GITHUB_PATH"\n          NEXT="$FILE"\n          echo "./fake-bin" >> "$NEXT"\n      - run: node ${CANONICAL_GUARD}`
      ),
      /GITHUB_PATH|alias|indirect|unknown/u
    );
  });

  it.each([
    [
      "lowercase GITHUB_PATH alias",
      `path_file="$GITHUB_PATH"\necho "./fake-bin" >> "$path_file"`,
    ],
    [
      "underscore-prefixed GITHUB_PATH alias",
      `_path_file="$GITHUB_PATH"\necho "./fake-bin" >> "$_path_file"`,
    ],
    [
      "Bash indirect GITHUB_PATH alias",
      `FILE=GITHUB_PATH\necho "./fake-bin" >> "\${!FILE}"`,
    ],
    [
      "unsafe lowercase GITHUB_ENV alias",
      `env_file="$GITHUB_ENV"\necho "GATE_BYPASS=true" >> "$env_file"`,
    ],
  ])("fails closed on a %s", async (_label, sink) => {
    await unavailable(
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: |\n${sink
          .split("\n")
          .map(line => `          ${line}`)
          .join("\n")}\n      - run: node ${CANONICAL_GUARD}`
      ),
      /GITHUB_(?:ENV|PATH)|alias|indirect|command.*file/u
    );
  });

  it.each([
    ["unquoted expansion", `echo CACHE_MODE=$VALUE >> "$GITHUB_ENV"`],
    ["double-quoted expansion", `echo "CACHE_MODE=$VALUE" >> "$GITHUB_ENV"`],
    [
      "multiline variable expansion",
      `echo "CACHE_MODE=\${MULTILINE}" >> "$GITHUB_ENV"`,
    ],
    ["mixed quoting", `echo CACHE_MODE="warm" >> "$GITHUB_ENV"`],
    ["ANSI-C quoting", `echo $'CACHE_MODE=warm' >> "$GITHUB_ENV"`],
    [
      "embedded newline",
      `echo 'CACHE_MODE=warm\nGATE_BYPASS=true' >> "$GITHUB_ENV"`,
    ],
    [
      "safe first line masking an unsafe second",
      `printf 'CACHE_MODE=warm\\nGATE_BYPASS=true\\n' >> "$GITHUB_ENV"`,
    ],
  ])("rejects an indeterminate GITHUB_ENV %s", async (_label, sink) => {
    await unavailable(
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: |\n${sink
          .split("\n")
          .map(line => `          ${line}`)
          .join("\n")}\n      - run: node ${CANONICAL_GUARD}`
      ),
      /GITHUB_ENV|payload|unknown|environment.*file/u
    );
  });

  it("accepts one deterministic literal printf assignment line", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: printf 'CACHE_MODE=warm\\n' >> "$GITHUB_ENV"\n      - run: node ${CANONICAL_GUARD}`
      )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ target: CANONICAL_GUARD }],
    });
  });

  it.each([
    ["GITHUB_ENV", `echo "GATE_BYPASS=true" >> "$GITHUB_ENV"`],
    ["GITHUB_PATH", `echo "./fake-bin" >> "$GITHUB_PATH"`],
  ])(
    "ignores a %s mutation after the certified guard step",
    async (_label, sink) => {
      await workflow(
        ACTIVE_NAME,
        directCaller().replace(
          `      - run: node ${CANONICAL_GUARD}`,
          `      - run: node ${CANONICAL_GUARD}\n      - run: ${sink}`
        )
      );

      await expect(
        scanNightlyE2eGuardCallers(projectRoot)
      ).resolves.toMatchObject({
        state: "ok",
        callers: [{ target: CANONICAL_GUARD }],
      });
    }
  );

  it("does not classify a read of GITHUB_ENV as an environment-file write", async () => {
    await workflow(
      ACTIVE_NAME,
      directCaller().replace(
        `      - run: node ${CANONICAL_GUARD}`,
        `      - run: echo "$GITHUB_ENV"\n      - run: node ${CANONICAL_GUARD}`
      )
    );

    await expect(
      scanNightlyE2eGuardCallers(projectRoot)
    ).resolves.toMatchObject({
      state: "ok",
      callers: [{ target: CANONICAL_GUARD }],
    });
  });
});

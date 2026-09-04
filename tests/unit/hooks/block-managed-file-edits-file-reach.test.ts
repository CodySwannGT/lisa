/**
 * Reach coverage for `block-managed-file-edits.sh` — WHICH TEXT it classifies.
 *
 * The guard matches a write SIGNATURE against the raw command with one
 * `grep -Eo`, so a write one file away is invisible: `bash edit.sh` shows it two
 * tokens while the script redirects output straight into a copy-overwrite
 * template. Measured against the shipped guard: `echo x > <managed>` BLOCK,
 * `bash <script carrying that same line>` ALLOW. The managed file then forks
 * silently, which is the entire harm this guard exists to prevent.
 *
 * Reach is safe to take here without narrowing first, unlike its sibling: this
 * guard's positive signal is a PATH resolved against the installed package, not
 * a bare token, so it does not fire on prose that merely mentions a filename.
 *
 * A second, separable defect is asserted alongside it. The `sed -i` arm is
 * DEAD — not merely missing macOS's two-token `-i ""` spelling, as reported.
 * The `grep -Eo` matches, but the second-stage strip
 * `sed[[:space:]]+[^|;&]*-i[^|;&]*` is greedy and consumes the path as well, so
 * the extracted token is the empty string and nothing is ever classified.
 * Measured: `tee` and `tee -a` extract correctly; every `sed -i` spelling —
 * GNU one-token, macOS two-token, and `-i.bak` — yields nothing at all.
 *
 * This guard stands down inside Lisa's own repository, where these files ARE the
 * originals, so every case runs against a synthetic HOST project. Probing
 * in-tree reports ALLOW for everything and proves nothing.
 * @module tests/unit/hooks/block-managed-file-edits-file-reach
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  runGuard,
  scratchDir,
  script,
  sourceGuard,
} from "./support/executed-script-reach.js";

const GUARD = sourceGuard("block-managed-file-edits.sh");

/** A copy-overwrite template, host-relative. */
const MANAGED = "scripts/lisa-hooks/block-no-verify.sh";
/** A path the host owns outright. */
const UNMANAGED = "src/app.ts";

const host = scratchDir("managed-reach-host");

/**
 * Drive the guard with one shell command, as the host project.
 * @param command - The command an agent is attempting.
 * @returns The exit status; 2 means refused.
 */
const run = (command: string): number | null =>
  runGuard(GUARD, bash(command), {
    cwd: host,
    env: { CLAUDE_PROJECT_DIR: host, LISA_ALLOW_MANAGED_FILE_WRITE: "" },
  }).status;

/**
 * Drive the guard with a Write-tool payload, as the host project.
 * @param filePath - The path the tool would write.
 * @returns The exit status; 2 means refused.
 */
const runWrite = (filePath: string): number | null =>
  runGuard(
    GUARD,
    { tool_name: "Write", tool_input: { file_path: filePath } },
    {
      cwd: host,
      env: { CLAUDE_PROJECT_DIR: host, LISA_ALLOW_MANAGED_FILE_WRITE: "" },
    }
  ).status;

/** Scripts whose CONTENTS carry the write. Assigned in beforeAll. */
let redirectScript = "";
let appendScript = "";
let teeScript = "";
let sedGnuScript = "";
let sedMacScript = "";
let execChain = "";
let dataChain = "";
let readOnlyScript = "";

beforeAll(() => {
  // A host project: a package.json that is NOT @codyswann/lisa, plus an
  // installed package carrying the copy-overwrite tree the guard resolves
  // against. Both are required — without either, the guard stands down.
  writeFileSync(
    path.join(host, "package.json"),
    JSON.stringify({ name: "a-host-project", version: "1.0.0" }),
    "utf-8"
  );
  const shipped = path.join(
    host,
    "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-hooks"
  );
  mkdirSync(shipped, { recursive: true });
  writeFileSync(path.join(shipped, "block-no-verify.sh"), "shipped\n", "utf-8");
  mkdirSync(path.join(host, "scripts/lisa-hooks"), { recursive: true });
  writeFileSync(path.join(host, MANAGED), "local\n", "utf-8");
  mkdirSync(path.join(host, "src"), { recursive: true });
  writeFileSync(path.join(host, UNMANAGED), "app\n", "utf-8");

  redirectScript = script(host, "edit.sh", [`echo tampered > ${MANAGED}`]);
  appendScript = script(host, "append.sh", [`echo more >> ${MANAGED}`]);
  teeScript = script(host, "tee.sh", [`echo tampered | tee ${MANAGED}`]);
  sedGnuScript = script(host, "sed-gnu.sh", [`sed -i s/a/b/ ${MANAGED}`]);
  sedMacScript = script(host, "sed-mac.sh", [`sed -i "" s/a/b/ ${MANAGED}`]);
  execChain = script(host, "outer-exec.sh", [`bash ${redirectScript}`]);
  dataChain = script(host, "outer-data.sh", [`grep -n x ${redirectScript}`]);
  readOnlyScript = script(host, "read.sh", [`grep -n shipped ${MANAGED}`]);
});

describe("block-managed-file-edits.sh reach", () => {
  describe("refuses a managed write inside a file the command executes", () => {
    it.each([
      ["a redirect", () => `bash ${redirectScript}`],
      ["an append", () => `bash ${appendScript}`],
      ["a tee", () => `bash ${teeScript}`],
      ["sh", () => `sh ${redirectScript}`],
      ["source", () => `source ${redirectScript}`],
      ["an absolute interpreter path", () => `/bin/bash ${redirectScript}`],
      ["a bare script path", () => redirectScript],
      ["a bare script path behind sudo", () => `sudo -- ${redirectScript}`],
      [
        "a wrapper with its own operand",
        () => `nice -n 5 bash ${redirectScript}`,
      ],
    ])("refuses %s inside an executed script", (_label, command) => {
      expect(run(command())).toBe(EXIT_BLOCKED);
    });

    it("follows execution across two hops", () => {
      expect(run(`bash ${execChain}`)).toBe(EXIT_BLOCKED);
    });

    it("refuses a managed write inside a shell command string", () => {
      expect(run(`bash -c 'echo tampered > ${MANAGED}'`)).toBe(EXIT_BLOCKED);
    });

    it("recurses through nested shell command strings", () => {
      expect(run(`bash -c "sh -c 'echo tampered > ${MANAGED}'"`)).toBe(
        EXIT_BLOCKED
      );
    });

    it("names the managed file in the refusal", () => {
      const { stderr } = runGuard(GUARD, bash(`bash ${redirectScript}`), {
        cwd: host,
        env: { CLAUDE_PROJECT_DIR: host, LISA_ALLOW_MANAGED_FILE_WRITE: "" },
      });
      expect(stderr).toContain(MANAGED);
    });

    it("announces analyzer failures instead of silently allowing them", () => {
      const fakeBin = path.join(host, "failing-analyzer-bin");
      mkdirSync(fakeBin, { recursive: true });
      const fakePython = path.join(fakeBin, "python3");
      writeFileSync(
        fakePython,
        [
          "#!/bin/sh",
          'echo "deliberate analyzer failure" >&2',
          "exit 7",
          "",
        ].join("\n")
      );
      chmodSync(fakePython, 0o755);

      const { status, stderr } = runGuard(
        GUARD,
        bash(`bash ${redirectScript}`),
        {
          cwd: host,
          env: {
            CLAUDE_PROJECT_DIR: host,
            LISA_ALLOW_MANAGED_FILE_WRITE: "",
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          },
        }
      );

      expect(status).toBe(EXIT_ALLOWED);
      expect(stderr).toContain("Bash analyzer failed (exit 7)");
      expect(stderr).toContain("deliberate analyzer failure");
      expect(stderr).toContain("write protection is NOT active");
    });
  });

  describe("classifies every sed -i spelling", () => {
    // The arm is dead in all three spellings, not just the macOS one. Each is a
    // real in-place edit of a managed file.
    it.each([
      ["GNU one-token", () => `sed -i s/a/b/ ${MANAGED}`],
      ["macOS two-token", () => `sed -i "" s/a/b/ ${MANAGED}`],
      ["a backup suffix", () => `sed -i.bak s/a/b/ ${MANAGED}`],
    ])("refuses the %s form inline", (_label, command) => {
      expect(run(command())).toBe(EXIT_BLOCKED);
    });

    it.each([
      ["GNU one-token", () => `bash ${sedGnuScript}`],
      ["macOS two-token", () => `bash ${sedMacScript}`],
    ])("refuses the %s form inside an executed script", (_label, command) => {
      expect(run(command())).toBe(EXIT_BLOCKED);
    });
  });

  describe("does not follow a path named as data", () => {
    // Reads never fire. Each command NAMES a script that really does write a
    // managed file, and each one only reads it.
    it.each([
      ["grep -n", () => `grep -n echo ${redirectScript}`],
      ["cat", () => `cat ${redirectScript}`],
      ["wc -l", () => `wc -l ${redirectScript}`],
      ["git diff", () => `git diff ${redirectScript}`],
      ["a git grep pathspec", () => `git grep -n echo -- ${redirectScript}`],
      ["a test run", () => `vitest ${redirectScript}`],
      ["a shellcheck run", () => `shellcheck ${redirectScript}`],
    ])("allows %s naming a script that does write", (_label, command) => {
      expect(run(command())).toBe(EXIT_ALLOWED);
    });

    it("allows reading the managed file itself", () => {
      expect(run(`grep -n shipped ${MANAGED}`)).toBe(EXIT_ALLOWED);
    });

    it("allows executing a script that only reads the managed file", () => {
      expect(run(`bash ${readOnlyScript}`)).toBe(EXIT_ALLOWED);
    });

    it("does not propagate taint through a reference inside a followed file", () => {
      // Following an executed script is following what RUNS. Following a path
      // that script merely names is following data, one file further away.
      expect(run(`bash ${dataChain}`)).toBe(EXIT_ALLOWED);
    });
  });

  describe("still refuses everything it refused before", () => {
    // Rejection controls. Without these the suite is satisfied by a guard that
    // returns 0 unconditionally.
    it.each([
      ["an inline redirect", () => `echo x > ${MANAGED}`],
      ["an inline append", () => `echo x >> ${MANAGED}`],
      ["a noclobber override", () => `echo x >| ${MANAGED}`],
      ["an inline tee", () => `echo x | tee ${MANAGED}`],
      ["an inline tee -a", () => `echo x | tee -a ${MANAGED}`],
    ])("refuses %s", (_label, command) => {
      expect(run(command())).toBe(EXIT_BLOCKED);
    });

    it("refuses a Write tool payload targeting the managed file", () => {
      expect(runWrite(path.join(host, MANAGED))).toBe(EXIT_BLOCKED);
    });
  });

  describe("still allows everything it allowed before", () => {
    it("allows an inline write to a host-owned file", () => {
      expect(run(`echo x > ${UNMANAGED}`)).toBe(EXIT_ALLOWED);
    });

    it("allows a Write tool payload targeting a host-owned file", () => {
      expect(runWrite(path.join(host, UNMANAGED))).toBe(EXIT_ALLOWED);
    });

    it("allows an executed script that writes only host-owned files", () => {
      const benign = script(host, "benign.sh", [`echo x > ${UNMANAGED}`]);
      expect(run(`bash ${benign}`)).toBe(EXIT_ALLOWED);
    });

    it("honours the operator override on an executed script", () => {
      const { status } = runGuard(GUARD, bash(`bash ${redirectScript}`), {
        cwd: host,
        env: { CLAUDE_PROJECT_DIR: host, LISA_ALLOW_MANAGED_FILE_WRITE: "1" },
      });
      expect(status).toBe(EXIT_ALLOWED);
    });
  });
});

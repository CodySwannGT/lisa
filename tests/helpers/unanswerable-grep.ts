/**
 * A PATH on which `grep` runs but cannot answer.
 *
 * `grep` has three exit statuses, not two: 0 it matched, 1 it did not match,
 * and >=2 "I could not do this" — it was never exec'd, the pattern was
 * rejected, the input could not be read. Shell guards written as
 * `if … | grep -q …; then` collapse 1 and >=2 into one answer, so a scan that
 * could not run reads as "no match" — and for a safety net, "no match" means
 * "this command is safe" (CodySwannGT/lisa#3054).
 *
 * The condition that gets there is not theoretical. Measured on the machine
 * this was found on, while an agent fleet ran: 7,679 orphaned processes
 * outstanding against a `kern.maxprocperuid` of 10,666 — 72% of the per-user
 * cap, which puts a `fork()` returning EAGAIN a few hundred spawns away. A
 * `grep` that cannot be started is exactly a `grep` that cannot answer.
 *
 * ## Why a shim rather than a stand-in hook
 *
 * The thing under test is the SHIPPED file. A substitute harness hardcoded to
 * refuse would satisfy any assertion here while proving nothing about what
 * consumers receive. This perturbs the ENVIRONMENT the shipped file runs in and
 * leaves the file itself alone, so every verdict observed through it is the
 * shipped file's own.
 * @module tests/helpers/unanswerable-grep
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { env as processEnv } from "node:process";

/**
 * grep's "an error occurred" status. Deliberately 2 rather than something
 * exotic: it is what a real grep returns when it cannot do its job, so a guard
 * that handles this handles the real case.
 */
export const GREP_ERROR_STATUS = 2;

/**
 * An environment whose `grep` starts, fails, and says nothing useful.
 *
 * Created under `os.tmpdir()` rather than anywhere relative to the working
 * directory: the run-scoped scratch root only redirects `os.tmpdir()`, and a
 * `process.cwd()`-based fixture lands outside it and survives the run
 * (CodySwannGT/lisa#3010).
 * @param base - The environment to layer the shim onto.
 * @returns The same environment with the shim first on PATH.
 */
export function withUnanswerableGrep(
  base: NodeJS.ProcessEnv = processEnv
): NodeJS.ProcessEnv {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-unanswerable-grep-"));
  const bin = path.join(dir, "bin");
  const shim = path.join(bin, "grep");
  const shimmed = `${bin}${path.delimiter}${base.PATH ?? ""}`;
  mkdirSync(bin, { recursive: true });
  writeFileSync(shim, `#!/bin/sh\nexit ${GREP_ERROR_STATUS}\n`);
  chmodSync(shim, 0o755);
  return { ...base, PATH: shimmed };
}

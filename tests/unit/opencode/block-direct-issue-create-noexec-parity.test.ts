/**
 * Both filing guards agree that a syntax check executes nothing.
 *
 * CodySwannGT/lisa#3781 taught the canonical bash guard that `bash -n <file>`
 * READS the file and runs not one line of it, so the file it names is not a
 * file the command executes. CodySwannGT/lisa#3885 found the arm had reached 11
 * of the 20 shipped copies and never reached the OpenCode port — and, worse,
 * that no test could see it: a full push gate ran with the gap open and
 * `test-correctness` and `coverage-adequacy` both PASSED.
 *
 * The disagreement that produced is the expensive kind. The bash guard allowed
 * a syntax check and the port refused it, so the same command's verdict
 * depended on which agent an operator happened to be using, and nothing
 * announced it.
 *
 * Both directions were wrong before CodySwannGT/lisa#3781, and the silent one
 * is worse: a creation-shaped file earned a false REFUSAL, and a file carrying
 * a human-gate marker earned a false ALLOW — adjudicating as "declared" a
 * command that filed nothing.
 *
 * Split from the sibling cross-repo suite rather than added to it: that table
 * was already at the 300-line budget, and these cases are about one behaviour
 * rather than about tracker configuration.
 * @module tests/unit/opencode/block-direct-issue-create-noexec-parity
 */
import { beforeAll, describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import type { ParityCase } from "./support/filing-parity.js";
import {
  bashVerdict,
  LINEAR_CALLER,
  opencodeVerdicts,
  project,
  UNDECLARED_SCRIPT,
} from "./support/filing-parity.js";

// The bounded children below need a case budget that scales with the same
// machine they do; see the sibling suite for the measurement.
useIoLatencyBudget();

const CASES: readonly ParityCase[] = [
  // Syntax checks. CodySwannGT/lisa#3781 taught the canonical guard that
  // `bash -n <file>` READS the file and runs not one line of it, so the file is
  // not a file this command executes. CodySwannGT/lisa#3885 found the arm had
  // never reached this port: the bash guard allowed a syntax check while the
  // OpenCode port refused it, which is the agent-dependent disagreement these
  // parity cases exist to catch.
  //
  // Both directions were wrong before the fix, and the silent one is worse: a
  // creation-shaped file earned a false REFUSAL, and a file carrying a
  // human-gate marker earned a false ALLOW — adjudicating as "declared" a
  // command that filed nothing.
  {
    label: "a syntax check of a script that really files",
    config: LINEAR_CALLER,
    command: "",
    template: "bash -n {dir}/create.sh",
    files: { "create.sh": UNDECLARED_SCRIPT },
    expected: "allow",
  },
  {
    label: "a syntax check behind a wrapper that has its own -n",
    // `nice -n 5` carries a `-n` belonging to a different program. Reading the
    // first token would miss the shell entirely; reading any `-n` anywhere
    // would let `nice -n 5 bash create.sh` masquerade as a syntax check, which
    // is a real bypass. The case below is the other half of that pair.
    config: LINEAR_CALLER,
    command: "",
    template: "nice -n 5 bash -n {dir}/create.sh",
    files: { "create.sh": UNDECLARED_SCRIPT },
    expected: "allow",
  },
  {
    label: "the same wrapper actually executing the script",
    config: LINEAR_CALLER,
    command: "",
    template: "nice -n 5 bash {dir}/create.sh",
    files: { "create.sh": UNDECLARED_SCRIPT },
    expected: "deny",
  },
  {
    label: "a syntax check followed by really running the file",
    // Without this the arm above is satisfied by a guard that stops following
    // executed scripts the moment a `-n` appears anywhere in the command line,
    // which would hand back the exact fail-open that reach was added to close.
    config: LINEAR_CALLER,
    command: "",
    template: "bash -n {dir}/create.sh && bash {dir}/create.sh",
    files: { "create.sh": UNDECLARED_SCRIPT },
    expected: "deny",
  },
  {
    label: "a syntax check of a file carrying the human gate",
    // The asymmetry is the defect, not either verdict alone: before the fix a
    // file's CONTENTS decided the verdict of a command that ran nothing, so
    // these two disagreed. They must now agree, and agree on allow.
    config: LINEAR_CALLER,
    command: "",
    template: "bash -n {dir}/gated.sh",
    files: {
      "gated.sh": `# [lisa-human-gate] reason=pricing\n${UNDECLARED_SCRIPT}`,
    },
    expected: "allow",
  },
];

describe("noexec parity: bash guard vs OpenCode port", () => {
  const directories = CASES.map(entry => project(entry.config, entry.files));
  // A case naming a file has to name it where the file actually is, and the
  // directory is only known once it exists.
  const commands = CASES.map((entry, index) =>
    entry.template
      ? entry.template.replaceAll("{dir}", directories[index] ?? "")
      : entry.command
  );
  let opencode: readonly string[] = [];

  beforeAll(() => {
    opencode = opencodeVerdicts(
      CASES.map((_entry, index) => ({
        dir: directories[index] ?? "",
        command: commands[index] ?? "",
      }))
    );
  });

  it.each(CASES.map((entry, index) => [entry.label, index] as const))(
    "agrees on %s",
    (_label, index) => {
      const entry = CASES[index];
      expect(entry).toBeDefined();
      expect(bashVerdict(commands[index] ?? "", directories[index] ?? "")).toBe(
        entry?.expected
      );
      expect(opencode[index]).toBe(entry?.expected);
    }
  );
});

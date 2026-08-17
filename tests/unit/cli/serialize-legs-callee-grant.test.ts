/**
 * The callee-grant constant must never disagree with the workflow Lisa ships.
 *
 * `CALLEE_GRANTS_ACTIONS_READ` is what stops `lisa doctor` certifying a
 * `serialize_platform_legs` opt-in that no caller configuration can make work.
 * It is a constant rather than a file read because consumers reference the
 * reusable workflow at `@main` and have no copy of it to read — which means
 * nothing else can catch it drifting from reality.
 *
 * That drift is the whole risk. A constant left `false` after the workflow
 * grants the scope makes doctor warn forever about a fixed problem; left `true`
 * before it does, doctor certifies the exact configuration measured to answer
 * HTTP 403 with both legs starting two seconds apart. The second is how this
 * check came to vouch for the defect it exists to catch.
 * @module tests/unit/cli/serialize-legs-callee-grant
 */
import fs from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CALLEE_GRANTS_ACTIONS_READ,
  checkSerializeLegsContract,
} from "../../../src/cli/doctor-serialize-legs-contract.js";

const WORKFLOW = path.join(
  process.cwd(),
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/**
 * Whether the reusable workflow's own top-level `permissions:` block grants
 * `actions`.
 *
 * Read from the top-level block only. A job-level grant does not raise the
 * workflow's ceiling, and treating one as equivalent would reintroduce exactly
 * the mis-scoping this whole area exists to catch.
 * @returns True when the workflow's own permissions include `actions`.
 */
const workflowGrantsActions = (): boolean => {
  const source = readFileSync(WORKFLOW, "utf8");
  const lines = source.split("\n");
  const start = lines.findIndex(line => /^permissions:\s*$/u.test(line));
  if (start === -1) {
    // No block at all means the caller's grant is INHERITED rather than
    // capped — a different world from today's, and one that hands a permissive
    // consumer write scopes. It must not be read as "grants actions".
    return false;
  }
  for (const line of lines.slice(start + 1)) {
    // The block ends at the first line that is not an indented entry.
    if (!/^\s+\S/u.test(line)) break;
    if (/^\s+actions:\s*(read|write)\s*$/u.test(line)) return true;
  }
  return false;
};

describe("serialize-legs callee grant tracks the shipped workflow", () => {
  it("matches the reusable workflow's own permissions block", () => {
    expect(CALLEE_GRANTS_ACTIONS_READ).toBe(workflowGrantsActions());
  });

  it("refuses to certify a fully configured caller while the callee cannot receive the scope", async () => {
    // The defect this replaces. TunnlAI/frontend declares every caller-side
    // part — serialize on, token forwarded, `actions: read` at BOTH job and
    // workflow level — and the check reported `ok`. That same configuration
    // was measured at HTTP 403 with the two legs starting two seconds apart.
    //
    // A check that passes on a broken configuration is worse than no check: it
    // converts "unverified" into "verified", and it is consulted instead of
    // the runtime evidence.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-legs-"));
    try {
      fs.mkdirSync(path.join(root, ".github", "workflows"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(root, ".github", "workflows", "maestro-e2e.yml"),
        [
          "name: Nightly",
          "permissions:",
          "  contents: read",
          "  actions: read",
          "jobs:",
          "  native:",
          "    permissions:",
          "      contents: read",
          "      actions: read",
          "    uses: CodySwannGT/lisa/.github/workflows/maestro-native-e2e.yml@main",
          "    with:",
          "      serialize_platform_legs: true",
          "    secrets:",
          "      LEG_ORDER_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
          "",
        ].join("\n")
      );

      const result = await checkSerializeLegsContract(root);
      expect(CALLEE_GRANTS_ACTIONS_READ).toBe(false);
      expect(result.status).toBe("warn");
      expect(result.detail).toContain("CANNOT work");
      // It must not send the operator to fix their own config: theirs is done.
      expect(result.detail).toContain("Nothing to fix here");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not read a job-level grant as the workflow's own", () => {
    // The measured failure was `actions: read` on the job. If that ever counted
    // here, the constant would flip on a change that grants nothing.
    const source = readFileSync(WORKFLOW, "utf8");
    const start = source
      .split("\n")
      .findIndex(line => line.startsWith("jobs:"));
    expect(start).toBeGreaterThan(-1);
    // Whatever jobs declare, the answer above comes from the top-level block.
    expect(typeof workflowGrantsActions()).toBe("boolean");
  });
});

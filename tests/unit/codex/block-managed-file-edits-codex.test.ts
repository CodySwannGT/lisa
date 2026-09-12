/**
 * Codex reachability for `block-managed-file-edits.sh` (CodySwannGT/lisa#3750).
 *
 * The ticket said this guard reached three of six agent surfaces. The tree said
 * otherwise on two of them — an Antigravity sibling and an OpenCode template
 * both exist — and on the third the ticket and the tree were both measuring a
 * channel that no longer delivers anything. `src/codex/scripts/` is the RETIRED
 * linked-script layout, per `src/codex/hooks-installer.ts`'s own opening remark;
 * a guard's absence from it says nothing about whether Codex runs the guard.
 *
 * So the question this file answers is the only one that matters, and it is not
 * "is there a file named for Codex". It is: when Codex makes the tool call, does
 * the refusal happen? That is asked here the way the sibling ports are asked —
 * by driving the REGISTERED COMMAND as a subprocess with a real payload and
 * asserting the exit status. `src/codex/enforcement-fallback-installer.ts`
 * registers `/bin/bash <repo>/scripts/lisa-enforcement-fallback.sh` on
 * `PreToolUse` for `Bash|Edit|Write|apply_patch`, and that dispatcher is what
 * every case below runs. Registration alone is not the claim: "registered but
 * unreachable" is the defect this repository keeps re-finding, and a suite that
 * only read the manifest would certify it.
 *
 * The envelopes are Codex's, not Claude's. Codex's edit tool is `apply_patch`
 * and it carries the whole patch as a STRING on `tool_input.command`, naming its
 * targets in `*** Update File:` headers — there is no `file_path` to read
 * (verified against codex-cli 0.125.0 in `src/codex/scripts/_extract-edit-paths.sh`).
 * Forwarding a runtime's generic tool name verbatim and hoping is measurably an
 * ALLOW, so the payloads here are the ones Codex actually sends.
 *
 * Every refusal case is PAIRED with a permitted one. A guard that refuses
 * everything satisfies the blocking assertions and is worse than no guard, and a
 * dispatcher that exits 2 unconditionally would satisfy them too.
 *
 * The subject is a synthetic HOST project. This guard stands down inside Lisa's
 * own repository, where these files ARE the originals, so probing in-tree
 * reports ALLOW for everything and proves nothing.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/codex/block-managed-file-edits-codex
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BLOCKED,
  cleanupScratchRoots,
  HOST_TREE,
  REPO_ROOT,
  runFallback,
  scratchRoot,
} from "../../helpers/enforcement-fallback-fixtures.js";

/** The guard under test, resolved from the SOURCE the fix edits. */
const GUARD_SOURCE = path.join(
  REPO_ROOT,
  "plugins",
  "src",
  "base",
  "hooks",
  "block-managed-file-edits.sh"
);

/**
 * A copy-overwrite template, host-relative — the path the guard defends.
 *
 * Deliberately NOT one of the guards under `scripts/lisa-hooks/`. The
 * dispatcher resolves its roster from that directory, so a fixture template
 * placed there is a file the dispatcher then tries to EXECUTE as a guard, and
 * the run reports an interpreter error instead of a verdict.
 */
const MANAGED = "scripts/lisa-gates.mjs";

/** A path the host owns outright; editing it is the job, not a fork. */
const UNMANAGED = "src/app.ts";

/** Codex's patch envelope sentinels. */
const PATCH_OPEN = "*** Begin Patch";
const PATCH_CLOSE = "*** End Patch";

/** The status the dispatcher exits with when nothing objected. */
const ALLOWED = 0;

/** The synthetic host project every case runs against. */
let host = "";

/**
 * A Codex `apply_patch` tool call.
 * @param target - Host-relative path the patch rewrites.
 * @returns The PreToolUse payload Codex sends.
 */
const applyPatch = (target: string): unknown => ({
  session_id: "codex-managed-file-edits",
  tool_name: "apply_patch",
  tool_input: {
    command: [
      PATCH_OPEN,
      `*** Update File: ${target}`,
      "@@",
      "-before",
      "+after",
      PATCH_CLOSE,
    ].join("\n"),
  },
});

/**
 * A Codex `Bash` tool call.
 * @param command - The shell command Codex proposes to run.
 * @returns The PreToolUse payload Codex sends.
 */
const shell = (command: string): unknown => ({
  session_id: "codex-managed-file-edits",
  tool_name: "Bash",
  tool_input: { command },
});

beforeAll(() => {
  host = scratchRoot();

  // A host project is two things at once: a package that is NOT Lisa, and an
  // installed Lisa whose copy-overwrite tree is what the guard resolves paths
  // against. Without either, the guard stands down and every case would pass.
  writeFileSync(
    path.join(host, "package.json"),
    JSON.stringify({ name: "a-host-project", version: "1.0.0" }),
    "utf8"
  );
  const shipped = path.join(
    host,
    "node_modules",
    "@codyswann",
    "lisa",
    "all",
    "copy-overwrite",
    "scripts"
  );
  mkdirSync(shipped, { recursive: true });
  writeFileSync(path.join(shipped, "lisa-gates.mjs"), "shipped\n", "utf8");

  // The guard as `lisa apply` installs it, from the source tree rather than a
  // generated copy: pointing this at `plugins/lisa/hooks/` would let a source
  // fix pass while the shipped guard stayed broken.
  const hostGuards = path.join(host, HOST_TREE);
  mkdirSync(hostGuards, { recursive: true });
  copyFileSync(
    GUARD_SOURCE,
    path.join(hostGuards, "block-managed-file-edits.sh")
  );
  writeFileSync(path.join(host, MANAGED), "before\n", "utf8");

  mkdirSync(path.join(host, "src"), { recursive: true });
  writeFileSync(path.join(host, UNMANAGED), "before\n", "utf8");
});

afterAll(() => {
  cleanupScratchRoots();
});

describe("block-managed-file-edits on the Codex surface", () => {
  it("refuses an apply_patch that rewrites a copy-overwrite template", () => {
    // apply_patch is Codex's PRIMARY write path. A guard that covered only
    // Write/Edit would be inert on the tool Codex reaches for most.
    expect(runFallback(applyPatch(MANAGED), host).status).toBe(BLOCKED);
  });

  it("refuses a Bash redirect into a copy-overwrite template", () => {
    expect(runFallback(shell(`echo tampered >> ${MANAGED}`), host).status).toBe(
      BLOCKED
    );
  });

  it("names the template and the escape hatch in the Codex refusal", () => {
    // A refusal that does not say WHICH file, or how to proceed when the edit
    // is genuinely intended, is a wall rather than a guard.
    const { output } = runFallback(applyPatch(MANAGED), host);

    expect(output).toContain(MANAGED);
    expect(output).toContain("LISA_ALLOW_MANAGED_FILE_WRITE=1");
  });

  it("allows an apply_patch against a file the host owns", () => {
    // The rejection control. Without it every assertion above is satisfied by a
    // dispatcher that refuses unconditionally.
    expect(runFallback(applyPatch(UNMANAGED), host).status).toBe(ALLOWED);
  });

  it("allows a Bash read of the very template it refuses to write", () => {
    // The same file, the same surface, the same call shape — only the POSITION
    // changes. Over-blocking reads is the known-wrong fix this guard family has
    // already shipped once.
    expect(runFallback(shell(`wc -l ${MANAGED}`), host).status).toBe(ALLOWED);
  });
});

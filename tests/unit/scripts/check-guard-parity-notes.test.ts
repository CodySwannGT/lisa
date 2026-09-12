/**
 * Tests for the guard-parity-note sweep (CodySwannGT/lisa#3908).
 *
 * The load-bearing cases point the real `sweep()` at REAL directory trees. One
 * holds the exact note the ticket was filed for — the pre-fix wording claiming
 * three missing ports while two of them sit in the tree — and asserts the
 * report names the guard, each contradicted surface, and the file that proves
 * it. Its negative control is the corrected wording over the SAME tree, which
 * must come back clean, because a sweep that refused every note would satisfy
 * the first assertion and be useless. A third records a gap that is genuinely
 * absent and must also pass: the note exists to record real gaps, and a check
 * that could not tell a true record from a stale one would delete the record
 * along with the drift. A fourth points the sweep at an empty tree and asserts
 * zero sources read, because an empty sweep and a clean tree otherwise print
 * the same tick.
 *
 * The last case is the enforcement itself: the sweep run over THIS repository
 * must find nothing while having read something. That pairing is the whole
 * control — either half alone is satisfiable by a sweep that stopped looking.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 * @module tests/unit/scripts/check-guard-parity-notes
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  BLIND_SPOTS,
  claimsIn,
  codexHooksManifest,
  commentBlocks,
  dispatcherRoster,
  evidenceFor,
  formatReport,
  guardIdFor,
  portFor,
  registryFor,
  SURFACES,
  sweep,
} from "../../../scripts/check-guard-parity-notes.mjs";

/** Repository root, four levels up from this file. */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/** Temp trees created by a test, removed afterwards. */
const created: string[] = [];

/**
 * Create a throwaway directory tree for the sweep to walk.
 * @returns Absolute path of the new tree.
 */
function makeTree(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "lisa-test-parity-note-"));
  created.push(root);
  return root;
}

/**
 * Write a file into a tree, creating parent directories.
 * @param root - Tree root.
 * @param relative - Path within the tree.
 * @param contents - File contents.
 */
function write(root: string, relative: string, contents: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

/** The Antigravity port fixture, written and then named as the contradiction. */
const DEMO_AGY_PORT = "plugins/src/base/hooks/demo-guard.agy.sh";

/** The Claude reference port every fixture tree writes. */
const DEMO_GUARD_SOURCE = "plugins/src/base/hooks/demo-guard.sh";

/** Guard id every fixture tree in this file uses. */
const DEMO_GUARD = "demo-guard";

/** A real guard id, spelled once for the naming-convention cases. */
const REAL_GUARD = "block-no-verify";

/** The exact sentence #3908 was filed for. */
const STALE_CLAIM =
  "This guard has no Antigravity, Codex or OpenCode port — only the Claude";

/** The corrected wording: Codex is the one surface with no port. */
const TRUE_CLAIM = "This guard has no Codex port. Every other surface has one.";

/** Repo-relative path of the Codex enforcement dispatcher. */
const DISPATCHER = "scripts/lisa-enforcement-fallback.sh";

/** Repo-relative path of the Codex plugin manifest. */
const CODEX_MANIFEST = "plugins/lisa/.codex-plugin/hooks.json";

/**
 * A dispatcher whose header MENTIONS a guard it does not run.
 *
 * The real dispatcher's header lists guard names in an English sentence, so a
 * reader that searched this file for a name would report every guard it talks
 * about as one it dispatches. The roster below deliberately omits the guard the
 * prose names.
 */
const DISPATCHER_SOURCE = [
  "#!/usr/bin/env bash",
  "# Every PreToolUse guard — demo-guard, other-guard — is dispatched here.",
  "set -euo pipefail",
  "",
  "for guard in other-guard third-guard \\",
  "  fourth-guard; do",
  '  echo "$guard"',
  "done",
  "",
].join("\n");

/**
 * A guard header carrying one parity note.
 * @param claim - The note's claim sentence.
 * @returns Shell source for the guard.
 */
function guardSource(claim: string): string {
  return [
    "#!/usr/bin/env bash",
    "#",
    "# ## Parity gap, recorded rather than silently dropped",
    "#",
    `# ${claim}`,
    "# reference and the copies generated from it.",
    "set -euo pipefail",
    "",
  ].join("\n");
}

/**
 * Lay down a guard whose Antigravity and OpenCode ports both exist.
 * @param root - Tree root.
 * @param claim - The note's claim sentence.
 */
function writeGuardWithTwoPorts(root: string, claim: string): void {
  write(root, DEMO_GUARD_SOURCE, guardSource(claim));
  write(root, DEMO_AGY_PORT, "# agy port\n");
  write(root, "src/opencode/plugin-templates/lisa-demo-guard.ts", "// port\n");
}

afterEach(() => {
  while (created.length > 0) {
    rmSync(created.pop()!, { force: true, recursive: true });
  }
});

describe("check-guard-parity-notes", () => {
  it("refuses the pre-fix note against a tree that holds two of the three ports", () => {
    const root = makeTree();
    writeGuardWithTwoPorts(root, STALE_CLAIM);

    const report = sweep(root);

    expect(report.claims).toBe(1);
    expect(report.findings.length).toBe(2);
    expect(report.findings.map(finding => finding.surface)).toEqual([
      "antigravity",
      "opencode",
    ]);
    expect(report.findings[0]!.guard).toBe(DEMO_GUARD);
    expect(report.findings[0]!.file).toBe(DEMO_GUARD_SOURCE);
    expect(report.findings[0]!.line).toBe(5);
    expect(report.findings[0]!.evidence).toBe(DEMO_AGY_PORT);
    expect(report.findings[1]!.evidence).toBe(
      "src/opencode/plugin-templates/lisa-demo-guard.ts"
    );
  });

  it("accepts the corrected note over the very same tree", () => {
    const root = makeTree();
    writeGuardWithTwoPorts(root, TRUE_CLAIM);

    const report = sweep(root);

    expect(report.claims).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("still lets a guard record a gap that is genuinely open", () => {
    const root = makeTree();
    write(
      root,
      "plugins/src/base/hooks/lonely-guard.sh",
      guardSource("This guard has no Codex or OpenCode port yet.")
    );

    const report = sweep(root);

    expect(report.claims).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("reads zero sources from an empty tree and says so instead of passing", () => {
    const root = makeTree();

    const report = sweep(root);

    expect(report.files).toBe(0);
    expect(formatReport(report)).toContain("ZERO guard sources read");
  });

  it("recognises the claim and its surfaces without the surrounding clause", () => {
    const blocks = commentBlocks(guardSource(STALE_CLAIM));
    const claims = claimsIn(blocks[0]!.text);

    expect(claims.length).toBe(1);
    expect(claims[0]!.surfaces).toEqual(["antigravity", "codex", "opencode"]);
    expect(claims[0]!.text).toBe("no Antigravity, Codex or OpenCode port");
  });

  it("ignores a sentence that names a surface without claiming a missing port", () => {
    const source = [
      "# The Codex port resolves its own root, so no path is passed to it.",
      "# Its OpenCode sibling reads the same environment variable.",
      "",
    ].join("\n");

    expect(claimsIn(commentBlocks(source)[0]!.text)).toEqual([]);
  });

  it("derives one guard id from each surface's file-naming convention", () => {
    expect(guardIdFor("plugins/src/base/hooks/block-no-verify.sh")).toBe(
      REAL_GUARD
    );
    expect(guardIdFor("plugins/src/base/hooks/block-no-verify.agy.sh")).toBe(
      REAL_GUARD
    );
    expect(
      guardIdFor("src/opencode/plugin-templates/lisa-block-no-verify.ts")
    ).toBe(REAL_GUARD);
    expect(guardIdFor("src/codex/scripts/block-no-verify.sh")).toBe(REAL_GUARD);
    expect(guardIdFor("plugins/src/base/hooks/README.md")).toBeUndefined();
    expect(
      guardIdFor("src/opencode/plugin-templates/unprefixed.ts")
    ).toBeUndefined();
  });

  it("covers every supported agent surface with a port path shape", () => {
    expect(SURFACES.map(surface => surface.id)).toEqual([
      "claude",
      "codex",
      "cursor",
      "opencode",
      "antigravity",
      "copilot",
    ]);
  });

  it("resolves presence from the files rather than from a declaration", () => {
    const root = makeTree();
    write(root, DEMO_AGY_PORT, "# agy port\n");

    expect(portFor(root, DEMO_GUARD, "antigravity")).toBe(DEMO_AGY_PORT);
    expect(portFor(root, DEMO_GUARD, "codex")).toBeUndefined();
    expect(portFor(root, DEMO_GUARD, "not-a-surface")).toBeUndefined();
  });

  it("reads the dispatcher's roster and not the guards its prose names", () => {
    // The bite that keeps this reader honest. `demo-guard` appears in the
    // header sentence and nowhere in the roster; a substring sweep would call
    // it registered, which is how a note claiming a real gap would be refused
    // on the strength of a comment.
    const roster = dispatcherRoster(DISPATCHER_SOURCE);

    expect(
      [...roster].sort((left, right) => left.localeCompare(right))
    ).toEqual(["fourth-guard", "other-guard", "third-guard"]);
    expect(roster.has(DEMO_GUARD)).toBe(false);
  });

  it("registers nothing from a roster the dispatcher never closes", () => {
    // A partial parse that answered anyway would claim registration it had not
    // finished reading.
    expect(
      dispatcherRoster("#!/usr/bin/env bash\nfor guard in demo-guard \\\n").size
    ).toBe(0);
  });

  it("reads the Codex manifest structurally, arguments and all", () => {
    const manifest = JSON.stringify({
      hooks: {
        PostToolUse: [
          {
            hooks: [
              { command: "${PLUGIN_ROOT}/hooks/withdrawn-rulings.sh --hook" },
            ],
            matcher: "Bash",
          },
        ],
        PreToolUse: [
          {
            hooks: [{ command: "${PLUGIN_ROOT}/hooks/demo-guard.sh" }],
            matcher: "Bash",
          },
        ],
      },
    });

    expect(
      [...codexHooksManifest(manifest)].sort((left, right) =>
        left.localeCompare(right)
      )
    ).toEqual([DEMO_GUARD, "withdrawn-rulings"]);
  });

  it("registers nothing from a manifest it cannot parse", () => {
    expect(codexHooksManifest("{ not json").size).toBe(0);
  });

  it("refuses a Codex gap note when a registration channel runs the guard", () => {
    // The defect this pair was filed for. `src/codex/scripts/` is the RETIRED
    // linked-script layout, so a guard's absence from it proves nothing — and a
    // check that read only that directory returned a clean tick on a note that
    // was false (CodySwannGT/lisa#3750).
    const root = makeTree();
    write(root, DEMO_GUARD_SOURCE, guardSource(TRUE_CLAIM));
    write(
      root,
      DISPATCHER,
      DISPATCHER_SOURCE.replace(
        "for guard in other-guard",
        `for guard in ${DEMO_GUARD}`
      )
    );

    const report = sweep(root);

    expect(report.claims).toBe(1);
    expect(report.findings.length).toBe(1);
    expect(report.findings[0]!.surface).toBe("codex");
    expect(report.findings[0]!.evidence).toBe(DISPATCHER);
  });

  it("keeps accepting the same note when no channel runs the guard", () => {
    // The negative control for the case above, over a tree identical but for
    // the roster entry. Without it, a reader that reported every guard as
    // registered would satisfy the refusal assertion.
    const root = makeTree();
    write(root, DEMO_GUARD_SOURCE, guardSource(TRUE_CLAIM));
    write(root, DISPATCHER, DISPATCHER_SOURCE);

    const report = sweep(root);

    expect(report.claims).toBe(1);
    expect(report.findings).toEqual([]);
  });

  it("resolves a registration only for the surface that declares one", () => {
    const root = makeTree();
    write(
      root,
      CODEX_MANIFEST,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              hooks: [{ command: `\${PLUGIN_ROOT}/hooks/${DEMO_GUARD}.sh` }],
              matcher: "Bash",
            },
          ],
        },
      })
    );

    expect(registryFor(root, DEMO_GUARD, "codex")).toBe(CODEX_MANIFEST);
    expect(registryFor(root, DEMO_GUARD, "antigravity")).toBeUndefined();
    expect(evidenceFor(root, DEMO_GUARD, "codex")).toBe(CODEX_MANIFEST);
  });

  it("finds nothing in this repository while having read something", () => {
    // `claims` is deliberately NOT asserted above zero. This repository has no
    // open parity gap left to record, so pinning a claim here would make the
    // suite fail the moment the last gap closes — a gate whose remedy is
    // forbidden. The grammar's liveness is proven by the fixture cases instead,
    // which is where it belongs.
    const report = sweep(REPO_ROOT);

    expect(report.findings).toEqual([]);
    expect(report.files).toBeGreaterThan(0);
    expect(formatReport(report)).toContain(BLIND_SPOTS[0]!);
  });
});

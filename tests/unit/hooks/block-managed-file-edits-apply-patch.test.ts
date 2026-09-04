/**
 * `apply_patch` coverage for `block-managed-file-edits.sh` (CodySwannGT/lisa#3776).
 *
 * The guard dispatched on two arms — `Write | Edit | MultiEdit | NotebookEdit |
 * Update` and `Bash` — and `apply_patch` matched neither. It fell off the end of
 * the `case` and exited 0, so every `apply_patch` write to a copy-overwrite
 * template was allowed.
 *
 * That is not a missing registration. `src/codex/enforcement-fallback-installer.ts`
 * registers the dispatcher that runs this guard on
 * `matcher: "Bash|Edit|Write|apply_patch"`, so the envelope was already being
 * delivered to a guard with no arm for it. A registered guard that receives the
 * call and allows it is worse than an unregistered one, because the wiring reads
 * as complete — and `apply_patch` is Codex's primary edit mechanism, so the most
 * common Codex write path was the unguarded one.
 *
 * The envelope carries no `file_path`: it holds the whole patch as a STRING on
 * `tool_input.command`, naming its targets in `*** Add File:` / `*** Update
 * File:` / `*** Delete File:` headers, many per patch (verified against
 * codex-cli 0.125.0 in `src/codex/scripts/_extract-edit-paths.sh`).
 *
 * Every case runs against a synthetic HOST project. The guard stands down inside
 * Lisa's own repository, where these files ARE the originals, so probing in-tree
 * reports ALLOW for everything and proves nothing.
 * @module tests/unit/hooks/block-managed-file-edits-apply-patch
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  runGuard,
  scratchDir,
  sourceGuard,
} from "./support/executed-script-reach.js";

const GUARD = sourceGuard("block-managed-file-edits.sh");

/** A copy-overwrite template, host-relative — the path the guard must defend. */
const MANAGED = "scripts/lisa-hooks/block-no-verify.sh";
/** A path the host owns outright. */
const UNMANAGED = "src/app.ts";
/** The patch envelope's opening sentinel. */
const PATCH_OPEN = "*** Begin Patch";
/** The patch envelope's closing sentinel. */
const PATCH_CLOSE = "*** End Patch";

const host = scratchDir("managed-apply-patch-host");

/**
 * Drive the guard with an `apply_patch` payload, as the host project.
 * @param patch - The full patch text Codex would hand the tool.
 * @returns The exit status; 2 means refused.
 */
const runPatch = (patch: string): number | null =>
  runGuard(
    GUARD,
    { tool_name: "apply_patch", tool_input: { command: patch } },
    {
      cwd: host,
      env: { CLAUDE_PROJECT_DIR: host, LISA_ALLOW_MANAGED_FILE_WRITE: "" },
    }
  ).status;

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
});

describe("block-managed-file-edits.sh apply_patch arm", () => {
  // Each header form is asserted separately rather than sampled. A patch that
  // DELETES a managed template forks it as surely as one that rewrites it, and
  // an arm matching only `Update File:` would pass a sampled test.
  it.each([
    ["Update File", `*** Update File: ${MANAGED}\n@@\n-local\n+tampered`],
    ["Add File", `*** Add File: ${MANAGED}\n+tampered`],
    ["Delete File", `*** Delete File: ${MANAGED}`],
  ])("refuses a managed target under *** %s", (_label, body) => {
    expect(runPatch(`${PATCH_OPEN}\n${body}\n${PATCH_CLOSE}`)).toBe(
      EXIT_BLOCKED
    );
  });

  it("refuses a multi-file patch whose managed target is not first", () => {
    // The envelope's defining property is that one call carries many files, so
    // an arm that classified only the first header would report a confident
    // allow about a patch it had not finished reading.
    const patch = [
      PATCH_OPEN,
      `*** Update File: ${UNMANAGED}`,
      "@@",
      "-app",
      "+edited",
      `*** Update File: ${MANAGED}`,
      "@@",
      "-local",
      "+tampered",
      PATCH_CLOSE,
    ].join("\n");
    expect(runPatch(patch)).toBe(EXIT_BLOCKED);
  });

  it("names the managed file and the escape hatch in the refusal", () => {
    const { stderr } = runGuard(
      GUARD,
      {
        tool_name: "apply_patch",
        tool_input: {
          command: `${PATCH_OPEN}\n*** Update File: ${MANAGED}\n@@\n-local\n+tampered\n${PATCH_CLOSE}`,
        },
      },
      {
        cwd: host,
        env: { CLAUDE_PROJECT_DIR: host, LISA_ALLOW_MANAGED_FILE_WRITE: "" },
      }
    );
    expect(stderr).toContain(MANAGED);
    expect(stderr).toContain("LISA_ALLOW_MANAGED_FILE_WRITE=1");
  });

  // ── Rejection controls ────────────────────────────────────────────────────
  // An arm that matches `*** Update File:` and refuses is satisfied by every
  // case above while refusing every patch in the repository. These are the
  // cases that separate the two, and this guard's whole risk is being invisible
  // when it is wrong in that direction.
  describe("rejection controls", () => {
    it("allows a patch naming only files the host owns", () => {
      const patch = [
        PATCH_OPEN,
        `*** Update File: ${UNMANAGED}`,
        "@@",
        "-app",
        "+edited",
        "*** Add File: src/new.ts",
        "+export const x = 1;",
        PATCH_CLOSE,
      ].join("\n");
      expect(runPatch(patch)).toBe(EXIT_ALLOWED);
    });

    it("allows a patch that names the template only in a diff BODY", () => {
      // Keys on the header, not on the text containing the path. Documentation
      // that cites a managed file is an ordinary edit, and refusing it would
      // make the guard fire on prose.
      const patch = [
        PATCH_OPEN,
        "*** Update File: docs/notes.md",
        "@@",
        "-see also",
        `+see also ${MANAGED}`,
        PATCH_CLOSE,
      ].join("\n");
      expect(runPatch(patch)).toBe(EXIT_ALLOWED);
    });

    it("allows an apply_patch envelope carrying no command", () => {
      expect(runPatch("")).toBe(EXIT_ALLOWED);
    });

    it("allows a patch with no file headers at all", () => {
      expect(runPatch(`${PATCH_OPEN}\n${PATCH_CLOSE}`)).toBe(EXIT_ALLOWED);
    });
  });

  // ── The parity pin ────────────────────────────────────────────────────────
  it("recognises exactly the header forms the Codex helper extracts", () => {
    // The arm restates `_extract-edit-paths.sh`'s header match rather than
    // sourcing it, because the two ship to install locations that cannot reach
    // each other: this guard to a host's `scripts/lisa-hooks/`, that helper to
    // `.codex/hooks/lisa/`. A restatement that nothing pins is a gap waiting to
    // open — if Codex adds a header form to one and not the other, the guard
    // silently stops covering it, which is this defect returning in miniature.
    //
    // Comparing the header SETS is the check that matters; whole-byte parity
    // would be permanently red, since one file classifies and the other only
    // extracts.
    const headers = (source: string): readonly string[] =>
      [...source.matchAll(/\*\*\* (Add|Update|Delete) File: /g)]
        .map(match => match[1] as string)
        .filter((value, index, all) => all.indexOf(value) === index)
        .toSorted((a, b) => a.localeCompare(b));

    const guardHeaders = headers(readFileSync(GUARD, "utf-8"));
    const helperHeaders = headers(
      readFileSync(
        path.join(
          import.meta.dirname,
          "../../../src/codex/scripts/_extract-edit-paths.sh"
        ),
        "utf-8"
      )
    );

    expect(guardHeaders).toEqual(["Add", "Delete", "Update"]);
    expect(guardHeaders).toEqual(helperHeaders);
  });
});

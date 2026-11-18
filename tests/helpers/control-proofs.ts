/**
 * Paired proofs for the fixture repositories (CodySwannGT/lisa#4995).
 *
 * A proof needs three real things: a check that can be started, a change that
 * breaks its rule and a change that does not. The checks here are one-line
 * Node programs given as argument lists, so they run on any machine that runs
 * the suite, and the changes are real patch files committed in the fixture
 * under `.lisa/controls/proofs/`.
 * @module tests/helpers/control-proofs
 */
import { cpSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ProofRun } from "../../src/controls/proof-types.js";
import {
  buildControlAuditFixture,
  CONTROL_AUDIT_FIXTURE_FILES,
  type ControlAuditFixture,
  type ControlAuditFixtureName,
} from "./control-audit-fixtures.js";
import { configFile, evidenceAt, type GatesBlock } from "./control-register.js";

const NODE = process.execPath;

/** The folder every proof file lives in, from the repository root. */
export const PROOFS = ".lisa/controls/proofs";

/** What a failing check prints, and what an entry declares it prints. */
export const FAILURE_TEXT = "Found 1 error";

/** The word a planted violation puts in a file. */
export const VIOLATION_MARK = "PLANTED_VIOLATION";

/** The F-none source file the proofs change. */
export const F_NONE_SOURCE = "src/fixture_none/greeting.py";

/** The file the F-mixed `api` proofs change, from the repository root. */
export const API_SOURCE = "api/src/api/greeting.py";

/** The file the F-mixed `web` proofs change, from the repository root. */
export const WEB_SOURCE = "web/src/index.ts";

/**
 * A check that fails, with the declared failure text, when a file carries
 * the planted violation, and passes otherwise.
 * @param file - The file to read, from the folder the check starts in
 * @returns The check, as an argument list
 */
export function checks(file: string): readonly string[] {
  const named = JSON.stringify(file);
  const finding = JSON.stringify(`${file}:1: planted violation`);
  return [
    NODE,
    "-e",
    [
      `const bad = require('node:fs').readFileSync(${named}, 'utf8').includes('${VIOLATION_MARK}');`,
      `if (bad) { console.log(${finding}); console.log('${FAILURE_TEXT}'); process.exit(1); }`,
      "console.log('All checks passed');",
    ].join(" "),
  ];
}

/** A check that turns every change away, with the declared failure text. */
export const REJECTS_EVERYTHING: readonly string[] = [
  NODE,
  "-e",
  `console.log('${FAILURE_TEXT}'); process.exit(1);`,
];

/** A check that lets every change through. */
export const ACCEPTS_EVERYTHING: readonly string[] = [
  NODE,
  "-e",
  "console.log('All checks passed');",
];

/** A check that fails without ever printing the declared failure text. */
export const FAILS_FOR_ANOTHER_REASON: readonly string[] = [
  NODE,
  "-e",
  "console.error('configuration file not found'); process.exit(2);",
];

/** A check that is still running a minute after it starts. */
export const NEVER_FINISHES: readonly string[] = [
  NODE,
  "-e",
  "setTimeout(() => {}, 60000);",
];

/**
 * A patch that adds one line to the end of a file.
 * @param file - The file, from the repository root
 * @param content - The file's current content
 * @param added - The line to add
 * @returns The patch file's content
 */
export function appendLinePatch(
  file: string,
  content: string,
  added: string
): string {
  const lines = content.replace(/\n$/u, "").split("\n");
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${lines.length} +1,${lines.length + 1} @@`,
    ...lines.map(line => ` ${line}`),
    `+${added}`,
    "",
  ].join("\n");
}

/**
 * A patch that replaces the whole content of a file that is already there.
 * @param file - The file, from the repository root
 * @param before - The file's current content
 * @param after - What it holds once the patch is applied
 * @returns The patch file's content
 */
export function replaceFilePatch(
  file: string,
  before: string,
  after: string
): string {
  const lines = (content: string): readonly string[] =>
    content.replace(/\n$/u, "").split("\n");
  const [old, replaced] = [lines(before), lines(after)];
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${old.length} +1,${replaced.length} @@`,
    ...old.map(line => `-${line}`),
    ...replaced.map(line => `+${line}`),
    "",
  ].join("\n");
}

/**
 * The two patches of a proof for one fixture file.
 * @param fixture - The fixture the file belongs to
 * @param file - The file, from the repository root
 * @returns A change that plants the violation and one that does not
 */
export function proofPatches(
  fixture: ControlAuditFixtureName,
  file: string
): { readonly violation: string; readonly clean: string } {
  const content = CONTROL_AUDIT_FIXTURE_FILES[fixture][file];
  if (content === undefined) throw new Error(`${fixture} has no ${file}`);
  return {
    violation: appendLinePatch(file, content, `${VIOLATION_MARK} = 1`),
    clean: appendLinePatch(file, content, "# a harmless change"),
  };
}

/** One part of a gate with a proof, as the gates block writes it. */
export interface ProvedPart {
  /** The folder the part covers; the whole repository by default. */
  readonly scope?: string;
  readonly command: readonly string[];
  /** The proof's name; its files are `<name>.violation.patch` and `.clean.patch`. */
  readonly name?: string;
  /** Leave out one half of the proof, or both. */
  readonly without?: readonly ("violation" | "clean")[];
  /** The declared failure text; {@link FAILURE_TEXT} by default, `null` for none. */
  readonly failure_shape?: readonly string[] | null;
  readonly timeout_seconds?: number;
  readonly external_effects?: readonly string[];
}

/**
 * One part as the gates block writes it.
 * @param part - The part
 * @returns The declared part
 */
export function declaredPart(part: ProvedPart): Record<string, unknown> {
  const { name = "lint", without = [], failure_shape: shape } = part;
  const halves = (["violation", "clean"] as const).filter(
    half => !without.includes(half)
  );
  const scope = part.scope ?? ".";
  return {
    scope,
    command: part.command,
    evidence: evidenceAt(scope === "." ? "Makefile" : `${scope}/Makefile`),
    proof: {
      ...Object.fromEntries(
        halves.map(half => [half, `${PROOFS}/${name}.${half}.patch`])
      ),
      ...(shape === null ? {} : { failure_shape: shape ?? [FAILURE_TEXT] }),
      ...(part.timeout_seconds === undefined
        ? {}
        : { timeout_seconds: part.timeout_seconds }),
      ...(part.external_effects === undefined
        ? {}
        : { external_effects: part.external_effects }),
    },
  };
}

/**
 * A gates block with one gate required at commit, checked by the given parts.
 * @param parts - The gate's parts
 * @param gate - The gate's id
 * @param moments - The moments the gate is required at
 * @returns The gates block
 */
export function provedGates(
  parts: readonly ProvedPart[],
  gate = "code-style",
  moments: readonly string[] = ["commit"]
): GatesBlock {
  return {
    [gate]: {
      ...Object.fromEntries(moments.map(moment => [moment, "required"])),
      criteria: ["SI7"],
      parts: parts.map(part => declaredPart(part)),
    },
  };
}

/** The proof files of a fixture: path from the repository root to content. */
export type ProofFiles = Readonly<Record<string, string>>;

/**
 * The files of one proof, named the way {@link declaredPart} names them.
 * @param patches - The two patches
 * @param patches.violation - The change that plants the violation
 * @param patches.clean - The change that does not
 * @param name - The proof's name
 * @returns The proof files
 */
export function proofFiles(
  patches: { readonly violation: string; readonly clean: string },
  name = "lint"
): ProofFiles {
  return {
    [`${PROOFS}/${name}.violation.patch`]: patches.violation,
    [`${PROOFS}/${name}.clean.patch`]: patches.clean,
  };
}

/**
 * Build a fixture repository with a gates declaration and its proof files
 * committed in it.
 * @param gates - The gates block
 * @param files - The proof files; a working pair for F-none by default
 * @param name - Which fixture
 * @returns The repository
 */
export function buildProofFixture(
  gates: GatesBlock,
  files: ProofFiles = proofFiles(proofPatches("F-none", F_NONE_SOURCE)),
  name: ControlAuditFixtureName = "F-none"
): ControlAuditFixture {
  return buildControlAuditFixture(name, {
    extraFiles: { ".lisa.config.json": configFile(gates), ...files },
  });
}

/** A disposable copy of a repository, removed by `cleanup`. */
export interface WorkspaceCopy {
  /** The copy, with every link in its own path resolved. */
  readonly directory: string;
  readonly cleanup: () => void;
}

/**
 * Copy a repository into a new temporary folder.
 * @param repoPath - The repository
 * @param withGit - Whether the copy keeps the repository's `.git`
 * @returns The copy
 */
export function workspaceCopy(repoPath: string, withGit = true): WorkspaceCopy {
  const directory = realpathSync(
    mkdtempSync(path.join(tmpdir(), "lisa-proof-workspace-"))
  );
  cpSync(repoPath, directory, {
    recursive: true,
    filter: source => withGit || path.basename(source) !== ".git",
  });
  return {
    directory,
    cleanup: () => rmSync(directory, { force: true, recursive: true }),
  };
}

/**
 * A run's results as text, with every time replaced by one fixed word.
 * @param run - The results
 * @returns The text two runs are compared by
 */
export function withoutTimes(run: ProofRun): string {
  return JSON.stringify(
    run,
    (key, value: unknown) =>
      key === "started_at" || key === "completed_at" ? "<time>" : value,
    2
  );
}

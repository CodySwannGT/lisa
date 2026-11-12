/**
 * The shared case table for `block-suppress-directives` growth semantics
 * (CodySwannGT/lisa#4492).
 *
 * The hook refuses a write that GROWS the set of suppression directives — a new
 * one, another copy of one, or a textual change that widens one — and lets
 * through a write that keeps or removes them. Every shipped copy (the Claude
 * TypeScript-stack script, the Codex port, the OpenCode port) is driven through
 * this one table so the copies cannot quietly disagree about what "growth" is.
 *
 * Directive tokens are assembled from parts at runtime so this source file does
 * not itself contain a literal comment directive — the hook under test is
 * installed in this repository and would refuse writing one.
 * @module tests/helpers/suppress-directive-growth-cases
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The comment opener, kept out of the literal source (see module note). */
const SLASH = "//";
const BLOCK_OPEN = "/*";

/** A scoped, one-line disable carrying a reason. */
export const NEXT_LINE_DISABLE = `${SLASH} ${"eslint"}-disable-next-line no-console -- reason`;

/** A second, different scoped disable. */
export const OTHER_DISABLE = `${SLASH} ${"eslint"}-disable-next-line no-alert -- reason`;

/** The file-wide disable a scoped one must never silently widen into. */
export const FILE_WIDE_DISABLE = `${BLOCK_OPEN} ${"eslint"}-disable */`;

/** A type-checker suppression. */
export const TS_IGNORE = `${SLASH} @${"ts"}-ignore`;

/** What is already on disk before a Write, when anything is. */
export type Disk =
  | { readonly kind: "absent" }
  | { readonly kind: "file"; readonly text: string }
  | { readonly kind: "unreadable"; readonly text: string }
  | { readonly kind: "directory" };

/** One Edit pair; `oldText` undefined means the payload omits `old_string`. */
export interface EditPair {
  readonly oldText: string | undefined;
  readonly newText: string;
}

/** The tool call one case makes. */
export type Call =
  | { readonly tool: "Write"; readonly content: string }
  | { readonly tool: "Edit"; readonly edit: EditPair }
  | { readonly tool: "MultiEdit"; readonly edits: readonly EditPair[] };

/** One growth case: what is on disk, what the tool does, what must happen. */
export interface GrowthCase {
  readonly name: string;
  readonly disk: Disk;
  readonly call: Call;
  readonly refused: boolean;
}

const ABSENT: Disk = { kind: "absent" };
const BODY = "export const a = 1;\n";
const OTHER_BODY = "export const b = 2;\n";
const withDirective = (directive: string, body = BODY): string =>
  `${directive}\nconsole.log(1);\n${body}`;

/** Every case each shipped copy must judge identically. */
export const GROWTH_CASES: readonly GrowthCase[] = [
  {
    name: "allows a Write that keeps the one existing directive unchanged",
    disk: { kind: "file", text: withDirective(NEXT_LINE_DISABLE) },
    call: {
      tool: "Write",
      content: withDirective(NEXT_LINE_DISABLE, OTHER_BODY),
    },
    refused: false,
  },
  {
    name: "refuses a Write that adds a second directive",
    disk: { kind: "file", text: withDirective(NEXT_LINE_DISABLE) },
    call: {
      tool: "Write",
      content:
        withDirective(NEXT_LINE_DISABLE) + withDirective(OTHER_DISABLE, ""),
    },
    refused: true,
  },
  {
    name: "refuses a Write that adds another copy of an existing directive",
    disk: { kind: "file", text: withDirective(NEXT_LINE_DISABLE) },
    call: {
      tool: "Write",
      content:
        withDirective(NEXT_LINE_DISABLE) + withDirective(NEXT_LINE_DISABLE, ""),
    },
    refused: true,
  },
  {
    name: "allows a Write that removes a directive",
    disk: {
      kind: "file",
      text: withDirective(NEXT_LINE_DISABLE) + withDirective(TS_IGNORE, ""),
    },
    call: { tool: "Write", content: withDirective(NEXT_LINE_DISABLE) },
    refused: false,
  },
  {
    name: "refuses a Write of a new file that carries a directive",
    disk: ABSENT,
    call: { tool: "Write", content: withDirective(NEXT_LINE_DISABLE) },
    refused: true,
  },
  {
    name: "refuses widening a next-line disable into a file-wide one",
    disk: { kind: "file", text: withDirective(NEXT_LINE_DISABLE) },
    call: { tool: "Write", content: withDirective(FILE_WIDE_DISABLE) },
    refused: true,
  },
  {
    name: "refuses a Write over an existing file it cannot read",
    disk: { kind: "unreadable", text: withDirective(NEXT_LINE_DISABLE) },
    call: { tool: "Write", content: withDirective(NEXT_LINE_DISABLE) },
    refused: true,
  },
  {
    name: "refuses a Write whose path is a directory it cannot read as a file",
    disk: { kind: "directory" },
    call: { tool: "Write", content: withDirective(NEXT_LINE_DISABLE) },
    refused: true,
  },
  {
    name: "allows an Edit hunk spanning an unchanged directive",
    disk: ABSENT,
    call: {
      tool: "Edit",
      edit: {
        oldText: withDirective(NEXT_LINE_DISABLE),
        newText: withDirective(NEXT_LINE_DISABLE, OTHER_BODY),
      },
    },
    refused: false,
  },
  {
    name: "refuses an Edit that adds a directive",
    disk: ABSENT,
    call: {
      tool: "Edit",
      edit: { oldText: BODY, newText: withDirective(TS_IGNORE) },
    },
    refused: true,
  },
  {
    name: "refuses an Edit whose rule list gets longer",
    disk: ABSENT,
    call: {
      tool: "Edit",
      edit: {
        oldText: withDirective(NEXT_LINE_DISABLE),
        newText: withDirective(`${NEXT_LINE_DISABLE}, no-alert`),
      },
    },
    refused: true,
  },
  {
    name: "refuses an Edit with a directive and no old text to compare",
    disk: ABSENT,
    call: {
      tool: "Edit",
      edit: { oldText: undefined, newText: withDirective(TS_IGNORE) },
    },
    refused: true,
  },
  {
    name: "allows an Edit that removes a directive",
    disk: ABSENT,
    call: {
      tool: "Edit",
      edit: { oldText: withDirective(TS_IGNORE), newText: BODY },
    },
    refused: false,
  },
  {
    name: "refuses a MultiEdit where one edit grows",
    disk: ABSENT,
    call: {
      tool: "MultiEdit",
      edits: [
        {
          oldText: withDirective(NEXT_LINE_DISABLE),
          newText: withDirective(NEXT_LINE_DISABLE, OTHER_BODY),
        },
        { oldText: BODY, newText: withDirective(TS_IGNORE) },
      ],
    },
    refused: true,
  },
  {
    name: "refuses a MultiEdit that moves a directive from one edit to another",
    disk: ABSENT,
    call: {
      tool: "MultiEdit",
      edits: [
        { oldText: withDirective(TS_IGNORE), newText: BODY },
        { oldText: BODY, newText: withDirective(TS_IGNORE) },
      ],
    },
    refused: true,
  },
  {
    name: "allows a MultiEdit whose every edit keeps its directives",
    disk: ABSENT,
    call: {
      tool: "MultiEdit",
      edits: [
        {
          oldText: withDirective(NEXT_LINE_DISABLE),
          newText: withDirective(NEXT_LINE_DISABLE, OTHER_BODY),
        },
        { oldText: BODY, newText: "export const c = 3;\n" },
      ],
    },
    refused: false,
  },
];

/**
 * Builds the Claude/Codex PreToolUse envelope for one case's tool call.
 * @param filePath The path the tool targets.
 * @param call The tool call.
 * @returns The JSON envelope written to the hook's stdin.
 */
export const hookEnvelope = (filePath: string, call: Call): string => {
  const pair = (edit: EditPair): Record<string, string> =>
    edit.oldText === undefined
      ? { new_string: edit.newText }
      : { old_string: edit.oldText, new_string: edit.newText };
  const input =
    call.tool === "Write"
      ? { file_path: filePath, content: call.content }
      : call.tool === "Edit"
        ? { file_path: filePath, ...pair(call.edit) }
        : { file_path: filePath, edits: call.edits.map(pair) };
  return JSON.stringify({ tool_name: call.tool, tool_input: input });
};

/**
 * Lays out one case's disk state inside a scratch directory.
 * @param dir An empty scratch directory the caller owns and removes.
 * @param disk What must be on disk before the call.
 * @returns The absolute path the tool call targets.
 */
export const prepareDisk = (dir: string, disk: Disk): string => {
  const target = path.join(dir, "target.ts");
  if (disk.kind === "directory") mkdirSync(target);
  if (disk.kind === "file" || disk.kind === "unreadable") {
    writeFileSync(target, disk.text);
  }
  if (disk.kind === "unreadable") chmodSync(target, 0o000);
  return target;
};

/**
 * Whether this process can read a mode-000 file anyway (it runs as root), which
 * makes the "unreadable" case meaningless rather than failing.
 */
export const RUNS_AS_ROOT = process.getuid?.() === 0;

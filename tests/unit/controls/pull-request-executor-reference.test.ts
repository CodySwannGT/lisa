/**
 * The contract for a pull-request executor on a platform other than GitHub
 * says what the code does.
 *
 * The contract is a reference document an agent follows to write a pipeline
 * file Lisa ships no template for. It quotes the gate runner's invocation and
 * exit codes, the declaration key and what the register writes for it. Each
 * quote is only useful while it matches the code that decides it. This suite
 * holds the document to that code, on every agent surface it ships to
 * (CodySwannGT/lisa#4991).
 * @module tests/unit/controls/pull-request-executor-reference
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EXECUTOR_FIELD,
  EXECUTOR_FIELDS,
  LISA_EXECUTOR_PLATFORM,
  PULL_REQUEST,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import {
  EXIT,
  main,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { createProgram } from "../../../src/cli/index.js";
import { CONTROLS_COMMAND } from "../../../src/cli/controls-cmd.js";
import { EVIDENCE_PATH } from "../../../src/controls/evidence.js";
import { PROOF_HALVES } from "../../../src/controls/proof-halves.js";
import {
  STATUS_DRIFT_NOTE,
  unprovedNote,
} from "../../../src/controls/pull-request-executor.js";
import { CONTROL_REGISTER_PATH } from "../../../src/controls/register-types.js";
import {
  registerSchemaErrors,
  type GatesBlock,
} from "../../helpers/control-register.js";
import {
  registerWithEvidence,
  unprovedIds,
  withExecutor,
} from "../controls/support/executor-fixtures.js";
import { F_MIXED_GATES } from "../../helpers/control-register.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

const REFERENCE = path.join(
  "lisa-enforce",
  "references",
  "pull-request-executor.md"
);

/** Skill roots per agent surface; the first is the source the rest are built from. */
const SURFACES = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
] as const;

/** The command a pipeline file must run, exactly as the document must give it. */
const INVOCATION = `node scripts/lisa-run-gates.mjs --moment=${PULL_REQUEST}`;

/**
 * Read the reference document of one surface.
 * @param surface - A skill root, relative to the repository
 * @returns The document
 */
function reference(surface: string): string {
  return readFileSync(path.join(REPO_ROOT, surface, REFERENCE), "utf8");
}

const TEXT = reference(SURFACES[0]);

/** The document with every run of white space as one space, so a wrap is not a difference. */
const PROSE = TEXT.replaceAll(/\s+/gu, " ");

/**
 * Every fenced block of a language in the document, with the line before it.
 * @param language - The fence's language tag
 * @returns Each block's content and the last line of prose above it
 */
function fenced(
  language: string
): readonly { readonly body: string; readonly lead: string }[] {
  const fence = "`".repeat(3);
  const blocks = new RegExp(
    String.raw`([^\n]*)\n\n[ \t]*${fence}${language}\n([\s\S]*?)\n[ \t]*${fence}`,
    "gu"
  );
  return [...TEXT.matchAll(blocks)].map(match => ({
    lead: match[1] ?? "",
    body: (match[2] ?? "")
      .split("\n")
      .map(line => line.trim())
      .join("\n"),
  }));
}

describe("the pull-request executor contract", () => {
  it.each(SURFACES.slice(1))("ships unchanged to %s", surface => {
    expect(reference(surface)).toBe(TEXT);
  });

  it("gives the runner's invocation exactly, in the contract and in every example", () => {
    const shell = fenced("bash").map(block => block.body);
    const examples = fenced("yaml");

    expect(shell).toContain(INVOCATION);
    expect(examples.length).toBeGreaterThan(0);
    expect(
      examples.filter(example => !example.body.includes(INVOCATION))
    ).toEqual([]);
    expect(TEXT.match(/lisa-run-gates\.mjs[^\n`]*/gu)).toEqual(
      expect.arrayContaining([`lisa-run-gates.mjs --moment=${PULL_REQUEST}`])
    );
  });

  it("says the moment is written with an equals sign, which is what the runner takes", () => {
    expect(main(["--moment", PULL_REQUEST])).toBe(EXIT.RUNNER_FAILED);
    expect(PROSE).toContain(
      `The runner refuses \`--moment ${PULL_REQUEST}\` with a space.`
    );
  });

  it("names the Node.js version the shipped scripts are held to", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    ) as { readonly engines: { readonly node: string } };
    const [major] = manifest.engines.node.split(".");

    expect(PROSE).toContain(`Node.js ${major ?? ""} or later`);
  });

  it("lists every exit code the runner has, and passes the pipeline on one only", () => {
    const rows = TEXT.split("\n")
      .map(line => line.split("|").map(cell => cell.trim()))
      .filter(cells => /^`\d+`$/u.test(cells[1] ?? ""))
      .map(cells => ({
        code: Number((cells[1] ?? "").replaceAll("`", "")),
        pipeline: cells[3] ?? "",
      }));

    expect(
      rows.map(row => row.code).sort((left, right) => left - right)
    ).toEqual(Object.values(EXIT).sort((left, right) => left - right));
    expect(
      rows.filter(row => row.pipeline === "Pass.").map(row => row.code)
    ).toEqual([EXIT.PROVED]);
    expect(
      rows.filter(row => row.pipeline !== "Pass." && row.pipeline !== "Fail.")
    ).toEqual([]);
  });

  it.each([
    "1. **It runs the gate runner at the pull-request moment.**",
    "2. **A non-zero exit fails the pipeline.**",
    "3. **It runs on every change to a merge request into the protected branch.**",
    "4. **The author of the change cannot skip it.**",
  ])("states the requirement %s", requirement => {
    expect(PROSE).toContain(requirement);
  });

  it("marks every platform snippet as an example and no platform's syntax as the contract", () => {
    expect(
      fenced("yaml").filter(example => !example.lead.startsWith("Example only"))
    ).toEqual([]);
    expect(PROSE).toContain(
      "Never treat one platform's syntax as the contract."
    );
    expect(PROSE).toContain("They are **examples only**.");
  });

  it("leaves GitHub alone", () => {
    expect(PROSE).toContain("**GitHub:** stop. Nothing here applies.");
    expect(PROSE).toContain(
      "never adds, edits or removes a file under `.github/workflows/`"
    );
  });
});

describe("what the contract says about the declaration and the register", () => {
  const declared = fenced("json")
    .map(block => JSON.parse(block.body) as Record<string, unknown>)
    .find(document => "gates" in document) as
    | { readonly gates: GatesBlock }
    | undefined;

  it("names the key and its two fields as the gate registry reads them", () => {
    const entry = (
      Object.values(declared?.gates ?? {})[0] as Record<string, unknown>
    )[PULL_REQUEST] as Record<string, Record<string, unknown>>;

    expect(Object.keys(entry[EXECUTOR_FIELD] ?? {})).toEqual([
      ...EXECUTOR_FIELDS,
    ]);
    expect(PROSE).toContain(
      `\`${LISA_EXECUTOR_PLATFORM}\` is the one platform Lisa ships the file for.`
    );
  });

  it("shows a declaration the register accepts and marks unproved", async () => {
    const register = await registerWithEvidence(declared?.gates ?? {});

    expect(unprovedIds(register)).toEqual(["code-style@."]);
    expect(registerSchemaErrors(register)).toEqual([]);
  });

  it("shows the enforcement point the register writes for it", async () => {
    const register = await registerWithEvidence(declared?.gates ?? {});
    const shown = fenced("json")
      .map(block => JSON.parse(block.body) as Record<string, unknown>)
      .find(document => "moment" in document);

    expect(shown).toEqual(
      register.entries[0]?.enforcement_points.find(
        point => point.moment === PULL_REQUEST
      )
    );
  });

  it("quotes the line the command prints for unproved entries", async () => {
    const note = unprovedNote(
      await registerWithEvidence(withExecutor(F_MIXED_GATES))
    );

    expect(fenced("text").map(block => block.body)).toContain(
      `register: ${note ?? ""}`
    );
  });

  it("says what clears the mark, in the words the code uses", () => {
    expect(PROSE).toContain(`"status": "unproved"`);
    expect(PROSE).toContain(
      `\`${EVIDENCE_PATH}\` holding a record of **both** halves`
    );
    PROOF_HALVES.forEach(half => {
      expect(PROSE).toContain(`(\`${half}\`)`);
    });
    expect(PROSE).toContain(CONTROL_REGISTER_PATH);
    expect(STATUS_DRIFT_NOTE).toContain(EVIDENCE_PATH);
    expect(PROSE).toContain("it says when the status is what differs");
  });

  it("runs only lisa controls subcommands the CLI registers", () => {
    const registered = (
      createProgram().commands.find(
        command => command.name() === CONTROLS_COMMAND
      )?.commands ?? []
    ).map(command => command.name());
    const named = [...TEXT.matchAll(/\blisa controls ([a-z][a-z-]*)/gu)].map(
      match => match[1] ?? ""
    );

    expect(named).toContain("register");
    expect(named.filter(name => !registered.includes(name))).toEqual([]);
  });
});

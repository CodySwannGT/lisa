/**
 * Every refusal `block-direct-issue-create.sh` issues must have an inverse the
 * author can execute — and the two refusals that had none are the ones that
 * turned a false positive into a property of the repository.
 *
 * A file that QUOTES a tracker-creation command became unnameable to any
 * command the guard did not recognise as a reader. `grep`, `cat` and `ls` were
 * exempted when the guard learned to ask the command-position question; `cp`
 * and `mv` were not, so relocating such a file stayed refused with no way to
 * clear it. The measured propagation case is the second half of that: after the
 * offending content had already been reworded, the refusal recurred on a
 * DIFFERENT file quoting the same command, which is what makes "reword it"
 * a remedy that does not converge.
 *
 * The second shape is prose. When `shlex` cannot lex a command the guard falls
 * back to matching the raw text, so an apostrophe in an ordinary sentence —
 * `echo the guard's <creation> behaviour` — refused a command that files
 * nothing, and the refusal then printed declaration remedies that apply to no
 * part of it. The fallback is not removable: `<creation> --title x #'` is a
 * real filing that bash runs and `shlex` rejects, so "I could not parse it"
 * must keep meaning refuse. What it can do is ask the same COMMAND POSITION
 * question the parsed path already asks.
 *
 * Both halves are asserted here, and the rejection controls are what make the
 * allows mean anything: the same file is still refused when a command RUNS it,
 * and the same unlexable text is still refused when a tracker CLI stands in
 * command position. The escape is proved not to be a bypass by performing it —
 * the printed inverse for the unparseable branch is "re-quote and run it
 * again", and a genuine undeclared creation that has been re-quoted is refused
 * by the parsed path.
 * @module tests/unit/hooks/block-direct-issue-create-refusal-inverse
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithTracker,
  runHook,
  UNDECLARED_CREATE,
} from "./support/direct-issue-create.js";

/**
 * A document that quotes a tracker creation without performing one.
 *
 * Deliberately shaped like the file the propagation case measured: prose about
 * the guard, carrying the literal command as its subject. It has no local-write
 * primitive and no transmitting primitive, so it is neither a fixture writer
 * nor a submitter — it is a document, and the class the inert-payload exemption
 * could not reach.
 */
const DOCUMENT = [
  "# Notes about the filing guard",
  "",
  `The reported failure was that \`${UNDECLARED_CREATE}\` was refused for a`,
  "title that merely described filing. The GraphQL spelling is",
  '`mutation { issueCreate(input: {teamId: "t"}) { success } }` against',
  "`https://api.github.com/repos/CodySwannGT/lisa/issues`.",
  "",
].join("\n");

/** A prose sentence whose apostrophe is the only reason it will not lex. */
const PROSE = `the guard's ${UNDECLARED_CREATE} behaviour`;

/** Two characters bash treats as a comment and `shlex` refuses outright. */
const UNLEXABLE_TAIL = " #'";

/**
 * A throwaway project holding the document above.
 * @returns The project directory and the document's absolute path.
 */
const projectWithDocument = (): { cwd: string; doc: string } => {
  const cwd = projectWithTracker();
  const dir = path.join(cwd, "docs");
  const doc = path.join(dir, "guard-notes.md");
  mkdirSync(dir, { recursive: true });
  writeFileSync(doc, DOCUMENT, "utf-8");
  return { cwd, doc };
};

describe("a file that quotes a creation stays reachable", () => {
  it.each([
    ["cp", (doc: string) => `cp ${doc} /tmp/guard-notes-copy.md`],
    ["mv", (doc: string) => `mv ${doc} /tmp/guard-notes-moved.md`],
    ["grep", (doc: string) => `grep -n truncate ${doc}`],
    ["ls", (doc: string) => `ls -l ${doc}`],
    ["cat", (doc: string) => `cat ${doc}`],
    ["echo", (doc: string) => `echo ${doc}`],
  ])("%s takes the path as data and is allowed", (_name, build) => {
    const { cwd, doc } = projectWithDocument();
    expect(runHook(bash(build(doc)), { cwd }).status).toBe(EXIT_ALLOWED);
  });

  it("REJECTION CONTROL: the same document is refused when a command runs it", () => {
    const { cwd, doc } = projectWithDocument();
    const result = runHook(bash(`bash ${doc}`), { cwd });
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(doc);
  });

  it("REJECTION CONTROL: an unrecognised program is still followed to the file", () => {
    const { cwd, doc } = projectWithDocument();
    expect(runHook(bash(`nobody-enumerated-this ${doc}`), { cwd }).status).toBe(
      EXIT_BLOCKED
    );
  });

  it("REJECTION CONTROL: copying it first does not launder running it", () => {
    const { cwd, doc } = projectWithDocument();
    expect(
      runHook(bash(`cp ${doc} /tmp/laundered.sh && bash ${doc}`), { cwd })
        .status
    ).toBe(EXIT_BLOCKED);
  });
});

describe("prose that only fails to lex is not a filing", () => {
  it.each([
    ["echo", `echo ${PROSE}`],
    ["printf", `printf '%s' ${PROSE}`],
    ["git commit", `git commit -m ${PROSE}`],
    ["grep", `grep -rn ${PROSE} .`],
  ])("%s files nothing and is allowed", (_name, command) => {
    expect(runHook(bash(command)).status).toBe(EXIT_ALLOWED);
  });

  it("REJECTION CONTROL: a tracker CLI in command position is still refused", () => {
    expect(runHook(bash(`${UNDECLARED_CREATE}${UNLEXABLE_TAIL}`)).status).toBe(
      EXIT_BLOCKED
    );
  });

  it("REJECTION CONTROL: a reader in the first segment does not vouch for the second", () => {
    expect(
      runHook(bash(`echo ok && ${UNDECLARED_CREATE}${UNLEXABLE_TAIL}`)).status
    ).toBe(EXIT_BLOCKED);
  });

  it("REJECTION CONTROL: a wrapper is stepped over rather than read as the command", () => {
    expect(
      runHook(bash(`nice -n 10 ${UNDECLARED_CREATE}${UNLEXABLE_TAIL}`)).status
    ).toBe(EXIT_BLOCKED);
  });

  it("REJECTION CONTROL: an unrecognised command word fails closed", () => {
    expect(runHook(bash(`nobody-enumerated-this ${PROSE}`)).status).toBe(
      EXIT_BLOCKED
    );
  });
});

describe("the refusal prints an inverse, and the inverse is not a bypass", () => {
  it("names re-quoting when the command could not be lexed", () => {
    const result = runHook(bash(`${UNDECLARED_CREATE}${UNLEXABLE_TAIL}`));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain("DID NOT LEX");
    expect(result.stderr).toContain("re-quote");
  });

  it("performing that inverse still refuses the undeclared creation", () => {
    expect(runHook(bash(UNDECLARED_CREATE)).status).toBe(EXIT_BLOCKED);
  });

  it("performing it on a DECLARED creation lets it through", () => {
    expect(
      runHook(bash(`${UNDECLARED_CREATE} --label status:ready`)).status
    ).toBe(EXIT_ALLOWED);
  });

  it("states both halves of the inert-payload exemption when a file was read", () => {
    const { cwd, doc } = projectWithDocument();
    const result = runHook(bash(`bash ${doc}`), { cwd });
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain("no local artifact");
    expect(result.stderr).toContain("rather than to an interpreter");
  });

  it("does not print the file remedy for a refusal that read no file", () => {
    const result = runHook(bash(UNDECLARED_CREATE));
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).not.toContain("rather than to an interpreter");
    expect(result.stderr).not.toContain("DID NOT LEX");
  });
});

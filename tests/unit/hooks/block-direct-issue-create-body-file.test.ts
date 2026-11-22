/** Relative issue bodies are resolved against the filing command's folder. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSymlink } from "../../support/borrowed-node-modules.mjs";
import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  GATE_MARKER,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

/**
 * Write a file into a throwaway project directory.
 * @param cwd - The project directory.
 * @param name - The file name.
 * @param body - The contents.
 * @returns The absolute path written.
 */
const fixture = (cwd: string, name: string, body: string): string => {
  const target = path.join(cwd, name);
  writeFileSync(target, body, "utf-8");
  return target;
};

const ORDINARY_BODY = "Ordinary issue text.\n";
const MISSING_DECLARATION = "this filing declares no readiness";

describe("the submitted issue body path", () => {
  const bodyFile = "body.md";
  const create = [
    "gh",
    "issue",
    "create",
    "--title",
    "fixture",
    "--body-file",
    bodyFile,
  ].join(" ");
  const folder = "draft notes";

  it.each(["leading cd", "tool cwd", "tool workdir"])(
    "reads the held ticket body from the %s",
    source => {
      const root = projectWithTracker();
      const drafts = path.join(root, folder);
      mkdirSync(drafts);
      fixture(root, bodyFile, "No declaration in this other file.\n");
      fixture(drafts, bodyFile, GATE_MARKER);
      const command =
        source === "leading cd" ? `cd "${folder}" && ${create}` : create;
      const payload = bash(command);
      const located =
        source === "tool workdir"
          ? {
              ...payload,
              tool_input: { ...payload.tool_input, workdir: drafts },
            }
          : { ...payload, cwd: source === "tool cwd" ? drafts : root };

      expect(runHook(located, { cwd: root }).status).toBe(EXIT_ALLOWED);
    }
  );

  it("reads a held issue declaration from the GitHub CLI short body flag", () => {
    const root = projectWithTracker();
    fixture(root, bodyFile, GATE_MARKER);
    const command = create.replace("--body-file", "-F");

    expect(runHook(bash(command), { cwd: root }).status).toBe(EXIT_ALLOWED);
  });

  it.each(["-F body.md", "-F=body.md", "-Fbody.md", "--body-file=body.md"])(
    "reads only the final body-file option when written as %s",
    finalFlag => {
      const root = projectWithTracker();
      fixture(root, "earlier.md", GATE_MARKER);
      fixture(root, bodyFile, ORDINARY_BODY);
      const run = () =>
        runHook(
          bash(
            `gh issue create --title fixture --body-file earlier.md ${finalFlag}`
          ),
          { cwd: root }
        );

      const plain = run();
      expect(plain.status).toBe(EXIT_BLOCKED);
      expect(plain.stderr).toContain(MISSING_DECLARATION);
      fixture(root, "earlier.md", ORDINARY_BODY);
      fixture(root, bodyFile, GATE_MARKER);
      expect(run().status).toBe(EXIT_ALLOWED);
    }
  );

  it("uses the body file in place of an inline body", () => {
    const root = projectWithTracker();
    fixture(root, bodyFile, ORDINARY_BODY);
    const result = runHook(bash(`${create} --body '${GATE_MARKER}'`), {
      cwd: root,
    });

    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(MISSING_DECLARATION);
  });

  it("keeps a body-file spelling in the title from taking the real file's place", () => {
    const root = projectWithTracker();
    fixture(root, bodyFile, ORDINARY_BODY);
    fixture(root, "held.md", GATE_MARKER);
    const command = `gh issue create --body-file ${bodyFile} --title '-Fheld.md'`;

    expect(runHook(bash(command), { cwd: root }).status).toBe(EXIT_BLOCKED);
  });

  it("requires an inspectable script path when the working directory is unknown", () => {
    const root = projectWithTracker();
    const script = "fixture.sh";
    const absolute = fixture(root, script, "printf 'fixture'\n");
    const run = (operand: string) =>
      runHook(bash(`cd "$FIXTURE_DIR" && bash ${operand}`), { cwd: root });

    const relative = run(script);
    expect(relative.status).toBe(EXIT_BLOCKED);
    expect(relative.stderr).toContain(
      "could not determine the working directory"
    );
    expect(run(JSON.stringify(absolute)).status).toBe(EXIT_ALLOWED);
    fixture(
      root,
      script,
      'gh issue create --title "fixture" --body "ordinary"\n'
    );
    const undeclared = run(JSON.stringify(absolute));
    expect(undeclared.status).toBe(EXIT_BLOCKED);
    expect(undeclared.stderr).toContain(MISSING_DECLARATION);
  });

  it("checks a shared script against each invocation's own body directory", () => {
    const root = projectWithTracker();
    const script = fixture(root, "file-issue.sh", `${create}\n`);
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    mkdirSync(first);
    mkdirSync(second);
    fixture(first, bodyFile, GATE_MARKER);
    fixture(second, bodyFile, ORDINARY_BODY);
    const runScript = `bash ${JSON.stringify(script)}`;
    const run = () =>
      runHook(
        bash(`cd first && ${runScript} && cd ../second && ${runScript}`),
        {
          cwd: root,
        }
      );

    const plain = run();
    expect(plain.status).toBe(EXIT_BLOCKED);
    expect(plain.stderr).toContain(MISSING_DECLARATION);
    fixture(second, bodyFile, GATE_MARKER);
    expect(run().status).toBe(EXIT_ALLOWED);
  });

  it("reads a container declaration through the same relative path", () => {
    const root = projectWithTracker();
    const drafts = path.join(root, folder);
    mkdirSync(drafts);
    fixture(
      drafts,
      bodyFile,
      "None — container: state rolls up from children\n"
    );

    expect(
      runHook({ ...bash(create), cwd: drafts }, { cwd: root }).status
    ).toBe(EXIT_ALLOWED);
  });

  it("names an unreadable body and does not use an unrelated file of the same name", () => {
    const root = projectWithTracker();
    const drafts = path.join(root, folder);
    mkdirSync(drafts);
    fixture(root, bodyFile, GATE_MARKER);

    const result = runHook({ ...bash(create), cwd: drafts }, { cwd: root });
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(
      'The body file "body.md" could not be read'
    );
    expect(result.stderr).toContain("absolute path");
    expect(result.stderr).not.toContain(MISSING_DECLARATION);
  });

  it("keeps the missing declaration refusal for a readable plain body", () => {
    const root = projectWithTracker();
    const drafts = path.join(root, folder);
    mkdirSync(drafts);
    fixture(root, bodyFile, GATE_MARKER);
    fixture(drafts, bodyFile, ORDINARY_BODY);

    const result = runHook({ ...bash(create), cwd: drafts }, { cwd: root });
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain(MISSING_DECLARATION);
  });

  it("uses the final working directory after a chain of directory changes", () => {
    const root = projectWithTracker();
    const drafts = path.join(root, "drafts");
    const nested = path.join(drafts, "day");
    mkdirSync(nested, { recursive: true });
    fixture(drafts, bodyFile, GATE_MARKER);
    fixture(nested, bodyFile, ORDINARY_BODY);
    const check = () =>
      runHook(bash(`cd drafts && cd day && ${create}`), { cwd: root });

    expect(check().status).toBe(EXIT_BLOCKED);
    fixture(nested, bodyFile, GATE_MARKER);
    expect(check().status).toBe(EXIT_ALLOWED);
  });

  it("requires a known path when the directory change cannot be resolved", () => {
    const root = projectWithTracker();
    const absolute = fixture(root, bodyFile, GATE_MARKER);
    const run = (command: string) =>
      runHook(bash(`cd "$DRAFT_DIR" && ${command}`), { cwd: root });

    const relative = run(create);
    expect(relative.status).toBe(EXIT_BLOCKED);
    expect(relative.stderr).toContain("could not be read");
    expect(run(create.replace(bodyFile, JSON.stringify(absolute))).status).toBe(
      EXIT_ALLOWED
    );
  });

  it("uses the logical parent when cd names a symlink followed by dot-dot", () => {
    const root = projectWithTracker();
    const other = path.join(root, "other");
    const child = path.join(other, "child");
    mkdirSync(child, { recursive: true });
    createSymlink(child, path.join(root, "link"), "dir");
    fixture(other, bodyFile, GATE_MARKER);
    fixture(root, bodyFile, ORDINARY_BODY);
    const check = () => runHook(bash(`cd link/.. && ${create}`), { cwd: root });

    expect(check().status).toBe(EXIT_BLOCKED);
    fixture(root, bodyFile, GATE_MARKER);
    expect(check().status).toBe(EXIT_ALLOWED);
  });

  it("reads a request body from the command folder for both creation and readiness", () => {
    const root = projectWithTracker();
    const drafts = path.join(root, "drafts");
    const command =
      "curl -X POST https://api.github.com/repos/example/demo/issues --data-binary @body.json";
    mkdirSync(drafts);
    fixture(root, "body.json", JSON.stringify({ body: GATE_MARKER }));
    fixture(drafts, "body.json", JSON.stringify({ body: "Ordinary issue." }));
    const check = () => runHook(bash(`cd drafts && ${command}`), { cwd: root });

    expect(check().status).toBe(EXIT_BLOCKED);
    fixture(drafts, "body.json", JSON.stringify({ body: GATE_MARKER }));
    expect(check().status).toBe(EXIT_ALLOWED);
  });
});

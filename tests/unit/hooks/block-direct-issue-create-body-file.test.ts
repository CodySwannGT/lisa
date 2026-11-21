/** Relative issue bodies are resolved against the filing command's folder. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
    expect(result.stderr).not.toContain("this filing declares no readiness");
  });

  it("keeps the missing declaration refusal for a readable plain body", () => {
    const root = projectWithTracker();
    const drafts = path.join(root, folder);
    mkdirSync(drafts);
    fixture(root, bodyFile, GATE_MARKER);
    fixture(drafts, bodyFile, "Ordinary issue text.\n");

    const result = runHook({ ...bash(create), cwd: drafts }, { cwd: root });
    expect(result.status).toBe(EXIT_BLOCKED);
    expect(result.stderr).toContain("this filing declares no readiness");
  });
});

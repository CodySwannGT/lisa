/**
 * An unbound session files the ticket for its own work (CodySwannGT/lisa#5198).
 *
 * With no ticket bound, the readiness guard refuses every tracker write, so a
 * fresh "fix this" could not file the ticket it needs first. The guard now
 * admits one fixed command, `node <owner> --tracker-create --input-file
 * <file>`, whose input sits outside every repository. The owner files only
 * into the configured tracker and refuses a filing that declares no
 * readiness. Linear and Jira are covered in task-tracker-create-vendors.
 * @module tests/unit/secrets/task-tracker-create
 */
import { rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CREATE_FLAG,
  INPUT_FILE,
  INPUT_FLAG,
  trackerCreateFixture,
} from "../../helpers/task-tracker-create-fixture.js";
import {
  checkDeclaration,
  createRequest,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/task-tracker-create.mjs";

const cleanup: string[] = [];
const REFUSED = "tracker-create-refused";
const READY = "build-ready";
const HOLD = "human-gate";
const READY_LABEL = "status:ready";
const BODY = "## Context\n\nThe full ticket body.\n";
const HELD_BODY =
  "Held for a person to supply a credential.\n<!-- [lisa-human-gate] reason=credential -->\n";
const CONTAINER_BODY =
  "## Target Backend Environment\n\nNone — container: state rolls up from children\n";

afterEach(() => {
  for (const dir of cleanup.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * A fixture whose folders are removed after the test.
 * @returns The fixture.
 */
function unbound() {
  const fixture = trackerCreateFixture();
  cleanup.push(...fixture.dirs);
  return fixture;
}

describe("the guard while no ticket is bound", () => {
  it("names the create command in its refusal", () => {
    const { guard } = unbound();
    const result = guard("Bash", { command: "synthetic-command" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`${CREATE_FLAG} ${INPUT_FLAG}`);
  });

  it("admits only the exact create command with a scratch file", () => {
    const { f, owner, outside, guard } = unbound();
    const scratch = path.join(outside, INPUT_FILE);
    const base = `node ${owner} ${CREATE_FLAG} ${INPUT_FLAG}`;
    const admitted = guard("Bash", { command: `${base} ${scratch}` });
    expect(admitted.status, admitted.stderr).toBe(0);
    for (const command of [
      `${base} ${path.join(f.root, INPUT_FILE)}`,
      `${base} ${INPUT_FILE}`,
      `${base} ${scratch}; synthetic-mutation`,
      `${base} ${scratch} && synthetic-mutation`,
      `${base} ${scratch} --extra`,
      `${base} '${scratch}'`,
      base,
      `gh issue create --repo fixture/project --title x --body x --label ${READY_LABEL}`,
    ]) {
      const result = guard("Bash", { command });
      expect(result.status, command).toBe(2);
      expect(result.stderr, command).toContain("work-item-unbound");
    }
  });
});

describe("filing on GitHub", () => {
  it("files one ticket in the configured repository with the ready label", () => {
    const { create, filed } = unbound();
    const result = create({
      title: "Synthetic ticket",
      body: BODY,
      labels: ["type:Bug"],
      readiness: READY,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      code: "tracker-created",
      ref: "fixture/project#42",
      url: "https://github.com/fixture/project/issues/42",
    });
    expect(filed()).toEqual([
      {
        argv: [
          "issue",
          "create",
          "--repo",
          "fixture/project",
          "--title",
          "Synthetic ticket",
          "--body-file",
          "-",
          "--label",
          "type:Bug",
          "--label",
          READY_LABEL,
        ],
        stdin: BODY,
      },
    ]);
  });

  it("files a held ticket outside the ready lane", () => {
    const { create, filed } = unbound();
    const result = create({ title: "Held", body: HELD_BODY, readiness: HOLD });
    expect(result.status, result.stderr).toBe(0);
    const [held, ...more] = filed();
    expect(more).toEqual([]);
    expect(held?.argv).toContain("create");
    expect(held?.argv).not.toContain(READY_LABEL);
  });

  it("refuses a filing that declares no readiness, and files nothing", () => {
    const { create, filed } = unbound();
    for (const ticket of [
      { title: "No readiness", body: BODY },
      { title: "Unknown", body: BODY, readiness: "ready" },
      { title: "Hold without marker", body: BODY, readiness: HOLD },
      { title: "Ready but held", body: HELD_BODY, readiness: READY },
      { title: "Elsewhere", body: BODY, readiness: READY, repo: "other/repo" },
    ]) {
      const result = create(ticket);
      expect(result.status, ticket.title).toBe(2);
      expect(result.stderr, ticket.title).toMatch(
        new RegExp(`^${REFUSED}: `, "u")
      );
    }
    expect(filed()).toEqual([]);
  });

  it("refuses an input file inside a repository", () => {
    const { f, create, filed } = unbound();
    const result = create(
      { title: "Inside", body: BODY, readiness: READY },
      path.join(f.root, INPUT_FILE)
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("outside every git repository");
    expect(filed()).toEqual([]);
  });
});

describe("the readiness declaration", () => {
  const request = (fields: Record<string, unknown>) =>
    createRequest({ title: "T", body: BODY, ...fields });

  it("accepts a container only with the container line and no leaf type", () => {
    expect(() =>
      checkDeclaration(
        request({ body: CONTAINER_BODY, readiness: "container" })
      )
    ).not.toThrow();
    for (const fields of [
      { readiness: "container" },
      { body: CONTAINER_BODY, readiness: "container", labels: ["type:Bug"] },
      { body: CONTAINER_BODY, readiness: "container", issue_type: "Task" },
      { body: CONTAINER_BODY, readiness: READY },
    ])
      expect(
        () => checkDeclaration(request(fields)),
        JSON.stringify(fields)
      ).toThrow();
  });

  it("refuses a held ticket that also carries the ready label", () => {
    expect(() =>
      checkDeclaration(
        request({ body: HELD_BODY, readiness: HOLD, labels: [READY_LABEL] }),
        READY_LABEL
      )
    ).toThrow(/ready lane/u);
  });

  it("refuses malformed fields", () => {
    for (const fields of [
      { title: "two\nlines", readiness: READY },
      { title: "", readiness: READY },
      { labels: ["a,b"], readiness: READY },
      { labels: READY_LABEL, readiness: READY },
      { issue_type: "Bug; rm", readiness: READY },
    ])
      expect(() => request(fields), JSON.stringify(fields)).toThrow();
  });
});

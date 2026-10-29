/** Real applying CLI and accepted proof; synthetic provider writes stay local. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { GIT_BIN } from "../../support/git-executable.js";
import {
  cleanupFixtures,
  cleanupTemplates,
  createFixture,
  githubConfig,
  git,
  commit,
} from "../../support/work-item-cli.js";
import {
  proofFixture,
  attachRecord,
  proofCli,
  PROOF_REF,
} from "../../support/work-item-proof-fixture.js";

useIoLatencyBudget();
afterEach(cleanupFixtures);
afterAll(cleanupTemplates);
const SOURCE = "all/copy-overwrite/scripts/lisa-work-item.mjs";
const MAIN = "main";
const NOT_DETERMINED = "NOT DETERMINED";
const GIT_CALLS = "git-calls.jsonl";
type ProofFixture = ReturnType<typeof proofFixture>;

/** Capture actual CLI streams and native-shaped state independently of assertions. */
function observe(fixture: ProofFixture, since?: string, selectedRef = MAIN) {
  const stateFile = fixture.env.FAKE_GH_STATE_FILE!;
  const before = JSON.parse(readFileSync(stateFile, "utf8"));
  const args = [
    "sweep",
    "--apply",
    ...(since === undefined ? [] : ["--since", since]),
    "--branch",
    MAIN,
  ];
  const result = proofCli(fixture, args);
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  const writes = readFileSync(fixture.env.FAKE_GH_WRITES_FILE!, "utf8");
  const calls = readFileSync(fixture.env.FAKE_GH_LOG!, "utf8");
  const unhandled = readFileSync(fixture.env.FAKE_GH_UNHANDLED_FILE!, "utf8");
  console.log(
    `RANGE_OBSERVATION ${JSON.stringify({
      name: expect.getState().currentTestName,
      command: [process.execPath, "scripts/lisa-work-item.mjs", ...args],
      sourceSha256: createHash("sha256")
        .update(readFileSync(SOURCE))
        .digest("hex"),
      input: {
        since,
        selectedRef,
        selectedTip: git(fixture.root, ["rev-parse", selectedRef], fixture.env),
        acceptedRecord: fixture.record,
        providerTable: JSON.parse(
          readFileSync(fixture.env.FAKE_GH_API_FILE!, "utf8")
        ),
      },
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      before,
      after: state,
      writes,
      calls,
      unhandled,
      gitCalls: existsSync(path.join(fixture.root, GIT_CALLS))
        ? readFileSync(path.join(fixture.root, GIT_CALLS), "utf8")
        : "",
    })}`
  );
  expect(unhandled).toBe("");
  return { result, before, state, writes, calls };
}

/** Delegate real Git unchanged except one explicit ancestry-read failure control. */
function traceGit(fixture: ProofFixture, failAncestry = false) {
  const trace = path.join(fixture.root, GIT_CALLS);
  writeFileSync(trace, "");
  writeFileSync(
    path.join(fixture.root, "fake-bin", "git"),
    `#!${process.execPath}\n` +
      `const {spawnSync}=require("node:child_process"); const {appendFileSync}=require("node:fs");\n` +
      `const args=process.argv.slice(2); appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+"\\n");\n` +
      `if (${JSON.stringify(failAncestry)} && args[0]==="merge-base" && args[1]==="--is-ancestor") { process.stderr.write("synthetic ancestry read failure\\n"); process.exit(128); }\n` +
      `const result=spawnSync(${JSON.stringify(GIT_BIN)},args,{stdio:"inherit"}); process.exit(result.status??1);\n`,
    { mode: 0o755 }
  );
  return () =>
    readFileSync(trace, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as string[]);
}

/** Valid proof is present so proof refusal cannot mask an invalid range. */
function acceptedFixture() {
  const fixture = proofFixture();
  attachRecord(fixture);
  return fixture;
}

describe("bounded sweep ancestry with accepted completion proof", () => {
  it("completes an ordinary ancestor-bounded range", () => {
    const fixture = acceptedFixture();
    const observed = observe(fixture, fixture.before);
    expect(observed.result.status).toBe(0);
    expect(observed.result.stdout).toContain("work-item completed:");
    expect(observed.state.state).toBe("CLOSED");
    expect(observed.writes.trim().split("\n")).toHaveLength(2);
  });

  it("refuses an orphan bound before any candidate reconciliation or writes", () => {
    const fixture = acceptedFixture();
    const tree = git(
      fixture.root,
      ["rev-parse", `${fixture.merge}^{tree}`],
      fixture.env
    );
    const orphan = git(
      fixture.root,
      ["commit-tree", tree, "-m", "synthetic orphan bound"],
      fixture.env
    );
    const observed = observe(fixture, orphan);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stderr).toContain(NOT_DETERMINED);
    expect(observed.result.stderr).toContain("ancestor");
    expect(observed.result.stderr).toContain("Fetch");
    expect(observed.state).toEqual(observed.before);
    expect(observed.writes).toBe("");
    expect(observed.calls).not.toContain("issue view");
  });

  it("refuses a diverged descendant of the common base", () => {
    const fixture = acceptedFixture();
    const tree = git(
      fixture.root,
      ["rev-parse", `${fixture.before}^{tree}`],
      fixture.env
    );
    const diverged = git(
      fixture.root,
      [
        "commit-tree",
        tree,
        "-p",
        fixture.before,
        "-m",
        "synthetic diverged bound",
      ],
      fixture.env
    );
    const observed = observe(fixture, diverged);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stderr).toContain(NOT_DETERMINED);
    expect(observed.state).toEqual(observed.before);
    expect(observed.writes).toBe("");
  });

  it("keeps equal selected tip a valid empty range", () => {
    const fixture = acceptedFixture();
    const observed = observe(fixture, fixture.merge);
    expect(observed.result.status).toBe(0);
    expect(observed.result.stdout).toContain("No drift");
    expect(observed.state).toEqual(observed.before);
    expect(observed.writes).toBe("");
  });

  it("refuses an unreadable ancestry result before any completion reads", () => {
    const fixture = acceptedFixture();
    const calls = traceGit(fixture, true);
    const observed = observe(fixture, fixture.before);
    expect(observed.result.status).toBe(1);
    expect(observed.result.stderr).toContain(NOT_DETERMINED);
    expect(observed.result.stderr).toContain("could not be verified");
    expect(observed.state).toEqual(observed.before);
    expect(observed.writes).toBe("");
    expect(observed.calls).not.toContain("issue view");
    expect(calls()).toContainEqual([
      "merge-base",
      "--is-ancestor",
      fixture.before,
      fixture.merge,
    ]);
  });

  it("uses one pinned origin commit for both ancestry and declaration reads", () => {
    const fixture = acceptedFixture();
    git(
      fixture.root,
      ["update-ref", "refs/remotes/origin/main", fixture.merge],
      fixture.env
    );
    git(
      fixture.root,
      ["update-ref", "refs/heads/main", fixture.before],
      fixture.env
    );
    const calls = traceGit(fixture);
    const observed = observe(fixture, fixture.before, "origin/main");
    expect(observed.result.status).toBe(0);
    expect(observed.state.state).toBe("CLOSED");
    expect(observed.writes.trim().split("\n")).toHaveLength(2);
    expect(calls()).toContainEqual([
      "merge-base",
      "--is-ancestor",
      fixture.before,
      fixture.merge,
    ]);
    expect(calls()).toContainEqual([
      "log",
      fixture.merge,
      "--not",
      fixture.before,
      "-z",
      "--format=%H%n%B",
    ]);
  });

  it("keeps an unresolved bound non-mutating despite accepted proof", () => {
    const fixture = acceptedFixture();
    const observed = observe(fixture, "missing-revision");
    expect(observed.result.status).toBe(1);
    expect(observed.result.stderr).toContain(NOT_DETERMINED);
    expect(observed.state).toEqual(observed.before);
    expect(observed.writes).toBe("");
  });

  it("excludes the earlier item while completing the in-range accepted item", () => {
    const base = createFixture({
      ...githubConfig("full", "code"),
      deploy: { branches: { production: MAIN } },
    });
    git(base.root, ["switch", "-q", MAIN], base.env);
    commit(base, "fix: earlier item\n\nWork-Item: acme/code#41");
    git(base.root, ["switch", "-q", "feature/tracked"], base.env);
    const fixture = proofFixture(PROOF_REF, base);
    attachRecord(fixture);
    fixture.env.FAKE_GH_LIST_JSON = JSON.stringify([
      { number: 41, title: "earlier" },
      { number: 42, title: "current" },
    ]);
    const observed = observe(fixture, fixture.before);
    expect(observed.result.status).toBe(0);
    expect(observed.state.state).toBe("CLOSED");
    expect(observed.writes.trim().split("\n")).toHaveLength(2);
    expect(observed.calls).not.toMatch(/issue (?:view|edit|close) 41/u);
    expect(observed.calls).not.toContain("/issues/41");
  });

  it("preserves deliberately unbounded operator application", () => {
    const fixture = acceptedFixture();
    const observed = observe(fixture);
    expect(observed.result.status).toBe(0);
    expect(observed.state.state).toBe("CLOSED");
    expect(observed.writes.trim().split("\n")).toHaveLength(2);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const EAGER = "plugins/src/base/rules/eager/dependency-decision-records.md";
const REFERENCE =
  "plugins/src/base/rules/reference/dependency-decision-records.md";

describe("dependency-decision-records eager/reference rule pair", () => {
  it("ships the canonical eager and reference pair from plugin source", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(eager).toContain("# Dependency Decisions (load-bearing)");
    expect(eager).toContain(".lisa/DEPENDENCY_DECISIONS.md");
    expect(eager).toContain(
      "[reference/dependency-decision-records.md](../reference/dependency-decision-records.md)"
    );
    expect(eager).toContain("`_Not yet decided_`");

    expect(reference).toContain("# Dependency Decisions");
    expect(reference).toContain(".lisa/DEPENDENCY_DECISIONS.md");
    expect(reference).toContain("create-only");
  });

  it("names every required record field in the reference body", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    // Same nine labels the scaffold uses, in the same order — operator's
    // question first, technical term kept in parentheses.
    expect(reference).toContain("**Why we keep it**");
    expect(reference).toContain("**What it is (dependency)**");
    expect(reference).toContain("**What it does for us (owned capability)**");
    expect(reference).toContain("**Why we believe it's safe (trust basis)**");
    expect(reference).toContain(
      "**What breaks if this is compromised (exposure)**"
    );
    expect(reference).toContain(
      "**What it would take to replace (replacement cost)**"
    );
    expect(reference).toContain(
      "**What would catch a bad update (detection evidence)**"
    );
    expect(reference).toContain(
      "**Who owns this and how often we recheck (owner / review cadence)**"
    );
    expect(reference).toContain("**Last reviewed**");
  });

  it("documents the appendable entry format and the undecided-field marker", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    expect(reference).toContain("## Entry format");
    expect(reference).toContain("`_Not yet decided_` is the reserved marker");
    expect(reference).toContain(
      "A `###` heading inside `## Records` is always\n  an entry, never guidance"
    );
  });

  it("puts the plain-language why first and says so", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(eager).toContain(
      '"Why we keep it" comes first on purpose — an entry that opens'
    );
    expect(reference).toContain("This is deliberately the FIRST");
  });

  it("names the escalation triggers on both halves of the pair", () => {
    const eager = readFileSync(EAGER, "utf8");
    const reference = readFileSync(REFERENCE, "utf8");

    expect(eager).toContain("Escalate, rather than just recording, when");
    expect(reference).toContain("## When to escalate");
    expect(reference).toContain(
      "An entry full of `_Not yet decided_` is not an escalation"
    );
  });

  it("documents the uniform six-agent enforcement gap", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    expect(reference).toContain("## Agent parity");
    expect(reference).toContain(
      "no agent runtime enforces\nthat entries stay accurate or current"
    );
  });

  it("keeps the scaffold free of a pre-populated inventory", () => {
    const reference = readFileSync(REFERENCE, "utf8");

    expect(reference).toContain("## Scaffold, not inventory");
    expect(reference).toContain(
      "Lisa does not pre-populate a\nhost project's dependency inventory"
    );
  });
});

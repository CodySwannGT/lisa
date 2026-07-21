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

    expect(reference).toContain("**Dependency**");
    expect(reference).toContain("**Why we keep it**");
    expect(reference).toContain("**Owned capability**");
    expect(reference).toContain("**Trust basis**");
    expect(reference).toContain("**Exposure**");
    expect(reference).toContain("**Replacement cost**");
    expect(reference).toContain("**Detection evidence**");
    expect(reference).toContain("**Owner / review cadence**");
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

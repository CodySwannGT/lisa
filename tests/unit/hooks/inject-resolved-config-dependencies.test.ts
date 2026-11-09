/**
 * The resolved-config block states the effective `dependencies.humanSignOff`.
 *
 * The setting changes what the governed dependency rule asks an agent to do,
 * so the agent has to see it without deciding to open the config file — and an
 * invalid value has to be named as invalid, because printing a quiet `default`
 * would make "the project meant `none` and typed it wrong" indistinguishable
 * from "the project never set it".
 * @module tests/unit/hooks/inject-resolved-config-dependencies
 */
import { describe, expect, it } from "vitest";

import {
  hookRunner,
  LOCAL_CONFIG,
  MAIN_CONFIG,
  project,
  writeJson,
} from "../../helpers/inject-resolved-config-harness.js";

/** Bound once here: a shared helper may not read `process.env`. */
const { contextFor } = hookRunner(process.env);

/**
 * The exact `dependencies.humanSignOff` line a session sees.
 * @param context - The injected resolved-config block
 * @returns The first line for the key, or undefined when none rendered
 */
const lineFor = (context: string): string | undefined =>
  context
    .split("\n")
    .find(line => line.startsWith("dependencies.humanSignOff:"));

describe("inject-resolved-config: dependencies.humanSignOff", () => {
  it("marks an undeclared value as the Lisa built-in default", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github" });

    expect(lineFor(contextFor(root))).toBe(
      "dependencies.humanSignOff: default   [Lisa built-in default — this project declares none; owner: src/core/project-config-dependencies.ts]"
    );
  });

  it.each(["none", "default"])("prints a declared %s plainly", value => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      dependencies: { humanSignOff: value },
    });

    const context = contextFor(root);

    expect(lineFor(context)).toBe(`dependencies.humanSignOff: ${value}`);
    expect(context).not.toContain("INVALID");
  });

  it("lets the local override win", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      dependencies: { humanSignOff: "default" },
    });
    writeJson(root, LOCAL_CONFIG, { dependencies: { humanSignOff: "none" } });

    expect(lineFor(contextFor(root))).toBe("dependencies.humanSignOff: none");
  });

  it("reports an invalid value as invalid and resolves it to default", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      dependencies: { humanSignOff: "sometimes" },
    });

    const context = contextFor(root);

    expect(lineFor(context)).toBe(
      'dependencies.humanSignOff: default   [INVALID — this project declares "sometimes", which is not one of "default" | "none"; treated as default; owner: src/core/project-config-dependencies.ts]'
    );
    // Exactly one line for the key: the declared-but-invalid value must not
    // ALSO render as if it were the effective value.
    expect(
      context
        .split("\n")
        .filter(line => line.includes("dependencies.humanSignOff")).length
    ).toBe(1);
  });

  it("reports a dependencies block that is not an object as invalid", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github", dependencies: "none" });

    const context = contextFor(root);

    expect(lineFor(context)).toContain(
      'dependencies.humanSignOff: default   [INVALID — this project declares "none" for dependencies'
    );
    expect(context).not.toContain(
      "other declared keys (not summarised here): dependencies"
    );
  });

  it("still renders other keys a future dependencies block carries", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      dependencies: { humanSignOff: "none", futureSetting: "on" },
    });

    const context = contextFor(root);

    expect(lineFor(context)).toBe("dependencies.humanSignOff: none");
    expect(context).toContain("dependencies: futureSetting=on");
    expect(context).not.toContain("humanSignOff=none");
  });
});

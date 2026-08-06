/**
 * The repo-less setup field asks the vault which CLIs to install.
 *
 * Without a checkout there is no `remoteEnv.tools`, so the field installed the
 * whole catalogue. On a five-minute setup budget that is not merely wasteful: a
 * blown budget is a session that never starts.
 *
 * Two properties carry the whole design, and both are easy to break silently.
 * The vault cannot be asked before it has been read, so the question must come
 * after materialization. And a vault that answers nothing must leave the
 * container exactly as it was before the convention existed, or adopting it
 * becomes a regression for every environment whose notes are not annotated yet.
 * @module tests/unit/secrets/setup-field-notes-tools
 */

import { describe, expect, it } from "vitest";

import { run } from "../../../plugins/src/base/skills/lisa-setup-workstation/scripts/cli.mjs";
import { SETUP_FIELD } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** Present everything, so the plan reports rather than installs. */
const PRESENT = { probe: () => ({ present: true, version: "1.0.0" }) };

/**
 * Tool names the bootstrap planned, from its machine-readable output.
 * @param argv Flags to run with.
 * @returns Planned tool names.
 */
async function plannedTools(argv: string[]): Promise<string[]> {
  let out = "";
  // `--provider=none` is not incidental: omitted, the bootstrap asks which
  // credential manager to use and the test waits on an answer nobody types.
  await run([...argv, "--provider=none", "--json"], {
    log: (text: string) => (out = text),
    probes: PRESENT,
  });
  return JSON.parse(out)
    .plan.filter((row: { group: string }) => row.group === "tool")
    .map((row: { name: string }) => row.name);
}

describe("--tools as a selector", () => {
  it("installs only what is named", async () => {
    expect(await plannedTools(["--tools=sonar"])).toContain("sonar");
    expect(await plannedTools(["--tools=sonar"])).not.toContain("gh");
  });

  it("treats an EMPTY value as the whole catalogue, not as nothing", async () => {
    // This is the fallback the field depends on. `--tools=` is what a command
    // substitution produces when the vault names nothing, and reading it as
    // "install nothing" would strip a working environment on upgrade.
    const all = await plannedTools([]);

    expect(await plannedTools(["--tools="])).toEqual(all);
    expect(all.length).toBeGreaterThan(0);
  });

  it("keeps required entries whatever is selected", async () => {
    // git and node are assertions about the machine, not installs. Filtering
    // them out would turn a missing prerequisite into a silent one.
    expect(await plannedTools(["--tools=none"])).toEqual(
      expect.arrayContaining(["git", "node"])
    );
  });
});

describe("the setup field's order of operations", () => {
  it("asks the vault only AFTER the secrets have been materialized", () => {
    // Asked first, the notes file does not exist yet and the answer is always
    // empty — which looks exactly like a vault that names nothing, so the
    // feature would appear to work while never doing anything.
    const secrets = SETUP_FIELD.indexOf("remote-env --phase=secrets");
    const ask = SETUP_FIELD.indexOf("remote-env --print-tools");

    expect(secrets).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(secrets);
  });

  it("installs the provider CLI before asking, since asking needs it", () => {
    // Materialization spawns the provider CLI by name; the first pass exists
    // to put it there, which is why it asks for no tools of its own.
    const first = SETUP_FIELD.indexOf("--tools=none");
    const secrets = SETUP_FIELD.indexOf("remote-env --phase=secrets");

    expect(first).toBeGreaterThan(-1);
    expect(secrets).toBeGreaterThan(first);
  });

  it("passes the answer through as the second pass's selection", () => {
    expect(SETUP_FIELD).toMatch(/w=\$\(npx[^)]*remote-env --print-tools/);
    expect(SETUP_FIELD).toContain('--tools="$w"');
  });

  it("reports a failure in EITHER install pass", () => {
    // One shared status variable would let the second pass overwrite the
    // first's failure with a success, hiding a container with no provider CLI.
    expect(SETUP_FIELD).toMatch(
      /\[ "\$tw" -eq 0 \] && \[ "\$tt" -eq 0 \] \|\| echo "SETUP INCOMPLETE/
    );
  });
});

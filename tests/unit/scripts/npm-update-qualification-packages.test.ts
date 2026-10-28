/** A real child models package state transitions; actual signed Ubuntu APT evidence is separate. */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSupervisedUnixFixture } from "../../helpers/supervised-unix-fixture.js";
import { SCRATCH_SUPERVISION_LEASE_ENV } from "../../../src/configs/vitest/scratch-supervision.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { normalizeQualificationPackages } from "../../fixtures/npm-update-hosted-runtime/packages.mjs";
import {
  installRailsPackages,
  railsPackageFailurePhase,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-rails-tools.mjs";
import { runProcess } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

useIoLatencyBudget();

const NEWER = "2.80.0-6ubuntu3.10";
const PINNED = "2.80.0-6ubuntu3.9";
const CHILD = `
import { readFileSync, writeFileSync } from "node:fs";
const [statePath, refusal, ...args] = process.argv.slice(1);
const state = JSON.parse(readFileSync(statePath, "utf8"));
if (args.includes(refusal)) process.exit(73);
if (args.includes("install")) {
  const requested = args.find(arg => arg.startsWith("libglib2.0-0t64="))?.split("=")[1];
  if (state.version !== requested && !args.includes("--allow-downgrades")) {
    process.stderr.write("E: Packages were downgraded and -y was used without --allow-downgrades.\\n");
    process.exit(100);
  }
  writeFileSync(statePath, JSON.stringify({ version: requested }));
}
`;

async function fixture(
  operation: (root: string, state: string) => Promise<void>
) {
  const owned = createSupervisedUnixFixture(
    "hook-reader.sock",
    process.env[SCRATCH_SUPERVISION_LEASE_ENV]
  );
  const state = join(owned.root, "packages.json");
  writeFileSync(state, JSON.stringify({ version: NEWER }));
  try {
    await operation(owned.root, state);
  } finally {
    owned.close();
  }
}

function transport(root: string, state: string, refusal = "none") {
  return async (command: string, args: string[]) => {
    expect(command).toBe("/usr/bin/sudo");
    return runProcess(
      process.execPath,
      ["--input-type=module", "-e", CHILD, state, refusal, ...args],
      {
        cwd: root,
        env: { PATH: "/usr/bin:/bin" },
        timeout: 2000,
        maximum: 4096,
      }
    );
  };
}

describe("disposable qualification package normalization", () => {
  it("normalizes newer package state before unchanged strict production qualification", async () => {
    await fixture(async (root, state) => {
      const step = transport(root, state);
      await expect(installRailsPackages(step, true)).rejects.toMatchObject({
        code: 100,
      });
      expect(JSON.parse(readFileSync(state, "utf8")).version).toBe(NEWER);
      await normalizeQualificationPackages(step);
      expect(JSON.parse(readFileSync(state, "utf8")).version).toBe(PINNED);
      await expect(installRailsPackages(step, true)).resolves.toHaveLength(19);
      // A future consumer run with newer packages still has no downgrade permission.
      writeFileSync(state, JSON.stringify({ version: NEWER }));
      await expect(installRailsPackages(step, true)).rejects.toMatchObject({
        code: 100,
      });
    });
  });

  it.each(["update", "install"])(
    "retains original %s failure and does not normalize state",
    async refusal => {
      await fixture(async (root, state) => {
        let failure: unknown;
        try {
          await normalizeQualificationPackages(transport(root, state, refusal));
        } catch (error) {
          failure = error;
        }
        expect(failure).toMatchObject({ code: 73 });
        expect(railsPackageFailurePhase(failure)).toBe(`apt-${refusal}`);
        expect(JSON.parse(readFileSync(state, "utf8")).version).toBe(NEWER);
      });
    }
  );
});

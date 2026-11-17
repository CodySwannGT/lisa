import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

useIoLatencyBudget();

const MANAGED_SETUP = readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../../expo/copy-overwrite/jest.setup.pre.js"
  ),
  "utf8"
);

/** Child harness that runs the setup in its own process and reports back. */
const PROBE = path.resolve(
  import.meta.dirname,
  "../../fixtures/expo-jest-pre-setup/probe.mjs"
);

/**
 * Quiet-box wall budget for one probe child: Node start-up plus the setup.
 * The setup itself must finish well inside it; a setup that never returns is
 * killed at this bound and the probe fails naming the hang.
 */
const PROBE_BUDGET_MS = 1_000;

/** Project registries the probe can build, one per scenario. */
type Scenario =
  | "empty"
  | "project"
  | "null-modules"
  | "undefined-modules"
  | "null-prototype";

/** What the proxy returned for one requested module name. */
interface ModuleObservation {
  readonly isNull: boolean;
  readonly isProjectModule: boolean;
  readonly constants?: Record<string, unknown>;
}

/** Everything the probe reports about one run of the managed setup. */
interface ProbeReport {
  readonly proxyType: string;
  readonly modules: Readonly<Record<string, ModuleObservation>>;
  readonly registryUnchanged: boolean;
}

/**
 * Run a setup file in a fresh child process against a scenario registry.
 *
 * The setup sits in a private directory beside a real
 * `jest.config.react-native-mock.js` and an empty `jest.setup.pre.local.js`,
 * the two files it requires in a host, so nothing about module loading is
 * simulated. The child has its own global scope and a bounded wall time.
 * @param scenario - Which project registry the probe builds
 * @param setup - Setup source to run; Lisa's managed file by default
 * @returns The child's report
 */
function probe(scenario: Scenario, setup: string = MANAGED_SETUP): ProbeReport {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-expo-setup-"));
  try {
    writeFileSync(path.join(directory, "jest.setup.pre.js"), setup, {
      mode: 0o600,
    });
    writeFileSync(
      path.join(directory, "jest.config.react-native-mock.js"),
      "module.exports = globalThis.__lisaProbeRegistry;\n",
      { mode: 0o600 }
    );
    writeFileSync(path.join(directory, "jest.setup.pre.local.js"), "", {
      mode: 0o600,
    });
    const outcome = boundedSpawnSync({
      label: `managed Expo setup probe (${scenario})`,
      command: process.execPath,
      args: [PROBE, directory, scenario],
      baseMs: PROBE_BUDGET_MS,
    });
    expect(outcome.status, outcome.stderr).toBe(0);
    const report = JSON.parse(outcome.stdout) as ProbeReport;
    expect(report.proxyType).toBe("function");
    return report;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("Expo managed Jest native module fallbacks", () => {
  it("supplies the standard SourceCode and empty native UIManager unit seams", () => {
    const { modules } = probe("empty");
    expect(modules["SourceCode"]?.constants).toEqual({ scriptURL: null });
    expect(modules["UIManager"]?.constants).toEqual({});
    expect(modules["ProjectCamera"]?.isNull).toBe(true);
  });

  it("keeps frozen project modules and every property descriptor unchanged", () => {
    const { modules, registryUnchanged } = probe("project");
    expect(modules["SourceCode"]?.isProjectModule).toBe(true);
    expect(modules["UIManager"]?.isProjectModule).toBe(true);
    expect(modules["ProjectCamera"]?.isProjectModule).toBe(true);
    expect(registryUnchanged).toBe(true);
  });

  it.each([
    ["null", "null-modules"],
    ["undefined", "undefined-modules"],
  ] as const)(
    "uses defaults when an older registry has an absent %s module value",
    (_absent, scenario) => {
      const { modules, registryUnchanged } = probe(scenario);
      expect(modules["SourceCode"]?.constants).toEqual({ scriptURL: null });
      expect(modules["UIManager"]?.constants).toEqual({});
      expect(registryUnchanged).toBe(true);
    }
  );

  it("does not invent native modules from fallback object prototype properties", () => {
    const { modules } = probe("null-prototype");
    expect(modules["constructor"]?.isNull).toBe(true);
    expect(modules["toString"]?.isNull).toBe(true);
    expect(modules["missing"]?.isNull).toBe(true);
  });

  it("kills a setup that never returns at the probe's bound", () => {
    expect(() => probe("empty", "for (;;) {}\n")).toThrow(/did not complete/);
  });
});

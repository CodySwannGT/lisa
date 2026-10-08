import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { LEDGER_FILE, seedFixture } from "./maestro-android-retry-fixtures.js";
import { runCapturing } from "./maestro-retry-execution.js";
import { prepareDriver, driverEnvironment } from "./maestro-retry-project.js";
import type {
  ReusableWorkflow,
  RunOptions,
  StepResult,
} from "./maestro-retry-types.js";

const SH = "/bin/sh";

/**
 * Runs the real driver against a fixture project, through the real
 * emulator-script line, under `sh -c` as the action does.
 * @param workflow - The parsed workflow
 * @param options - Fixture and policy knobs
 * @returns Exit status, stub invocation count, output, and the ledger
 */
export const runSuiteDriver = async (
  workflow: ReusableWorkflow,
  options: RunOptions = {}
): Promise<StepResult> => {
  const {
    platform = "android",
    failing = ["flow-07"],
    tagged = failing,
    reverseOrder = false,
    repeatFailing = false,
  } = options;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-android-"));
  try {
    const { stub, counter, seed } = await seedFixture(dir, {
      failing,
      tagged,
      reverseOrder,
      repeatFailing,
    });

    const { summary, fixtureEnv, invocation } = await prepareDriver(
      workflow,
      dir,
      seed,
      options
    );
    const debugRoots = path.join(dir, "debug-roots");

    const { status, output } = runCapturing(
      SH,
      ["-c", `export STUB_DRIVER_PID=$$; exec ${invocation}`],
      {
        cwd: dir,
        env: driverEnvironment(
          fixtureEnv,
          dir,
          stub,
          counter,
          seed,
          debugRoots,
          options
        ),
      }
    );
    const ledgerPath = path.join(dir, LEDGER_FILE.replace("android", platform));
    return {
      status,
      debugRoots: (await fs.readFile(debugRoots, "utf-8")).trim().split("\n"),
      summary: await fs.readFile(summary, "utf-8"),
      attempts: Number((await fs.readFile(counter, "utf-8")).trim()),
      output,
      ledger: (await fs.pathExists(ledgerPath))
        ? await fs.readFile(ledgerPath, "utf-8")
        : null,
    };
  } finally {
    await fs.remove(dir);
  }
};

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReusableWorkflow, WorkflowStep } from "./maestro-retry-types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REUSABLE_YML = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/**
 * The reusable workflow, parsed.
 * @returns The parsed workflow
 */
export const loadWorkflow = async (): Promise<ReusableWorkflow> =>
  yaml.load(await fs.readFile(REUSABLE_YML, "utf-8")) as ReusableWorkflow;

/**
 * A named step of the android job — never a copy of one.
 * @param workflow - The parsed workflow
 * @param namePart - Substring of the step's `name:`
 * @returns The step as parsed from the workflow
 */
export const androidStep = (
  workflow: ReusableWorkflow,
  namePart: string
): WorkflowStep => {
  const step = (workflow.jobs.android?.steps ?? []).find(candidate =>
    candidate.name?.includes(namePart)
  );
  if (!step) throw new Error(`no android step matching "${namePart}"`);
  return step;
};

/**
 * The verbatim `run:` text of a named android step.
 *
 * No `${{ }}` may survive into the script: an expansion is substituted into the
 * script TEXT before bash parses it, and executing a step verbatim is only
 * meaningful if nothing had to be rewritten to make it runnable.
 * @param workflow - The parsed workflow
 * @param namePart - Substring of the step's `name:`
 * @returns The step's shell script exactly as CI will run it
 */
export const androidRun = (
  workflow: ReusableWorkflow,
  namePart: string
): string => {
  const step = androidStep(workflow, namePart);
  if (!step.run) throw new Error(`android step "${namePart}" has no run:`);
  if (step.run.includes("${{")) {
    throw new Error(`android step "${namePart}" carries a template expansion`);
  }
  return step.run;
};

/**
 * The emulator action's `script:` as the action itself sees it — trimmed, split
 * on newlines, blanks and comment lines dropped, exactly as `parseScript` in
 * `android-emulator-runner` does it.
 * @param workflow - The parsed workflow
 * @returns One entry per `sh -c` invocation the action will make
 */
export const emulatorScriptLines = (workflow: ReusableWorkflow): string[] =>
  String(
    androidStep(workflow, "Run Maestro flows on emulator").with?.script ?? ""
  )
    .trim()
    .split(/\r\n|\n|\r/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("#"));

/**
 * The path the driver-writing step writes its script to.
 * @param workflow - The parsed workflow
 * @returns The driver's filename, as the workflow spells it
 */
export const driverPath = (workflow: ReusableWorkflow): string => {
  const match = /cat > (\S+) <</.exec(
    androidRun(workflow, "Write the Android suite driver")
  );
  const filename = match?.[1];
  if (!filename) throw new Error("the driver-writing step writes no file");
  return filename;
};

/**
 * The single emulator-script line that invokes the driver.
 *
 * Resolved from the YAML rather than hard-coded, so a change that stops the
 * action invoking the driver cannot leave these tests passing against a script
 * CI no longer runs.
 * @param workflow - The parsed workflow
 * @returns The command line, verbatim
 */
export const driverInvocation = (workflow: ReusableWorkflow): string => {
  const driver = driverPath(workflow);
  const lines = emulatorScriptLines(workflow).filter(line =>
    line.includes(driver)
  );
  const [invocation] = lines;
  if (lines.length !== 1 || !invocation) {
    throw new Error(
      `expected exactly one emulator script line invoking ${driver}, found ${lines.length}`
    );
  }
  return invocation;
};

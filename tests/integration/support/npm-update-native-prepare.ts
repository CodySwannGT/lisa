/** Execute the unchanged updater inside its independently qualified native Node. */
import { dirname, delimiter } from "node:path";
import { expect } from "vitest";
import { qualifiedUpdaterNode } from "../../support/qualified-updater-node.js";
import { runProcess } from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import type { prepareUpdate } from "../../../all/copy-overwrite/scripts/lib/npm-update-prepare.mjs";

const ENTRY = new URL(
  "../../../all/copy-overwrite/scripts/lib/npm-update-prepare.mjs",
  import.meta.url
).href;
const SCRIPT = `
import { readFileSync } from 'node:fs';
const { prepareUpdate } = await import(process.argv[1]);
const result = await prepareUpdate(JSON.parse(readFileSync(0, 'utf8')));
process.stdout.write(JSON.stringify({node:process.versions.node,abi:process.versions.modules,result}));
`;

/**
 * Preserve genuine prepare/install/proposal/cleanup behavior on Node22.
 * @param input - Actual host checkout and original updater inputs.
 * @param env - Original sanitized host environment, including the no-Bun control.
 * @returns The actual production updater result from the qualified subprocess.
 */
export async function prepareNativeUpdate(
  input: Parameters<typeof prepareUpdate>[0],
  env: NodeJS.ProcessEnv
): Promise<Awaited<ReturnType<typeof prepareUpdate>>> {
  const runtime = qualifiedUpdaterNode();
  const result = await runProcess(
    runtime.path,
    ["--input-type=module", "--eval", SCRIPT, ENTRY],
    {
      cwd: input.cwd,
      env: {
        ...env,
        PATH: `${dirname(runtime.path)}${delimiter}${env.PATH ?? ""}`,
      },
      input: JSON.stringify(input),
      timeout: 120_000,
    }
  );
  const observed = JSON.parse(result.stdout.toString());
  expect(observed.node).toBe("22.23.3");
  expect(observed.abi).toBe("127");
  return observed.result;
}

/** Inherited lease admission stays inside the caller's actual temp authority. */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { temporaryTestRunDirectory } from "../../helpers/lisa-test-run-process.js";

const directories: string[] = [];
const fixture = path.resolve(
  import.meta.dirname,
  "../../helpers/__fixtures__/scratch-inherited-lease.mjs"
);

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * Run the real setup module with matching owner metadata.
 * @param mode - Lease placement or legitimate redirected entry mode.
 * @returns Observed admission and retained sentinel.
 */
function probe(mode: string): {
  accepted: boolean;
  error?: string;
  worker?: string;
  suite: string;
} {
  const root = temporaryTestRunDirectory("lisa-inherited-lease-", directory => {
    directories.push(directory);
  });
  const result = boundedSpawnSync({
    label: `inherited scratch lease ${mode}`,
    command: process.execPath,
    args: ["--import", "tsx", fixture, root, mode],
    env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
    baseMs: 6_000,
  });
  if (result.status !== 0) throw new Error(result.stderr);
  const observation = JSON.parse(result.stdout) as ReturnType<typeof probe>;
  expect(
    fs.readFileSync(path.join(observation.suite, "sentinel"), "utf8")
  ).toBe("keep");
  expect(
    fs.readdirSync(observation.suite).filter(name => name.startsWith("worker-"))
  ).toEqual([]);
  return observation;
}

describe("inherited scratch lease admission", () => {
  it.each(["foreign-base", "foreign-namespace", "nested-stale-owner"])(
    "refuses a complete %s lease before worker allocation",
    mode => {
      const result = probe(mode);
      expect(result.accepted).toBe(false);
      expect(result.error).toMatch(/scratch.*(?:namespace|temp)/iu);
    }
  );

  it.each(["control", "direct", "nested"])(
    "preserves legitimate %s execution and cleanup",
    mode => {
      const result = probe(mode);
      expect(result.accepted).toBe(true);
      expect(result.worker).toBeDefined();
      expect(fs.existsSync(result.worker ?? "")).toBe(false);
    }
  );
});

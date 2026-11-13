/**
 * The access-map tracer end to end (CodySwannGT/lisa#4593): a tiny fixture
 * suite runs under real Vitest with LISA_ACCESS_MAP=1 and the same plugin and
 * setup file Lisa's own config uses, and the map it writes must name what each
 * test file imported, read and executed — including what a spawned Node child
 * imported and read, which only the NODE_OPTIONS tracer can see.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const VITEST = path.join(
  path.dirname(require.resolve("vitest/package.json")),
  "vitest.mjs"
);
const ACCESS_MAP = pathToFileURL(
  path.join(ROOT, "scripts/lib/test-access-map.mjs")
).href;

const FILES: Readonly<Record<string, string>> = {
  "vitest.config.mjs": `
import { testAccessMapPlugin, testAccessMapSetupFiles } from ${JSON.stringify(ACCESS_MAP)};
export default {
  plugins: [testAccessMapPlugin()],
  test: { include: ["tests/**/*.test.mjs"], setupFiles: [...testAccessMapSetupFiles(process.env)] },
};
`,
  "src/value.mjs": "export const value = 42;\n",
  "docs/guide.md": "# Guide\n",
  "docs/child.md": "read by a child\n",
  "docs/unread.md": "nobody reads this\n",
  "scripts/hook.sh": "#!/usr/bin/env bash\necho hook-ran\n",
  "scripts/helper.mjs": "export const helper = 'helper';\n",
  "scripts/child.mjs": `
import { readFileSync } from "node:fs";
import { helper } from "./helper.mjs";
process.stdout.write(helper + ":" + readFileSync(new URL("../docs/child.md", import.meta.url), "utf8"));
`,
  "tests/imports.test.mjs": `
import { expect, test } from "vitest";
import { value } from "../src/value.mjs";
test("imports", () => expect(value).toBe(42));
`,
  "tests/reads.test.mjs": `
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
test("reads", () => {
  expect(readFileSync(new URL("../docs/guide.md", import.meta.url), "utf8")).toContain("Guide");
});
`,
  "tests/spawns.test.mjs": `
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
const cwd = fileURLToPath(new URL("..", import.meta.url));
test("spawns a shell script and a node child", () => {
  expect(spawnSync("bash", ["scripts/hook.sh"], { cwd, encoding: "utf8" }).stdout).toBe("hook-ran\\n");
  expect(spawnSync(process.execPath, ["scripts/child.mjs"], { cwd, encoding: "utf8" }).stdout).toBe("helper:read by a child\\n");
});
`,
};

const fixture = { root: "" };

/**
 * The environment of a fresh, top-level Vitest run with the map on: nothing
 * this outer run's own worker or tracer exported leaks in.
 * @returns Child environment
 */
function freshEnvironment(): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("VITEST") &&
        !key.startsWith("LISA_ACCESS_MAP") &&
        key !== "NODE_OPTIONS" &&
        key !== "LISA_COVERAGE_SCOPE" &&
        key !== "LISA_TEST_TIMINGS_SCOPE"
    )
  );
  return {
    ...inherited,
    LISA_ACCESS_MAP: "1",
    LISA_TEST_TIMINGS_SCOPE: "unit",
  };
}

beforeAll(() => {
  fixture.root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-access-map-"))
  );
  Object.entries(FILES).forEach(([name, content]) => {
    const file = path.join(fixture.root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  });
  fs.symlinkSync(
    path.join(ROOT, "node_modules"),
    path.join(fixture.root, "node_modules"),
    "dir"
  );
});

afterAll(() => {
  if (fixture.root !== "")
    fs.rmSync(fixture.root, { recursive: true, force: true });
});

describe("test access map tracer", () => {
  it(
    "records each test file's imports, reads and spawns",
    () => {
      const result = spawnSync(
        process.execPath,
        [VITEST, "run", "--config", "vitest.config.mjs"],
        {
          cwd: fixture.root,
          env: freshEnvironment(),
          encoding: "utf8",
          timeout: 90_000,
        }
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

      const written = JSON.parse(
        fs.readFileSync(
          path.join(fixture.root, "tmp/test-access-map/unit.json"),
          "utf8"
        )
      ) as {
        readonly meta: Readonly<Record<string, unknown>>;
        readonly map: Readonly<Record<string, readonly string[]>>;
      };

      expect(
        Object.keys(written.map).sort((a, b) => a.localeCompare(b))
      ).toEqual([
        "tests/imports.test.mjs",
        "tests/reads.test.mjs",
        "tests/spawns.test.mjs",
      ]);
      expect(written.map["tests/imports.test.mjs"]).toContain("src/value.mjs");
      expect(written.map["tests/reads.test.mjs"]).toContain("docs/guide.md");
      expect(written.map["tests/spawns.test.mjs"]).toEqual(
        expect.arrayContaining([
          "scripts/hook.sh",
          "scripts/child.mjs",
          "scripts/helper.mjs",
          "docs/child.md",
        ])
      );
      // Attribution, not a union: no test lists another's file, nobody lists
      // the unread one, and dependencies never appear.
      expect(written.map["tests/imports.test.mjs"]).not.toContain(
        "docs/guide.md"
      );
      expect(written.map["tests/reads.test.mjs"]).not.toContain(
        "scripts/hook.sh"
      );
      expect(Object.values(written.map).flat()).not.toContain("docs/unread.md");
      expect(
        Object.values(written.map)
          .flat()
          .some(file => file.startsWith("node_modules/"))
      ).toBe(false);
      expect(written.meta).toMatchObject({ scope: "unit", tracerVersion: 1 });
      expect(
        fs
          .readdirSync(path.join(fixture.root, "tmp/test-access-map"))
          .filter(name => name.startsWith("raw-"))
      ).toEqual([]);
    },
    ioLatencyBudgetMs(120_000)
  );

  it(
    "records nothing without LISA_ACCESS_MAP=1",
    () => {
      fs.rmSync(path.join(fixture.root, "tmp"), {
        recursive: true,
        force: true,
      });
      const env = { ...freshEnvironment(), LISA_ACCESS_MAP: "" };
      const result = spawnSync(
        process.execPath,
        [VITEST, "run", "--config", "vitest.config.mjs"],
        { cwd: fixture.root, env, encoding: "utf8", timeout: 90_000 }
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(fs.existsSync(path.join(fixture.root, "tmp"))).toBe(false);
    },
    ioLatencyBudgetMs(120_000)
  );
});

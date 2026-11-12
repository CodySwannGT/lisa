/**
 * `lisa apply` repoints pre-#2324 Sonar vendor shims at Lisa's wrapper.
 *
 * CodySwannGT/lisa#4502. `sonar integrate <agent>` writes a shim that calls
 * `sonar hook <event>` directly, so an unauthenticated CLI blocks every prompt.
 * #2324 shipped `scripts/lisa-hooks/sonar-secrets.sh` to degrade that case to a
 * warning, but only a human following the setup skill ever repointed the shim —
 * a host project whose shim predates the wrapper kept blocking every prompt.
 *
 * Every case runs against a real temporary checkout carrying the real shipped
 * wrapper, and the behaviour case executes both shims under `bash`.
 * @module tests/unit/sonar/sonar-shim-repoint
 */
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseVendorShimEvent,
  repointSonarShims,
  SONAR_SHIM_PATHS,
  SONAR_WRAPPER_PATH,
} from "../../../src/sonar/sonar-shim-repoint.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  BASH,
  HOOK_RUN_BUDGET_MS,
  INACTIVE,
  REPO_ROOT,
  SHIPPED,
  stubSonar,
} from "../hooks/support/sonar-secrets-fixtures.js";

const CLAUDE_PROMPT =
  ".claude/hooks/sonar-secrets/build-scripts/prompt-secrets.sh";
const ANTIGRAVITY = ".agents/sonar/hooks/pretool-secrets.sh";
const SHEBANG = "#!/bin/bash";
const PROMPT_EVENT = "claude-prompt-submit";

/**
 * The shim `sonar integrate` writes, verbatim from the vendor's
 * `buildUnixHookScript`.
 * @param event - Vendor hook event name
 * @returns Shim body
 */
function vendorShim(event: string): string {
  return [
    SHEBANG,
    "if ! command -v sonar &> /dev/null; then",
    "  exit 0",
    "fi",
    `sonar hook ${event}`,
    "",
  ].join("\n");
}

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true }))
  );
});

/**
 * Create a checkout fixture, optionally carrying the real shipped wrapper.
 * @param withWrapper - Whether to copy the wrapper into the checkout
 * @returns Absolute checkout root
 */
async function checkout(withWrapper = true): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lisa-sonar-shim-"));
  tempDirectories.push(root);
  if (withWrapper) {
    const wrapper = path.join(root, SONAR_WRAPPER_PATH);
    await mkdir(path.dirname(wrapper), { recursive: true });
    await copyFile(SHIPPED, wrapper);
  }
  return root;
}

/**
 * Write an executable shim into the checkout.
 * @param root - Checkout root
 * @param relative - Shim path relative to the root
 * @param body - Shim body
 * @returns Absolute shim path
 */
async function writeShim(
  root: string,
  relative: string,
  body: string
): Promise<string> {
  const absolute = path.join(root, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, body);
  await chmod(absolute, 0o755);
  return absolute;
}

/**
 * Run a shim the way an agent harness does: payload on stdin, stub CLI first
 * on PATH, and no Sonar token anywhere in the environment.
 * @param shim - Absolute shim path
 * @param root - Checkout root, exported as CLAUDE_PROJECT_DIR
 * @returns The completed process
 */
function runShim(
  shim: string,
  root: string
): ReturnType<typeof boundedSpawnSync> {
  const bin = stubSonar(INACTIVE);
  const { SONARQUBE_CLI_TOKEN: _token, ...env } = process.env;
  return boundedSpawnSync({
    label: "a Sonar hook shim",
    command: BASH,
    args: [shim],
    baseMs: HOOK_RUN_BUDGET_MS,
    input: JSON.stringify({ prompt: "hello" }),
    env: {
      ...env,
      PATH: [bin, process.env.PATH].filter(Boolean).join(path.delimiter),
      CLAUDE_PROJECT_DIR: root,
    },
  });
}

/**
 * Read the shim paths from the §4a table of the setup skill, so the list Lisa
 * repoints cannot drift from the list it tells an operator to patch.
 * @returns Shim paths in table order
 */
async function documentedShimPaths(): Promise<readonly string[]> {
  const skill = await readFile(
    path.join(REPO_ROOT, "plugins/src/base/skills/lisa-setup-sonar/SKILL.md"),
    "utf8"
  );
  const section = skill.split(/^## 4a\./m)[1]?.split(/^## /m)[0] ?? "";
  return [...section.matchAll(/^\|[^|]+\|\s*`([^`]+\.sh)`\s*\|/gm)].map(
    match => match[1] ?? ""
  );
}

describe("repointSonarShims", () => {
  it("covers exactly the shim table in lisa-setup-sonar §4a", async () => {
    expect(SONAR_SHIM_PATHS).toEqual(await documentedShimPaths());
  });

  it("migrates a pre-#2324 vendor shim and preserves its mode", async () => {
    const root = await checkout();
    const shim = await writeShim(root, CLAUDE_PROMPT, vendorShim(PROMPT_EVENT));

    const result = await repointSonarShims(root);

    expect(result).toEqual({
      wrapperPresent: true,
      repointed: [CLAUDE_PROMPT],
      failed: [],
      unrecognized: [],
    });
    const body = await readFile(shim, "utf8");
    expect(body.startsWith(`${SHEBANG}\n`)).toBe(true);
    expect(body).toContain(
      'exec bash "${here}/../../../../scripts/lisa-hooks/sonar-secrets.sh" claude-prompt-submit'
    );
    expect(body).not.toMatch(/^sonar hook/m);
    expect((await stat(shim)).mode & 0o7777).toBe(0o755);
  });

  it("is idempotent: a second run rewrites nothing", async () => {
    const root = await checkout();
    const shim = await writeShim(root, CLAUDE_PROMPT, vendorShim(PROMPT_EVENT));
    await repointSonarShims(root);
    const first = await readFile(shim);

    const second = await repointSonarShims(root);

    expect(second.repointed).toEqual([]);
    expect(await readFile(shim)).toEqual(first);
  });

  it("leaves a shim already patched by the setup skill untouched", async () => {
    const root = await checkout();
    const patched = [
      SHEBANG,
      "# Delegates to Lisa's wrapper (hand-patched per lisa-setup-sonar §4a).",
      "if ! command -v sonar &> /dev/null; then",
      "  exit 0",
      "fi",
      'here="$(cd -- "$(dirname -- "$0")" && pwd)"',
      'exec bash "${here}/../../../../scripts/lisa-hooks/sonar-secrets.sh" claude-prompt-submit',
      "",
    ].join("\n");
    const shim = await writeShim(root, CLAUDE_PROMPT, patched);

    const result = await repointSonarShims(root);

    expect(result.repointed).toEqual([]);
    expect(await readFile(shim, "utf8")).toBe(patched);
  });

  it.each([
    ["an extra command", `${vendorShim(PROMPT_EVENT)}echo done\n`],
    [
      "a piped hook call",
      vendorShim(PROMPT_EVENT).replace(
        "sonar hook claude-prompt-submit",
        "sonar hook claude-prompt-submit | jq ."
      ),
    ],
  ])(
    "reports a customised shim with %s and leaves it",
    async (_label, body) => {
      const root = await checkout();
      const shim = await writeShim(root, CLAUDE_PROMPT, body);

      const result = await repointSonarShims(root);

      expect(result.repointed).toEqual([]);
      expect(result.unrecognized).toEqual([CLAUDE_PROMPT]);
      expect(await readFile(shim, "utf8")).toBe(body);
    }
  );

  it("silently skips a documented file that never calls sonar hook", async () => {
    const root = await checkout();
    const body = `${SHEBANG}\necho unrelated\n`;
    await writeShim(root, CLAUDE_PROMPT, body);

    const result = await repointSonarShims(root);

    expect(result.repointed).toEqual([]);
    expect(result.unrecognized).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)(
    "reports an unwritable shim as failed without throwing",
    async () => {
      const root = await checkout();
      const body = vendorShim(PROMPT_EVENT);
      const shim = await writeShim(root, CLAUDE_PROMPT, body);
      await chmod(shim, 0o555);

      const result = await repointSonarShims(root);

      expect(result.failed).toEqual([CLAUDE_PROMPT]);
      expect(result.repointed).toEqual([]);
      expect(await readFile(shim, "utf8")).toBe(body);
    }
  );

  it("ignores a vendor-shaped body at a path the skill does not list", async () => {
    const root = await checkout();
    const body = vendorShim(PROMPT_EVENT);
    const shim = await writeShim(root, ".claude/hooks/other/prompt.sh", body);

    const result = await repointSonarShims(root);

    expect(result.repointed).toEqual([]);
    expect(await readFile(shim, "utf8")).toBe(body);
  });

  it("writes nothing when the wrapper is not installed", async () => {
    const root = await checkout(false);
    const body = vendorShim(PROMPT_EVENT);
    const shim = await writeShim(root, CLAUDE_PROMPT, body);

    const result = await repointSonarShims(root);

    expect(result).toEqual({
      wrapperPresent: false,
      repointed: [],
      failed: [],
      unrecognized: [],
    });
    expect(await readFile(shim, "utf8")).toBe(body);
  });

  it("skips a symlinked shim rather than writing through it", async () => {
    const root = await checkout();
    const target = path.join(root, "elsewhere.sh");
    const body = vendorShim(PROMPT_EVENT);
    await writeFile(target, body);
    const link = path.join(root, CLAUDE_PROMPT);
    await mkdir(path.dirname(link), { recursive: true });
    await symlink(target, link);

    const result = await repointSonarShims(root);

    expect(result.repointed).toEqual([]);
    expect(await readFile(target, "utf8")).toBe(body);
  });

  it("computes the Antigravity wrapper path three levels up", async () => {
    const root = await checkout();
    const shim = await writeShim(
      root,
      ANTIGRAVITY,
      vendorShim("antigravity-pre-tool-use")
    );

    const result = await repointSonarShims(root);

    expect(result.repointed).toEqual([ANTIGRAVITY]);
    expect(await readFile(shim, "utf8")).toContain(
      'exec bash "${here}/../../../scripts/lisa-hooks/sonar-secrets.sh" antigravity-pre-tool-use'
    );
  });

  it("makes the unauthenticated scanner warn instead of blocking", async () => {
    const root = await checkout();
    const original = await writeShim(
      root,
      "vendor-original.sh",
      vendorShim(PROMPT_EVENT)
    );
    const shim = await writeShim(root, CLAUDE_PROMPT, vendorShim(PROMPT_EVENT));

    const before = runShim(original, root);
    await repointSonarShims(root);
    const after = runShim(shim, root);

    expect(before.stdout).toContain('"decision":"block"');
    expect(after.status).toBe(0);
    expect(after.stdout).not.toContain('"decision":"block"');
    expect(after.stderr).toContain("local secret scanning is inactive");
  });
});

describe("parseVendorShimEvent", () => {
  it.each([
    ["the vendor form", "sonar hook claude-pre-tool-use"],
    ["an exec form", "exec sonar hook claude-pre-tool-use"],
    ["a cat pipe", "cat | sonar hook claude-pre-tool-use"],
    ["forwarded arguments", 'sonar hook claude-pre-tool-use "$@"'],
  ])("recognises %s", (_label, hookLine) => {
    const body = vendorShim("claude-pre-tool-use").replace(
      "sonar hook claude-pre-tool-use",
      hookLine
    );

    expect(parseVendorShimEvent(body)).toBe("claude-pre-tool-use");
  });

  it("rejects a body with two hook calls", () => {
    const body = `${vendorShim("a-event")}sonar hook b-event\n`;

    expect(parseVendorShimEvent(body)).toBeUndefined();
  });

  it("rejects a body that already names the wrapper", () => {
    expect(
      parseVendorShimEvent(
        "#!/bin/bash\nexec bash scripts/lisa-hooks/sonar-secrets.sh x\n"
      )
    ).toBeUndefined();
  });
});

import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const GIT = "/usr/bin/git";
const ROOT_HOOK = path.resolve(".husky/pre-push");
const RAILS_ENV_WRAPPER = path.resolve(
  "rails/copy-overwrite/scripts/lisa-clean-git-env.sh"
);
const RAILS_LEFTHOOK = path.resolve("rails/copy-overwrite/lefthook.yml");
const MANAGED_HOOKS = [
  ".husky/pre-push",
  "typescript/copy-contents/.husky/pre-push",
  ".claude-pr/.husky/pre-push",
] as const;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map(async root => await rm(root, { recursive: true, force: true }))
  );
});

describe("pre-push Git environment isolation", () => {
  it.each(MANAGED_HOOKS)("sanitizes the managed hook %s", async hook => {
    const source = await readFile(path.resolve(hook), "utf8");
    expect(source).toContain(
      "GIT_LOCAL_ENV_VARS=$(git rev-parse --local-env-vars) || exit 1"
    );
    expect(source).toContain(
      "for GIT_LOCAL_ENV_VAR in $GIT_LOCAL_ENV_VARS; do"
    );
    expect(source).toContain('unset "$GIT_LOCAL_ENV_VAR"');
    expect(source).toContain("unset GIT_LOCAL_ENV_VAR GIT_LOCAL_ENV_VARS");
  });

  it.each([MANAGED_HOOKS[0], MANAGED_HOOKS[1]])(
    "sanitizes %s after work-item validation and before quality commands",
    async hook => {
      const source = await readFile(path.resolve(hook), "utf8");
      expect(source.indexOf("validate-push")).toBeLessThan(
        source.indexOf("git rev-parse --local-env-vars")
      );
      expect(source.indexOf("git rev-parse --local-env-vars")).toBeLessThan(
        source.indexOf("test:cov")
      );
    }
  );

  it("removes hook-local Git variables before coverage enters a foreign repository", async () => {
    const fixture = await createHookFixture();
    const poisonedRoot = await realpath(process.cwd());
    const poisonedGitDir = execFileSync(
      GIT,
      ["rev-parse", "--absolute-git-dir"],
      { cwd: poisonedRoot, encoding: "utf8" }
    ).trim();

    execFileSync(
      "/bin/sh",
      [ROOT_HOOK, "upstream", "git@example.com:acme/project.git"],
      {
        cwd: fixture.root,
        env: {
          PATH: fixture.bin,
          HOOK_COMMAND_LOG: fixture.commandLog,
          HOOK_DISCOVERY_LOG: fixture.discoveryLog,
          HOOK_VALIDATE_LOG: fixture.validateLog,
          GIT_DIR: poisonedGitDir,
          GIT_WORK_TREE: poisonedRoot,
          GIT_INDEX_FILE: path.join(poisonedGitDir, "index"),
          GIT_PREFIX: "poisoned-prefix/",
        },
        encoding: "utf8",
      }
    );

    expect(await readFile(fixture.validateLog, "utf8")).toBe(
      "scripts/lisa-work-item.mjs validate-push upstream\n"
    );
    expect((await readFile(fixture.discoveryLog, "utf8")).trim()).toBe(
      fixture.root
    );
    expect(await readFile(fixture.commandLog, "utf8")).toBe(
      "run typecheck\nrun test:cov\nrun test:integration\n"
    );
  });

  it("wraps every Rails quality command after work-item validation", async () => {
    const source = await readFile(RAILS_LEFTHOOK, "utf8");
    const wrapper = "sh scripts/lisa-clean-git-env.sh";
    expect(source.indexOf("validate-push {1}")).toBeLessThan(
      source.indexOf(`${wrapper} bundle exec rspec`)
    );
    for (const command of [
      "bundle exec bundler-audit check --update",
      "bundle exec rspec",
      "bundle exec brakeman --no-pager --quiet",
      "bundle exec reek app/ lib/",
      "bundle exec flog --all --group app/ lib/",
      "bundle exec flay app/ lib/",
      "bash scripts/lisa-mutation.sh",
    ]) {
      expect(source).toContain(`${wrapper} ${command}`);
    }
  });

  it("cleans Rails command environments and preserves foreign-repo discovery", async () => {
    const fixture = await createHookFixture();
    const poisonedRoot = await realpath(process.cwd());
    const poisonedGitDir = execFileSync(
      GIT,
      ["rev-parse", "--absolute-git-dir"],
      { cwd: poisonedRoot, encoding: "utf8" }
    ).trim();
    const assertion = [
      '[ "${GIT_DIR+x}" != "x" ]',
      '[ "${GIT_WORK_TREE+x}" != "x" ]',
      '[ "${GIT_INDEX_FILE+x}" != "x" ]',
      '[ "${GIT_PREFIX+x}" != "x" ]',
      "exec /usr/bin/git rev-parse --show-toplevel",
    ].join(" && ");

    const discovered = execFileSync(
      "/bin/sh",
      [RAILS_ENV_WRAPPER, "/bin/sh", "-c", assertion],
      {
        cwd: fixture.root,
        env: {
          PATH: "/usr/bin:/bin",
          GIT_DIR: poisonedGitDir,
          GIT_WORK_TREE: poisonedRoot,
          GIT_INDEX_FILE: path.join(poisonedGitDir, "index"),
          GIT_PREFIX: "poisoned-prefix/",
        },
        encoding: "utf8",
      }
    ).trim();
    expect(discovered).toBe(fixture.root);
  });
});

/**
 * Create one foreign repository with hermetic fake quality commands.
 * @returns Paths used to execute and inspect the hook fixture
 */
async function createHookFixture(): Promise<{
  readonly root: string;
  readonly bin: string;
  readonly commandLog: string;
  readonly discoveryLog: string;
  readonly validateLog: string;
}> {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "lisa-pre-push-env-"))
  );
  const bin = path.join(root, "bin");
  const commandLog = path.join(root, "commands.log");
  const discoveryLog = path.join(root, "discovery.log");
  const validateLog = path.join(root, "validate.log");
  temporaryRoots.push(root);
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(bin);
  await writeFile(path.join(root, "package.json"), "{}\n");
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await writeFile(
    path.join(root, "scripts/lisa-work-item.mjs"),
    "// fixture\n"
  );
  execFileSync(GIT, ["init", "-q"], { cwd: root });
  await symlink(GIT, path.join(bin, "git"));
  await writeExecutable(
    path.join(bin, "node"),
    '#!/bin/sh\nprintf "%s\\n" "$*" > "$HOOK_VALIDATE_LOG"\n'
  );
  await writeExecutable(path.join(bin, "npm"), FAKE_NPM);
  return { root, bin, commandLog, discoveryLog, validateLog };
}

/**
 * Write one executable POSIX fixture script.
 * @param target - Destination path
 * @param source - Complete script source
 */
async function writeExecutable(target: string, source: string): Promise<void> {
  await writeFile(target, source);
  await chmod(target, 0o755);
}

const FAKE_NPM = `#!/bin/sh
if [ "$1" = "run" ] && [ "$2" = "test:cov" ]; then
  if [ "\${GIT_DIR+x}" = "x" ] || [ "\${GIT_WORK_TREE+x}" = "x" ] || [ "\${GIT_INDEX_FILE+x}" = "x" ] || [ "\${GIT_PREFIX+x}" = "x" ]; then
    echo "repository-local Git environment leaked" >&2
    exit 41
  fi
  git rev-parse --show-toplevel > "$HOOK_DISCOVERY_LOG" || exit 42
fi
printf "%s\\n" "$*" >> "$HOOK_COMMAND_LOG"
`;

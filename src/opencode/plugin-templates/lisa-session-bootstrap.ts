/**
 * Lisa-managed OpenCode plugin (session bootstrap).
 *
 * OpenCode runs a plugin's factory function once when it loads the plugin at
 * session start, which is the natural home for Lisa's Codex SessionStart hooks:
 *   - install-pkgs.sh   → install dependencies when node_modules is missing
 *   - setup-jira-cli.sh → write jira-cli config from environment variables
 *
 * Both are fully fail-open (wrapped in try/catch) so a package-manager or
 * filesystem hiccup never bricks OpenCode startup, mirroring the Codex scripts.
 * install only runs on the first session of a fresh checkout (node_modules
 * absent), so the common case is a cheap no-op.
 *
 * NOTE: This file is a template Lisa copies verbatim into a host project's
 * `.opencode/plugin/`. It is intentionally excluded from this repo's tsconfig
 * and eslint config — it runs under OpenCode's Bun runtime, not here.
 */
export const LisaSessionBootstrap = async ({
  $,
  worktree,
}: {
  $: (strings: TemplateStringsArray, ...exprs: unknown[]) => any;
  worktree: string;
}) => {
  const root = worktree;
  const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");

  // install-pkgs: bootstrap dependencies when they're missing.
  try {
    if (
      existsSync(`${root}/package.json`) &&
      !existsSync(`${root}/node_modules`)
    ) {
      const has = (f: string) => existsSync(`${root}/${f}`);
      const install = async (cmd: string) => {
        if (Bun.which(cmd)) {
          await $`${cmd} install`.cwd(root).quiet().nothrow();
        }
      };
      if (has("bun.lockb") || has("bun.lock")) await install("bun");
      else if (has("pnpm-lock.yaml")) await install("pnpm");
      else if (has("yarn.lock")) await install("yarn");
      else await install("npm");
    }
  } catch {
    // fail open — never block startup on a dependency-install error
  }

  // setup-jira-cli: write jira-cli config from environment variables.
  try {
    const server = process.env.JIRA_SERVER;
    const login = process.env.JIRA_LOGIN;
    const home = process.env.HOME;
    if (server && login && home) {
      const dir = `${home}/.config/.jira`;
      mkdirSync(dir, { recursive: true });
      const config = [
        `installation: ${process.env.JIRA_INSTALLATION ?? "cloud"}`,
        `server: ${server}`,
        `login: ${login}`,
        `project: ${process.env.JIRA_PROJECT ?? ""}`,
        `board: "${process.env.JIRA_BOARD ?? ""}"`,
        "auth_type: basic",
        "epic:",
        "  name: Epic Name",
        "  link: Epic Link",
        "",
      ].join("\n");
      writeFileSync(`${dir}/.config.yml`, config);
    }
  } catch {
    // fail open — never block startup on a jira-cli config error
  }

  return {};
};

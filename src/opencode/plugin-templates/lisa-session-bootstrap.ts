/**
 * Lisa-managed OpenCode plugin (session bootstrap).
 *
 * OpenCode runs a plugin's factory function once when it loads the plugin at
 * session start, which is the natural home for Lisa's Codex SessionStart hooks:
 *   - install-pkgs.sh   → install dependencies when node_modules is missing
 *   - setup-jira-cli.sh → write jira-cli config from environment variables, only
 *     when the project's configured tracker is jira
 *   - auto-update.sh    → update the project to the latest Lisa (autoUpdate)
 *
 * All are fully fail-open (wrapped in try/catch) so a package-manager or
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
  const { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } =
    await import("node:fs");

  // install-pkgs: bootstrap dependencies when they're missing.
  try {
    if (
      existsSync(`${root}/package.json`) &&
      !existsSync(`${root}/node_modules`)
    ) {
      let linkedPrimaryNodeModules = false;
      const marker = "/.claude/worktrees/";
      if (root.includes(marker)) {
        const primaryRoot = root.slice(0, root.indexOf(marker));
        const primaryNodeModules = `${primaryRoot}/node_modules`;
        if (primaryRoot && existsSync(primaryNodeModules)) {
          symlinkSync(primaryNodeModules, `${root}/node_modules`);
          linkedPrimaryNodeModules = true;
        }
      }

      const has = (f: string) => existsSync(`${root}/${f}`);
      const install = async (cmd: string) => {
        if (Bun.which(cmd)) {
          await $`${cmd} install`.cwd(root).quiet().nothrow();
        }
      };
      if (!linkedPrimaryNodeModules) {
        if (has("bun.lockb") || has("bun.lock")) await install("bun");
        else if (has("pnpm-lock.yaml")) await install("pnpm");
        else if (has("yarn.lock")) await install("yarn");
        else await install("npm");
      }
    }
  } catch {
    // fail open — never block startup on a dependency-install error
  }

  // auto-update: the same engine as the Claude/Codex/Cursor/Copilot SessionStart
  // hook (CodySwannGT/lisa#4337), run from the project's installed Lisa package,
  // which ships `plugins/lisa/hooks/`. It is not a guard, so it is not staged
  // beside this plugin; running it from node_modules is safe even though it
  // rewrites node_modules, because Node has loaded it before anything changes.
  // It runs after install so it sees the installed version, honours
  // `autoUpdate: false`, only touches a clean tree, and reports what it did.
  // OpenCode has no context-injection channel here, so the report goes to the
  // console the session shows.
  try {
    const engine = `${root}/node_modules/@codyswann/lisa/plugins/lisa/hooks/auto-update.mjs`;
    if (existsSync(engine) && !Bun.which("node")) {
      console.error(
        "lisa-auto-update: node is not on PATH, so the session-start Lisa update could not run. Install Node.js (or add it to PATH) to enable it."
      );
    } else if (existsSync(engine)) {
      const result = await $`node ${engine} --project-dir ${root}`
        .cwd(root)
        .quiet()
        .nothrow();
      const text = String(result.stdout ?? "").trim();
      if (text) {
        const context = JSON.parse(text)?.hookSpecificOutput?.additionalContext;
        if (context) console.error(context);
      }
    } else if (
      existsSync(`${root}/node_modules/@codyswann/lisa/package.json`)
    ) {
      // This plugin is only written by an apply of a Lisa that ships the
      // engine, so an installed Lisa without it means node_modules is older
      // than the project's own files. Say so rather than skipping silently.
      console.error(
        "lisa-auto-update: the installed @codyswann/lisa predates this project's Lisa files, so the session-start update could not run. Run your package install to bring node_modules up to date."
      );
    }
  } catch {
    // fail open — a session must start even when the update cannot run
  }

  // setup-jira-cli: write jira-cli config from environment variables and non-secret Lisa config.
  // Gated on `tracker: "jira"` — a project on Linear or GitHub Issues has no use
  // for a jira-cli config, and writing one made a false implicit claim about the
  // project's tracker. Fails closed: an absent tracker writes nothing, because
  // Lisa treats a missing `tracker` as unconfigured, not as a jira default.
  try {
    const readLisaConfig = (path: string[]) => {
      for (const file of [".lisa.config.local.json", ".lisa.config.json"]) {
        const configPath = `${root}/${file}`;
        if (!existsSync(configPath)) continue;
        let contents: string;
        try {
          contents = readFileSync(configPath, "utf8");
        } catch (error) {
          console.error(
            `lisa-session-bootstrap: ${configPath} could not be read; treating it as absent: ${String(error)}`
          );
          continue;
        }
        try {
          let value: unknown = JSON.parse(contents);
          for (const key of path) {
            if (!value || typeof value !== "object" || !(key in value)) {
              value = undefined;
              break;
            }
            value = (value as Record<string, unknown>)[key];
          }
          if (typeof value === "string" && value) return value;
        } catch (error) {
          // VISIBLE, not silent. A config that exists but cannot be parsed is
          // a failure, not an answer: treating it as absent reports the
          // project as unconfigured when nobody can see that anything went
          // wrong. The two shell implementations exit non-zero here. This one
          // cannot — throwing out of the plugin factory would take the whole
          // session down — so the compensating rung is a warning naming the
          // file, per the AGENTS.md rule on gaps a harness cannot represent.
          console.error(
            `lisa-session-bootstrap: ${configPath} is not valid JSON; treating it as absent: ${String(error)}`
          );
        }
      }
      return undefined;
    };
    if (readLisaConfig(["tracker"]) !== "jira") return {};
    const atlassianSite = readLisaConfig(["atlassian", "site"]);
    const server =
      process.env.JIRA_SERVER ??
      (/^https?:\/\//.test(atlassianSite ?? "")
        ? atlassianSite
        : atlassianSite
          ? `https://${atlassianSite}`
          : undefined);
    const project =
      process.env.JIRA_PROJECT ?? readLisaConfig(["jira", "project"]) ?? "";
    const login = process.env.JIRA_LOGIN;
    if (server && login) {
      // Consumers of this file (CodySwannGT/lisa#2767 — until then it had
      // none, making this hook an inert control):
      //   * lisa-jira-evidence/scripts/post-evidence.sh — greps server/login,
      //     then passes `--config <path>` to `jira issue move`.
      //   * lisa-jira-read-ticket/scripts/download-attachment.sh — greps the
      //     same keys, but only when JIRA_SERVER/JIRA_LOGIN are unset.
      //   * SKILL prose — types `jira --config .lisa/jira-cli/.config.yml`.
      //
      // No per-harness environment export is involved anywhere: two consumers
      // parse this YAML in Lisa-owned code, and the one real jira-cli call
      // passes an argument. jira-cli resolves --config > JIRA_CONFIG_FILE >
      // ~/.config/.jira/.config.yml, and a --config path that does not exist
      // fails closed rather than falling back (measured, jira-cli v1.7.0).
      const dir = `${root}/.lisa/jira-cli`;
      mkdirSync(dir, { recursive: true });
      const config = [
        `installation: ${process.env.JIRA_INSTALLATION ?? "cloud"}`,
        `server: ${server}`,
        `login: ${login}`,
        `project: ${project}`,
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

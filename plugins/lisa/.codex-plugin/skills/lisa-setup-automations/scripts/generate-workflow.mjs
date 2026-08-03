#!/usr/bin/env node
/**
 * Generate the GitHub Actions workflow that fires a registered automation loop.
 *
 * Once `executionEnv` exists, a scheduled loop is a thin dispatcher: it wakes,
 * picks eligible work, submits it to a remote surface, records the identifier,
 * and exits. The heavy lifting happens elsewhere. That makes the clock's job
 * cheap and boring, and the requirements on it are availability rather than
 * power.
 *
 * The workflow is generated from `.lisa.config.json` rather than hand-written,
 * so config stays the source of truth and swapping the scheduler later is a
 * config change instead of a rewrite.
 *
 * Usage:
 *   generate-workflow.mjs <loop-name> [--write]
 * @module generate-workflow
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Where a generated loop workflow lands. */
export const workflowPath = name =>
  join(".github", "workflows", `lisa-${name}.yml`);

/**
 * Read one automation's declaration.
 * @param {string} name Loop name.
 * @param {string} [cwd] Repository root.
 * @returns {object} The loop's configuration.
 */
export function readAutomation(name, cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  if (!existsSync(path)) throw new Error(".lisa.config.json is missing");
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  const loop = cfg.automations?.[name];
  if (!loop) {
    throw new Error(
      `no automations["${name}"] in .lisa.config.json.\n` +
        `Declare the loop before generating its workflow.`
    );
  }
  const surface = cfg.remoteEnv?.surfaces?.[loop.executionEnv];
  const github = cfg.github ?? {};
  return {
    ...loop,
    // Only used for the fork guard, so it is a question about *this* repository
    // rather than about the surface. Read from the surface where one records it
    // — Codex Cloud binds an environment to a repository — and otherwise from
    // the project's own GitHub config. A Claude cloud environment binds no
    // repository at all, and demanding one there asked for a field that cannot
    // exist, which refused to generate a workflow for a correctly configured
    // loop.
    repository:
      surface?.repository ??
      (github.org && github.repo ? `${github.org}/${github.repo}` : undefined),
    // Where this project keeps its bootstrap. A workstation serving several
    // tenants gives each its own name, so the generated workflow must template
    // it rather than assume the default.
    bootstrapKey: cfg.secrets?.bootstrap?.key ?? "BWS_ACCESS_TOKEN",
  };
}

/**
 * Emit shell that locates a Lisa skill script before running it.
 *
 * A hardcoded `.claude/skills/...` path is wrong in exactly the place this
 * workflow runs. Claude and Codex receive Lisa skills as an installed plugin
 * living in the user's home directory, which is emphatically not part of a
 * clone — and a scheduled run is always a fresh clone with no plugin install.
 * So the one path that reliably exists on a runner is the npm package, at the
 * version the project pins, which is the version its automation should run.
 *
 * The same candidate list the remote-env entrypoint uses, for the same reason:
 * the in-checkout copies are cheapest and need nothing installed, and
 * `node_modules` is the fallback that makes the plugin-delivered harnesses work
 * at all.
 * @param {string} skill Skill slug that owns the script.
 * @param {string} script Script filename.
 * @param {string[]} args Arguments appended to the invocation, one per line.
 * @returns {string} Shell, indented for a workflow `run:` block.
 */
function runSkillScript(skill, script, args) {
  const candidates = [
    `.claude/skills/${skill}/scripts/${script}`,
    `.agents/skills/${skill}/scripts/${script}`,
    `.codex/skills/${skill}/scripts/${script}`,
    `node_modules/@codyswann/lisa/plugins/lisa/skills/${skill}/scripts/${script}`,
  ]
    .map(candidate => `            "${candidate}"`)
    .join(" \\\n");
  const tail = args.map(arg => `            ${arg}`).join(" \\\n");
  return `          runner=""
          for candidate in \\
${candidates}; do
            if [ -f "$candidate" ]; then runner="$candidate"; break; fi
          done
          if [ -z "$runner" ]; then
            echo "cannot find ${skill}/scripts/${script}" >&2
            echo "Checked the agent skill directories and node_modules." >&2
            echo "Lisa skills reach Claude and Codex as an installed plugin," >&2
            echo "so node_modules is the only copy a runner ever has." >&2
            exit 1
          fi
          node "$runner" \\
${tail}`;
}

/**
 * Render the workflow YAML for one loop.
 *
 * Three choices here are load-bearing rather than stylistic.
 *
 * The `schedule` trigger is emitted **only when the loop is enabled**. A
 * recurring trigger goes live after the exact production path has been proven
 * once for one real item, so registration writes a manually-dispatchable
 * workflow and enabling adds the clock.
 *
 * The concurrency group **never cancels in progress**. Cancelling could kill a
 * dispatch after the remote accepted a task but before its identifier was
 * recorded, which orphans irreversible work — nothing left to reconcile against,
 * and a retry that duplicates it.
 *
 * The bootstrap credential is asserted **before** anything is installed, so a
 * misconfigured secret fails in seconds rather than after a toolchain download.
 * @param {string} name Loop name.
 * @param {object} loop Loop configuration.
 * @returns {string} Workflow YAML.
 */
export function renderWorkflow(name, loop) {
  if (!loop.schedule) throw new Error(`automations["${name}"] has no schedule`);
  // The repository secret and the environment variable carry the same name, so
  // the value the workflow exports is the one `bootstrap.key` tells the resolver
  // to look for. Translating it to the provider CLI's own variable is
  // providers.mjs's job, not this workflow's.
  const bootstrap = loop.bootstrapKey ?? "BWS_ACCESS_TOKEN";
  if (!loop.repository) {
    throw new Error(
      `cannot determine which repository this loop belongs to.\n` +
        `The generated workflow guards on it so a fork never dispatches. Set ` +
        `github.org and github.repo in .lisa.config.json.`
    );
  }

  // Always emitted, even for a surface whose dispatcher token is not consumed
  // by use. Making it conditional on secrets.rotating would mean a project that
  // later declares one, without regenerating its workflow, silently loses the
  // persist step and strands the replacement. One inert step is the cheaper
  // failure.
  const rotation = `
      # The dispatcher authenticates with a credential that rotates on use, so
      # the replacement must be persisted even when the dispatch itself failed.
      - name: Persist any credential rotation
        if: \${{ always() }}
        env:
          ${bootstrap}: \${{ secrets.${bootstrap} }}
        run: |
          set -euo pipefail
${runSkillScript("lisa-secrets-access", "rotate-secret.mjs", ["leases"])}`;

  const trigger = loop.enabled
    ? `  schedule:\n    - cron: '${loop.schedule}'\n  workflow_dispatch:`
    : `  # schedule: disabled until the production path is proven once for one\n` +
      `  # real item. Enabling adds:  - cron: '${loop.schedule}'\n  workflow_dispatch:`;

  return `# Generated by lisa-setup-automations from .lisa.config.json.
# Edit the config and regenerate; hand edits are overwritten.
name: 🔁 Lisa ${name}

on:
${trigger}

# Never cancel in progress. A cancelled dispatch can leave a remote task that
# was accepted but whose identifier was never recorded — irreversible work with
# nothing to reconcile against, where a retry duplicates it.
concurrency:
  group: lisa-${name}
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  dispatch:
    name: Dispatch one ${name} cycle
    if: github.repository == '${loop.repository}'
    runs-on: ubuntu-latest
    timeout-minutes: ${loop.timeoutMinutes ?? 15}
    env:
      LISA_SECRETS_SURFACE: github-actions

    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false

      # Assert first, install second: a misconfigured bootstrap should fail in
      # seconds rather than after a toolchain download.
      - name: Check the bootstrap credential is configured
        env:
          ${bootstrap}: \${{ secrets.${bootstrap} }}
        run: |
          set -euo pipefail
          test -n "\${${bootstrap}}" || {
            echo "${bootstrap} is not configured for this repository" >&2
            exit 1
          }

      - name: Prepare the toolchain and secrets
        env:
          ${bootstrap}: \${{ secrets.${bootstrap} }}
        run: bash scripts/lisa-remote-env/setup.sh

      - name: Run one ${name} cycle
        env:
          ${bootstrap}: \${{ secrets.${bootstrap} }}
        run: |
          set -euo pipefail
${runSkillScript("lisa-remote-dispatch", "dispatch.mjs", [
  `'executionEnv=${loop.executionEnv} ${loop.payload ?? ""}'`,
  `--skill ${loop.skill ?? `lisa-${name}`}`,
])}

${rotation}
`;
}

function main() {
  const [name, ...flags] = process.argv.slice(2);
  if (!name)
    throw new Error("usage: generate-workflow.mjs <loop-name> [--write]");
  const loop = readAutomation(name);
  const yaml = renderWorkflow(name, loop);

  if (!flags.includes("--write")) {
    process.stdout.write(yaml);
    return;
  }
  const path = workflowPath(name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, yaml);
  console.log(`wrote ${path}`);
  if (!loop.enabled) {
    console.log(
      "Registered DISABLED. Prove the exact production path once for one real " +
        "item with a manual dispatch, then set enabled: true and regenerate."
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

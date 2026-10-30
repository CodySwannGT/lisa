/** Action-aware native transport; the component readiness API does not grant mutations. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AccessFailure } from "./config-layers.mjs";
import { readConfig } from "./surfaces.mjs";
import { taskReadiness, failure } from "./task-readiness.mjs";
import { readTaskRequirements } from "./task-requirements.mjs";
import { lifecycleEvents, resetNativeEvent } from "./task-native-lifecycle.mjs";
import { intakeRead } from "./task-intake.mjs";
import { nativeContext } from "./task-native-context.mjs";
import {
  nativeAction,
  invalidateNative,
  clearNative,
} from "./task-native-flow.mjs";
const owner = join(
  dirname(fileURLToPath(import.meta.url)),
  "preflight-secrets.mjs"
);
const refs = /^(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|[A-Z][A-Z0-9]+-\d+)$/;
const quote = path => `'${path.replaceAll("'", "'\\''")}'`;

/** Exact canonical recovery command. JSON uses structured child/terminal stdin, not redirects. */
export function readinessOwnerInvocation(command) {
  if (typeof command !== "string") return false;
  for (const runtime of ["node", process.execPath, quote(process.execPath)])
    for (const script of [owner, quote(owner)]) {
      if (command === `${runtime} ${script} --task`) return true;
      for (const mode of ["task", "prepare"]) {
        const prefix = `${runtime} ${script} --${mode} --ref `;
        if (
          command.startsWith(prefix) &&
          refs.test(command.slice(prefix.length))
        )
          return true;
      }
    }
  return false;
}

/** Unrelated orientation and bounded owner recovery remain reachable during refusal. */
function orientation(input) {
  if (
    ["Read", "Glob", "Grep", "read", "glob", "grep"].includes(input?.tool_name)
  )
    return true;
  if (input?.tool_name !== "Bash") return false;
  return (
    readinessOwnerInvocation(input.tool_input?.command) ||
    [
      "pwd",
      "git status --short",
      "git status --porcelain=v1",
      "git rev-parse HEAD",
      "gh api user",
      "gh auth status",
    ].includes(input.tool_input?.command)
  );
}

/** A fixed scoped repository read is recovery, never access proof for another scope. */
function repositoryProbe(input, cfg) {
  const github = cfg.effective?.github,
    resource = github && `${github.org}/${github.repo}`;
  return (
    input?.tool_name === "Bash" &&
    resource &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(resource) &&
    input.tool_input?.command === `gh api repos/${resource}`
  );
}

/** Existing Atlassian owner discovery is read-only, not an access attestation. */
function accessOwnerProbe(input, cfg) {
  const server = input?.mcp_server;
  if (
    server?.source !== "plugin" ||
    server.name !== "plugin:atlassian:atlassian" ||
    Object.keys(server).sort().join() !== "name,source"
  )
    return false;
  const args = input.tool_input;
  if (!args || typeof args !== "object" || Array.isArray(args)) return false;
  if (
    input.tool_name ===
    "mcp__plugin_atlassian_atlassian__getAccessibleAtlassianResources"
  )
    return Object.keys(args).length === 0;
  return (
    [
      "mcp__plugin_atlassian_atlassian__getConfluenceSpaces",
      "mcp__plugin_atlassian_atlassian__getVisibleJiraProjects",
    ].includes(input.tool_name) &&
    Object.keys(args).length === 1 &&
    typeof cfg.effective?.atlassian?.cloudId === "string" &&
    args.cloudId === cfg.effective.atlassian.cloudId
  );
}

/** Process a registered native event or the canonical read-only task CLI. */
export function runTaskAction(argv = process.argv) {
  const hook = argv.includes("--hook"),
    observe = argv.includes("--observe-native");
  let result, input, cfg;
  try {
    input =
      hook || observe || argv.includes("--reset-native")
        ? JSON.parse(readFileSync(0, "utf8"))
        : null;
    if (
      argv.includes("--reset-native") ||
      (!hook && lifecycleEvents.has(input?.hook_event_name))
    ) {
      resetNativeEvent(input);
      return;
    }
    if (hook && orientation(input)) {
      try {
        resetNativeEvent(input);
      } catch {
        /* Orientation grants no work. */
      }
      return;
    }
    cfg = readConfig(input?.cwd ?? process.cwd());
    if (hook && nativeContext(input, cfg)) {
      resetNativeEvent(input);
      console.error(
        "requirements-prepared: Context prepared; run readiness. The redundant raw file operation was denied."
      );
      process.exitCode = 2;
      return;
    }
    if (hook && intakeRead(input, cfg)) {
      resetNativeEvent(input);
      return;
    }
    if (hook && repositoryProbe(input, cfg)) {
      invalidateNative(input, cfg);
      return;
    }
    const refIndex = argv.indexOf("--ref"),
      ref = refIndex >= 0 ? argv[refIndex + 1] : undefined;
    const header = readTaskRequirements(cfg, { ref });
    if (hook && !header && accessOwnerProbe(input, cfg)) {
      resetNativeEvent(input);
      return;
    }
    result = taskReadiness({ cfg, requirements: header, ref });
    if (observe) {
      if (
        ["PostToolUse", "PostToolUseFailure"].includes(input.hook_event_name) &&
        header &&
        result.outcome === "NATIVE_OWNER_REQUIRED"
      )
        nativeAction(cfg, header, result, input);
      else clearNative(input, cfg);
      return; // An after event never releases or cancels the original action.
    }
    if (hook && input.hook_event_name !== "PreToolUse")
      result = failure("requirements-stale");
    else if (hook && result.code === "no-active-task")
      result = failure("requirements-stale");
    else if (hook && result.outcome === "NATIVE_OWNER_REQUIRED") {
      const decision = nativeAction(cfg, header, result, input);
      if (decision.allowed) result = { allowed: true, code: decision.code };
      else {
        const first = result.pending[0];
        const diagnosis = failure(decision.code, {
          cfg,
          requirementIndex: first.requirement_index,
          name: header.required_access[first.requirement_index - 1]
            ?.credential_names[0],
          owner: first.owner,
        });
        diagnosis.action += ` Pending: ${result.pending.map(p => `requirement-${p.requirement_index} ${p.owner}`).join(", ")}. Fixed Notion probes: notion-get-self, notion-fetch.`;
        result = diagnosis;
      }
    } else if (hook) clearNative(input, cfg);
  } catch (error) {
    if (input?.session_id) {
      try {
        resetNativeEvent(input);
      } catch {
        /* Future state writes still fail closed. */
      }
    }
    result = failure(
      error instanceof AccessFailure ? error.code : "config-invalid"
    );
  }
  if (observe) return; // No after-response attestation is printed or accepted.
  if (!hook) console.log(JSON.stringify(result));
  else if (!result.allowed) console.error(`${result.code}: ${result.action}`);
  process.exitCode =
    !hook && result.outcome === "NATIVE_OWNER_REQUIRED"
      ? 3
      : result.allowed
        ? 0
        : 2;
}

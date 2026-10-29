#!/usr/bin/env node
/** Controlled provider for completion tests; state changes only after writes. */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { serveProviderApi } from "./work-item-provider-api.mjs";
import {
  selectProviderIssue,
  providerIssueList,
} from "./work-item-provider-issues.mjs";

const args = process.argv.slice(2);
const env = process.env;
const value = flag => args[args.indexOf(flag) + 1];
const has = flag => args.includes(flag);
/**
 * Read separate, long-equals and attached-short native CLI option forms.
 * @param flags - Accepted exact option spellings.
 * @returns Observed literal option value, or undefined when absent.
 */
function option(flags) {
  for (const [index] of args.entries()) {
    for (const flag of flags) {
      if (args[index] === flag) return args[index + 1];
      if (args[index].startsWith(`${flag}=`))
        return args[index].slice(flag.length + 1);
      if (
        flag.length === 2 &&
        args[index].startsWith(flag) &&
        args[index].length > 2
      )
        return args[index].slice(2);
    }
  }
}
const graphql = args[0] === "api" && args[1] === "graphql";
const field = option(["-f", "-F", "--field", "--raw-field"]);
const query = field?.startsWith("query=") ? field.slice(6) : undefined;
const method =
  option(["--method", "-X"]) ??
  (field !== undefined || option(["--input"]) !== undefined ? "POST" : "GET");
const singleStateWrites =
  (args[0] === "release" && args[1] === "upload") ||
  (args[0] === "issue"
    ? !["view", "list"].includes(args[1])
    : args[0] === "api" &&
      (graphql && query?.trim().startsWith("query")
        ? false
        : !["GET", "HEAD"].includes(method.toUpperCase())));

const writes = env.FAKE_GH_ISSUES_FILE
  ? !(
      args[0] === "--version" ||
      (args[0] === "issue" && ["view", "list"].includes(args[1])) ||
      (args[0] === "repo" && args[1] === "view") ||
      (args[0] === "api" &&
        (graphql
          ? query?.trim().startsWith("query") &&
            !query.split(/[^A-Za-z]+/).includes("mutation")
          : ["GET", "HEAD"].includes(method.toUpperCase())))
    )
  : singleStateWrites;
appendFileSync(env.FAKE_GH_LOG, `${args.join(" ")}\n`);
if (writes)
  appendFileSync(env.FAKE_GH_WRITES_FILE, `${JSON.stringify(args)}\n`);

const selected = (() => {
  try {
    return selectProviderIssue(args, env, option, query);
  } catch (error) {
    appendFileSync(
      env.FAKE_GH_UNHANDLED_FILE,
      `${JSON.stringify({ args, writes })}\n`
    );
    process.stderr.write(`${error.message}\n`);
    process.exit(70);
  }
})();
const state = JSON.parse(readFileSync(env.FAKE_GH_STATE_FILE, "utf8"));

/**
 * Emit structured provider output without truncating a piped write.
 * @param payload - Actual native-shaped fixture response.
 */
function json(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/** Reject unsupported transport operations without contacting any service. */
function unsupported() {
  appendFileSync(
    env.FAKE_GH_UNHANDLED_FILE,
    `${JSON.stringify({ args, writes })}\n`
  );
  process.stderr.write(
    `Unsupported controlled gh invocation: ${args.join(" ")}\n`
  );
  process.exitCode = 70;
}

/** Persist the actual simulated mutation before acknowledging success. */
function save() {
  writeFileSync(env.FAKE_GH_STATE_FILE, JSON.stringify(state));
  json(state);
}

if (serveProviderApi(args, env, state)) {
  // Explicit API resources and write-driven publication are handled above.
} else if (args[0] === "--version") {
  process.stdout.write("gh version 2.80.0 (2026-01-01)\n");
} else if (args[0] === "issue" && args[1] === "view") {
  const mutated =
    env.FAKE_GH_WRITE_READBACK_FILE &&
    readFileSync(env.FAKE_GH_WRITES_FILE, "utf8")
      .split("\n")
      .some(
        line =>
          line.startsWith('["issue","edit"') ||
          line.startsWith('["issue","close"')
      );
  const observed = mutated
    ? JSON.parse(readFileSync(env.FAKE_GH_WRITE_READBACK_FILE, "utf8"))
    : state;
  const fields = has("--json")
    ? value("--json").split(",")
    : Object.keys(state);
  json(Object.fromEntries(fields.map(field => [field, observed[field]])));
} else if (args[0] === "issue" && args[1] === "list") {
  if (selected) json(providerIssueList(selected, value("--label")));
  else {
    const payload =
      value("--label") === "status:ready"
        ? (env.FAKE_GH_LIST_STATUS_READY_JSON ?? env.FAKE_GH_LIST_JSON ?? "[]")
        : (env.FAKE_GH_LIST_JSON ?? "[]");
    json(
      JSON.parse(payload).filter(
        issue => issue.number !== state.number || state.state !== "CLOSED"
      )
    );
  }
} else if (args[0] === "issue" && args[1] === "edit") {
  for (const [index] of args.entries()) {
    if (args[index] === "--add-label") {
      const name = args[index + 1];
      if (!state.labels.some(label => label.name === name))
        state.labels.push({ name });
    }
    if (args[index] === "--remove-label") {
      state.labels = state.labels.filter(
        label => label.name !== args[index + 1]
      );
    }
  }
  save();
} else if (args[0] === "issue" && args[1] === "close") {
  state.state = "CLOSED";
  state.stateReason = "COMPLETED";
  save();
} else if (graphql && !writes && query?.includes("subIssues")) {
  json(
    selected
      ? {
          data: {
            repository: {
              issue: {
                subIssues: {
                  nodes: selected.row.children ?? [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }
      : JSON.parse(env.FAKE_GH_HIERARCHY_JSON)
  );
} else if (args[0] === "api" && !writes && args[1]?.includes("/timeline")) {
  if (selected) json(selected.row.timeline ?? []);
  else {
    json(
      JSON.parse(
        args[1].includes("/issues/43/")
          ? (env.FAKE_GH_TIMELINE_43_JSON ?? env.FAKE_GH_TIMELINE_JSON ?? "[]")
          : (env.FAKE_GH_TIMELINE_JSON ?? "[]")
      )
    );
  }
} else if (args[0] === "api" && !writes && args[1]?.includes("/pulls/")) {
  if (selected) {
    const number = args[1].split("/pulls/")[1]?.split("/")[0];
    const pr = selected.registry.pull_requests[number];
    if (!pr || !has("--jq") || value("--jq") !== ".base.ref") unsupported();
    else process.stdout.write(`${pr.base.ref}\n`);
  } else {
    process.stdout.write(
      `${args[1].includes("/pulls/8") ? (env.FAKE_GH_PR_BASE_8 ?? env.FAKE_GH_PR_BASE ?? "main") : (env.FAKE_GH_PR_BASE ?? "main")}\n`
    );
  }
} else if (args[0] === "repo" && args[1] === "view") {
  json({ nameWithOwner: env.FAKE_GH_REPOSITORY ?? "acme/code" });
} else {
  unsupported();
}

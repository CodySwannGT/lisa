/**
 * Controlled provider for completion tests; state changes only after writes.
 *
 * The provider is a function over (argv, environment, io) so the same logic
 * serves two callers. `work-item-stateful-gh.mjs` runs it as the fixture's
 * real `gh` executable, with the process streams as io. A proof suite running
 * the guard in-process calls it directly instead, through
 * `work-item-inprocess-gh.ts`, because one Node start per provider call was
 * nearly all of a proof case's time: a single `complete` makes 53 of them
 * (CodySwannGT/lisa#4616). Every proof suite keeps a case on the executable.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { serveProviderApi } from "./work-item-provider-api.mjs";
import {
  selectProviderIssue,
  providerIssueList,
} from "./work-item-provider-issues.mjs";

/** Thrown to end a run early with an exit status, as `process.exit` did. */
class ProviderExit extends Error {
  /**
   * Carry the status the executable would have exited with.
   * @param {number} status - Exit status to report.
   */
  constructor(status) {
    super(`controlled provider exited ${status}`);
    this.status = status;
  }
}

/**
 * Serve one controlled `gh` invocation.
 * @param {string[]} args - Exact native CLI argument vector.
 * @param {Record<string, string | undefined>} env - Owned fixture transport configuration.
 * @param {{ out(bytes: string | Buffer): void, err(text: string): void, fail(status: number): void, stdin(): Buffer }} io - Output sinks and stdin source.
 * @returns {number | undefined} Status from an early exit, else undefined (io.fail carries any other).
 */
export function statefulGh(args, env, io) {
  try {
    serve(args, env, io);
    return undefined;
  } catch (error) {
    if (error instanceof ProviderExit) return error.status;
    throw error;
  }
}

/**
 * The provider's whole behaviour, unchanged from the executable it was.
 * @param {string[]} args - Exact native CLI argument vector.
 * @param {Record<string, string | undefined>} env - Owned fixture transport configuration.
 * @param {{ out(bytes: string | Buffer): void, err(text: string): void, fail(status: number): void, stdin(): Buffer }} io - Output sinks and stdin source.
 */
function serve(args, env, io) {
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
  /**
   * Emit structured provider output without truncating a piped write.
   * @param payload - Actual native-shaped fixture response.
   */
  function json(payload) {
    io.out(`${JSON.stringify(payload)}\n`);
  }

  /** Reject unsupported transport operations without contacting any service. */
  function unsupported() {
    appendFileSync(
      env.FAKE_GH_UNHANDLED_FILE,
      `${JSON.stringify({ args, writes })}\n`
    );
    io.err(`Unsupported controlled gh invocation: ${args.join(" ")}\n`);
    io.fail(70);
  }

  /** Persist the actual simulated mutation before acknowledging success. */
  function save() {
    writeFileSync(env.FAKE_GH_STATE_FILE, JSON.stringify(state));
    json(state);
  }

  const graphql = args[0] === "api" && args[1] === "graphql";
  const field = option(["-f", "-F", "--field", "--raw-field"]);
  const query = field?.startsWith("query=") ? field.slice(6) : undefined;
  const method =
    option(["--method", "-X"]) ??
    (field !== undefined || option(["--input"]) !== undefined ? "POST" : "GET");
  const singleStateWrites =
    (args[0] === "release" && ["upload", "create"].includes(args[1])) ||
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
  const selected = (() => {
    // Recorded before the selection, which can refuse, exactly as before.
    appendFileSync(env.FAKE_GH_LOG, `${args.join(" ")}\n`);
    if (writes)
      appendFileSync(env.FAKE_GH_WRITES_FILE, `${JSON.stringify(args)}\n`);
    try {
      return selectProviderIssue(args, env, option, query);
    } catch (error) {
      appendFileSync(
        env.FAKE_GH_UNHANDLED_FILE,
        `${JSON.stringify({ args, writes })}\n`
      );
      io.err(`${error.message}\n`);
      throw new ProviderExit(70);
    }
  })();
  const state = JSON.parse(readFileSync(env.FAKE_GH_STATE_FILE, "utf8"));

  if (serveProviderApi(args, env, state, io)) {
    // Explicit API resources and write-driven publication are handled above.
  } else if (args[0] === "--version") {
    io.out("gh version 2.80.0 (2026-01-01)\n");
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
    json(Object.fromEntries(fields.map(name => [name, observed[name]])));
  } else if (args[0] === "issue" && args[1] === "list") {
    if (selected) json(providerIssueList(selected, value("--label")));
    else {
      const payload =
        value("--label") === "status:ready"
          ? (env.FAKE_GH_LIST_STATUS_READY_JSON ??
            env.FAKE_GH_LIST_JSON ??
            "[]")
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
            ? (env.FAKE_GH_TIMELINE_43_JSON ??
                env.FAKE_GH_TIMELINE_JSON ??
                "[]")
            : (env.FAKE_GH_TIMELINE_JSON ?? "[]")
        )
      );
    }
  } else if (args[0] === "api" && !writes && args[1]?.includes("/pulls/")) {
    if (selected) {
      const number = args[1].split("/pulls/")[1]?.split("/")[0];
      const pr = selected.registry.pull_requests[number];
      if (!pr || !has("--jq") || value("--jq") !== ".base.ref") unsupported();
      else io.out(`${pr.base.ref}\n`);
    } else {
      io.out(
        `${args[1].includes("/pulls/8") ? (env.FAKE_GH_PR_BASE_8 ?? env.FAKE_GH_PR_BASE ?? "main") : (env.FAKE_GH_PR_BASE ?? "main")}\n`
      );
    }
  } else if (args[0] === "repo" && args[1] === "view") {
    json({ nameWithOwner: env.FAKE_GH_REPOSITORY ?? "acme/code" });
  } else {
    unsupported();
  }
}

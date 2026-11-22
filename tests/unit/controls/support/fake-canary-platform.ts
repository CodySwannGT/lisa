/**
 * A hosting platform that lives in memory, for the canary pull requests of
 * `lisa controls attest` (CodySwannGT/lisa#4997).
 *
 * A canary is a real branch and a real pull request, so no suite may ever
 * open one. Each suite hands the command this object's `gh` function in
 * place of the real one. It holds one repository with branches, commits and
 * pull requests, runs "checks" on a canary by looking at the files it
 * carries, and records every request in the order it arrived.
 *
 * It can also do the one thing the command must never ask for: accept a pull
 * request into its base branch, which moves that branch
 * (`./fake-canary-writes.ts`). So a case that finds the branch where it was,
 * and no such request in the log, has shown something.
 * @module tests/unit/controls/support/fake-canary-platform
 */
import { READS } from "./fake-canary-reads.js";
import {
  NOT_FOUND,
  refused,
  type Call,
  type FakeCanaryOptions,
  type FakePull,
  type State,
} from "./fake-canary-state.js";
import { WRITES } from "./fake-canary-writes.js";
import {
  fakeGithub,
  statusCheckRuleset,
  type FakeGhResult,
  type RecordedRequest,
} from "./fake-github.js";
import {
  filesAt,
  gitObjects,
  modesAt,
  seedCommit,
} from "./fake-git-objects.js";

export type { FakeCanaryOptions } from "./fake-canary-state.js";

/** The stand-in platform. */
export interface FakeCanaryPlatform {
  readonly gh: (
    args: readonly string[],
    options?: { readonly input?: string }
  ) => FakeGhResult;
  /** Every request received, in order. */
  readonly log: readonly RecordedRequest[];
  /** Every branch that exists now. */
  readonly branches: () => readonly string[];
  readonly pulls: () => readonly FakePull[];
  /** The commit a branch points at. */
  readonly head: (branch: string) => string | undefined;
  /** The files a commit holds, by path. */
  readonly filesAt: (sha: string) => ReadonlyMap<string, string>;
  /** The mode of each file a commit holds, by path. */
  readonly modesAt: (sha: string) => ReadonlyMap<string, string>;
  /** How many looks at a commit's checks come back unfinished. */
  pendingLooks: number;
}

/**
 * Answer one request.
 * @param state - What the platform holds
 * @param request - The request as it was recorded
 * @returns The answer
 */
function answer(state: State, request: RecordedRequest): FakeGhResult {
  const message = state.options.refuse?.(request);
  if (message !== undefined) return refused(message, 500);
  const [resource = "", query = ""] = request.path
    .slice(`repos/${state.options.repo}`.length)
    .replace(/^\//u, "")
    .split("?");
  const call: Call = {
    method: request.method,
    resource,
    query,
    body: (request.body ?? {}) as Readonly<Record<string, unknown>>,
  };
  const routes = request.method === "GET" ? READS : WRITES;
  return (
    routes.reduce<FakeGhResult | undefined>(
      (found, route) => found ?? route(state, call),
      undefined
    ) ?? NOT_FOUND
  );
}

/**
 * Build a stand-in platform holding one repository.
 * @param options - How it is set up
 * @returns The platform and its request log
 */
export function fakeCanaryPlatform(
  options: FakeCanaryOptions
): FakeCanaryPlatform {
  const objects = gitObjects();
  const state: State = {
    options,
    settings: fakeGithub({
      repo: options.repo,
      admin: false,
      rulesets: [statusCheckRuleset(1, "main-checks", options.required ?? [])],
    }),
    objects,
    refs: new Map([["main", seedCommit(objects, options.files)]]),
    pulls: [],
    looks: new Map(),
    pendingLooks: 0,
  };
  const log: RecordedRequest[] = [];
  return {
    gh: (args, callOptions = {}) => {
      const flag = args.indexOf("-X");
      const request: RecordedRequest = {
        method: flag === -1 ? "GET" : String(args[flag + 1]).toUpperCase(),
        path: args.find(arg => arg.startsWith("repos/")) ?? "",
        ...(callOptions.input === undefined
          ? {}
          : { body: JSON.parse(callOptions.input) as unknown }),
      };
      log.push(request);
      options.onRequest?.(request);
      return answer(state, request);
    },
    log,
    branches: () => [...state.refs.keys()],
    pulls: () => state.pulls,
    head: branch => state.refs.get(branch),
    filesAt: sha => filesAt(objects, sha),
    modesAt: sha => modesAt(objects, sha),
    get pendingLooks() {
      return state.pendingLooks;
    },
    set pendingLooks(looks: number) {
      state.pendingLooks = looks;
    },
  };
}

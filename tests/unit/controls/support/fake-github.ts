/**
 * A stand-in for the hosting platform's API that lives in memory and records
 * every request it is sent (CodySwannGT/lisa#4993).
 *
 * `lisa controls protect` changes a repository's merge protection, so no suite
 * may ever reach a real platform. Each suite hands the command this object's
 * `gh` function in place of the real one. It answers the reads the command
 * makes, accepts or refuses the writes the way the platform would, and keeps
 * a log of every request in the order it arrived, so a case can assert not
 * only what the command concluded but exactly what it sent.
 * @module tests/unit/controls/support/fake-github
 */

/** What one call of the `gh` function answers. */
export interface FakeGhResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** One request the fake received. */
export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  /** The parsed request body, for a write. */
  readonly body?: unknown;
}

/** A ruleset as the platform holds it. */
export type FakeRuleset = Readonly<Record<string, unknown>> & {
  readonly id: number;
  readonly name: string;
};

/** How the stand-in platform is set up. */
export interface FakeGithubOptions {
  /** `owner/name` of the only repository that exists. */
  readonly repo: string;
  /**
   * Whether the signed-in account administers the repository. `null` leaves
   * the permission block out of the answer, as an anonymous read does.
   */
  readonly admin: boolean | null;
  readonly defaultBranch?: string;
  readonly rulesets?: readonly FakeRuleset[];
  /** Check names the platform accepts in a write and then does not keep. */
  readonly forgets?: readonly string[];
  /** Make every read fail with this text. */
  readonly readFailure?: string;
  /** Make every write fail with this text, whatever the permission. */
  readonly writeFailure?: string;
}

/** The stand-in platform. */
export interface FakeGithub {
  /** The request function to hand the command. */
  readonly gh: (
    args: readonly string[],
    options?: { readonly input?: string }
  ) => FakeGhResult;
  /** Every request received, in order. */
  readonly log: readonly RecordedRequest[];
  /** The requests that would change something. */
  readonly writes: () => readonly RecordedRequest[];
  /** The rulesets the platform holds now. */
  readonly rulesets: () => readonly FakeRuleset[];
}

/** The id GitHub gives its own Actions app. */
export const ACTIONS_APP_ID = 15_368;

/**
 * A ruleset that requires status checks on the default branch.
 * @param id - The ruleset's id
 * @param name - The ruleset's name
 * @param contexts - The check names it requires
 * @param overrides - Fields to replace, for example `enforcement`
 * @returns The ruleset
 */
export function statusCheckRuleset(
  id: number,
  name: string,
  contexts: readonly string[],
  overrides: Readonly<Record<string, unknown>> = {}
): FakeRuleset {
  return {
    id,
    name,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    bypass_actors: [],
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          do_not_enforce_on_create: true,
          required_status_checks: contexts.map(context => ({
            context,
            integration_id: ACTIONS_APP_ID,
          })),
        },
      },
    ],
    ...overrides,
  };
}

/**
 * Read the method of a `gh api` call from its arguments.
 * @param args - The arguments after `gh`
 * @returns The HTTP method
 */
function methodOf(args: readonly string[]): string {
  const flag = args.indexOf("-X");
  if (flag !== -1) return String(args[flag + 1]).toUpperCase();
  return args.includes("--input") ? "POST" : "GET";
}

/**
 * Drop the check names the platform is set up to forget.
 * @param ruleset - The ruleset a write carried
 * @param forgets - Check names to lose
 * @returns The ruleset as the platform keeps it
 */
function withoutForgotten(
  ruleset: Readonly<Record<string, unknown>>,
  forgets: readonly string[]
): Readonly<Record<string, unknown>> {
  const rules = (ruleset.rules ?? []) as readonly Record<string, unknown>[];
  return {
    ...ruleset,
    rules: rules.map(rule => {
      if (rule.type !== "required_status_checks") return rule;
      const parameters = rule.parameters as Record<string, unknown>;
      const checks = parameters.required_status_checks as readonly {
        readonly context: string;
      }[];
      return {
        ...rule,
        parameters: {
          ...parameters,
          required_status_checks: checks.filter(
            check => !forgets.includes(check.context)
          ),
        },
      };
    }),
  };
}

/**
 * Answer successfully with a JSON document.
 * @param value - The document
 * @returns The result
 */
function answer(value: unknown): FakeGhResult {
  return { ok: true, stdout: JSON.stringify(value), stderr: "" };
}

/**
 * Answer the way `gh` reports a refused request.
 * @param message - The platform's message
 * @param status - The HTTP status
 * @returns The result
 */
function refusal(message: string, status: number): FakeGhResult {
  return {
    ok: false,
    stdout: JSON.stringify({ message }),
    stderr: `gh: ${message} (HTTP ${String(status)})`,
  };
}

/** The rulesets the platform holds, replaced as a whole on each write. */
interface PlatformState {
  rulesets: readonly FakeRuleset[];
}

/**
 * Answer one read.
 * @param options - How the platform is set up
 * @param state - What the platform holds
 * @param path - The API path
 * @returns The answer
 */
function read(
  options: FakeGithubOptions,
  state: PlatformState,
  path: string
): FakeGhResult {
  const base = `repos/${options.repo}`;
  if (options.readFailure !== undefined) {
    return refusal(options.readFailure, 404);
  }
  if (path === base) {
    return answer({
      full_name: options.repo,
      default_branch: options.defaultBranch ?? "main",
      ...(options.admin === null
        ? {}
        : { permissions: { admin: options.admin, push: true, pull: true } }),
    });
  }
  if (path === `${base}/rulesets`) {
    return answer(
      state.rulesets.map(({ id, name, target, enforcement }) => ({
        id,
        name,
        target,
        enforcement,
      }))
    );
  }
  const held = state.rulesets.find(
    ruleset => path === `${base}/rulesets/${String(ruleset.id)}`
  );
  return held === undefined ? refusal("Not Found", 404) : answer(held);
}

/**
 * Answer one write, changing what the platform holds when it is accepted.
 * @param options - How the platform is set up
 * @param state - What the platform holds
 * @param request - The write
 * @returns The answer
 */
function write(
  options: FakeGithubOptions,
  state: PlatformState,
  request: RecordedRequest
): FakeGhResult {
  const base = `repos/${options.repo}`;
  if (options.writeFailure !== undefined) {
    return refusal(options.writeFailure, 422);
  }
  if (options.admin !== true) {
    return refusal("Must have admin rights to Repository.", 403);
  }
  const kept = withoutForgotten(
    request.body as Record<string, unknown>,
    options.forgets ?? []
  );
  if (request.method === "POST" && request.path === `${base}/rulesets`) {
    const id = Math.max(0, ...state.rulesets.map(held => held.id)) + 1;
    const created = { ...kept, id } as FakeRuleset;
    state.rulesets = [...state.rulesets, created];
    return answer(created);
  }
  const existing = state.rulesets.find(
    ruleset => request.path === `${base}/rulesets/${String(ruleset.id)}`
  );
  if (request.method !== "PUT" || existing === undefined) {
    return refusal("Not Found", 404);
  }
  const updated = { ...kept, id: existing.id } as FakeRuleset;
  state.rulesets = state.rulesets.map(held =>
    held.id === existing.id ? updated : held
  );
  return answer(updated);
}

/**
 * Build a stand-in platform holding one repository.
 * @param options - How it is set up
 * @returns The platform and its request log
 */
export function fakeGithub(options: FakeGithubOptions): FakeGithub {
  const log: RecordedRequest[] = [];
  const state: PlatformState = { rulesets: [...(options.rulesets ?? [])] };
  return {
    gh: (args, callOptions = {}) => {
      const method = methodOf(args);
      const path = args.find(arg => arg.startsWith("repos/")) ?? "";
      const request: RecordedRequest =
        callOptions.input === undefined
          ? { method, path }
          : { method, path, body: JSON.parse(callOptions.input) as unknown };
      log.push(request);
      return method === "GET"
        ? read(options, state, path)
        : write(options, state, request);
    },
    log,
    writes: () => log.filter(request => request.method !== "GET"),
    rulesets: () => state.rulesets,
  };
}

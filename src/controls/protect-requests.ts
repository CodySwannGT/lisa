/**
 * The one door every request of `lisa controls protect` goes through.
 *
 * The command must be able to say exactly what it sent, and a run that was
 * not allowed to change anything must be unable to. Both come from here: every
 * call to the hosting platform passes through this wrapper, which records it
 * and, until writing has been allowed, refuses to pass on anything that is not
 * a read. A run without `--apply`, or one whose permission probe did not say
 * yes, therefore cannot send a write even if a later step asked for one.
 * @module controls/protect-requests
 */
import {
  rulesetReaderOver,
  type HealthRuleset,
} from "../health/ruleset-inspection.js";
import type { GhResult, GhRunner } from "./protect-modules.js";
import type { SentRequest } from "./protect-types.js";

/** How long one read-back may take. The runner enforces its own limit too. */
const READ_BACK_TIMEOUT_MS = 15_000;

/** `gh api` flags that carry a request body, which makes the call a write. */
const BODY_FLAGS: ReadonlySet<string> = new Set([
  "--input",
  "-f",
  "-F",
  "--field",
  "--raw-field",
]);

/** The recorded requests of one run, and the two ways to make one. */
export interface RequestLog {
  /** Sends reads; refuses everything else without sending it. */
  readonly read: GhRunner;
  /** Sends anything. Hand this out only once a write has been allowed. */
  readonly write: GhRunner;
  /** Every request so far, in order. */
  readonly requests: () => readonly SentRequest[];
}

/**
 * Read the HTTP method of a `gh api` call from its arguments.
 * @param args - The arguments after `gh`
 * @returns The method, in upper case
 */
export function requestMethod(args: readonly string[]): string {
  const flag = args.findIndex(arg => arg === "-X" || arg === "--method");
  if (flag !== -1) return String(args[flag + 1] ?? "").toUpperCase();
  return args.some(arg => BODY_FLAGS.has(arg)) ? "POST" : "GET";
}

/**
 * Read the API path of a `gh api` call from its arguments.
 * @param args - The arguments after `gh`
 * @returns The path, or the arguments joined when none is recognisable
 */
function requestPath(args: readonly string[]): string {
  return args.find(arg => arg.startsWith("repos/")) ?? args.join(" ");
}

/**
 * Wrap a `gh` runner so every call is recorded and a write needs permission.
 * @param gh - The runner that really sends requests
 * @returns The recording runners and what they recorded
 */
export function recordRequests(gh: GhRunner): RequestLog {
  const log: { current: readonly SentRequest[] } = { current: [] };
  const record = (request: SentRequest): void => {
    log.current = [...log.current, request];
  };
  const send = (
    args: readonly string[],
    options: { readonly input?: string } | undefined,
    mayWrite: boolean
  ): GhResult => {
    const method = requestMethod(args);
    const path = requestPath(args);
    if (method !== "GET" && !mayWrite) {
      record({ method, path, sent: false });
      return {
        ok: false,
        stdout: "",
        stderr: `Not sent: this run may only read, and ${method} ${path} would change a setting.`,
      };
    }
    record({ method, path, sent: true });
    return gh(args, options);
  };
  return {
    read: (args, options) => send(args, options, false),
    write: (args, options) => send(args, options, true),
    requests: () => log.current,
  };
}

/**
 * Read a repository's rulesets back through a recording runner.
 *
 * The walk is `lisa health`'s ruleset reader; only the function that makes
 * each request is this run's own, so the read-back appears in the request log
 * like everything else.
 * @param gh - A runner that only reads
 * @param repository - `owner/name`
 * @param root - Real path of the repository
 * @returns The live rulesets, or the reason they could not be read
 */
export async function readRulesetsBack(
  gh: GhRunner,
  repository: string,
  root: string
): Promise<
  | { readonly ok: true; readonly rulesets: readonly HealthRuleset[] }
  | { readonly ok: false; readonly reason: string }
> {
  const [owner = "", name = ""] = repository.split("/");
  const reader = rulesetReaderOver(argv => {
    const answered = gh(argv);
    if (!answered.ok) {
      return Promise.reject(
        new Error(`${answered.stdout}\n${answered.stderr}`.trim())
      );
    }
    return Promise.resolve(JSON.parse(answered.stdout) as unknown);
  });
  try {
    return {
      ok: true,
      rulesets: await reader(
        owner,
        name,
        root,
        READ_BACK_TIMEOUT_MS,
        new AbortController().signal
      ),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * What the in-memory hosting platform holds, and the few things every one of
 * its answers is built from (CodySwannGT/lisa#4997).
 *
 * The platform itself is put together in `./fake-canary-platform.ts`; its
 * reads are in `./fake-canary-reads.ts` and its writes in
 * `./fake-canary-writes.ts`.
 * @module tests/unit/controls/support/fake-canary-state
 */
import { VIOLATION_MARK } from "../../../helpers/control-proofs.js";
import type {
  FakeGhResult,
  FakeGithub,
  RecordedRequest,
} from "./fake-github.js";
import { filesAt, type GitObjects } from "./fake-git-objects.js";

/** A pull request as the platform holds it. */
export interface FakePull {
  readonly number: number;
  readonly head: string;
  readonly base: string;
  readonly sha: string;
  readonly draft: boolean;
  readonly title: string;
  readonly body: string;
  state: "open" | "closed";
  merged: boolean;
}

/** How the stand-in platform is set up. */
export interface FakeCanaryOptions {
  /** `owner/name` of the only repository that exists. */
  readonly repo: string;
  /** Whether the account may write; `null` leaves the answer out. Default true. */
  readonly push?: boolean | null;
  /** The checks the default branch requires. */
  readonly required?: readonly string[];
  /** The files of the default branch's head, by path. */
  readonly files: Readonly<Record<string, string>>;
  /**
   * What each check concludes on a commit, from the files it holds. By
   * default every required check fails on a planted violation and passes
   * otherwise.
   */
  readonly conclude?: (
    files: ReadonlyMap<string, string>
  ) => Readonly<Record<string, string | null>>;
  /** Whether the repository is offered draft pull requests. Default true. */
  readonly drafts?: boolean;
  /**
   * Take a request for a draft pull request and open an ordinary one all
   * the same, saying so in the answer.
   */
  readonly draftsBecomeOrdinary?: boolean;
  /**
   * Merge every pull request into its base branch the first time it is
   * read, which moves that branch: something on the platform that merges
   * pull requests by itself. The command asked for none of it.
   */
  readonly mergedByTheHost?: boolean;
  /**
   * The app every check run is reported by. By default the one the required
   * checks are pinned to, so a case about anything else need not say.
   */
  readonly reportedBy?: number;
  /**
   * Answer a list of pull requests with every open one, whatever head was
   * asked for: a platform that ignored the filter.
   */
  readonly ignoresHeadFilter?: boolean;
  /** Called with each request before it is answered; may throw. */
  readonly onRequest?: (request: RecordedRequest) => void;
  /** Refuse a request: return the platform's message, or nothing to allow. */
  readonly refuse?: (request: RecordedRequest) => string | undefined;
}

/** What the platform holds. */
export interface State {
  readonly options: FakeCanaryOptions;
  /** The merge-protection settings, answered by the protect stand-in. */
  readonly settings: FakeGithub;
  readonly objects: GitObjects;
  readonly refs: Map<string, string>;
  readonly pulls: FakePull[];
  /** How often each commit's checks were looked at. */
  readonly looks: Map<string, number>;
  pendingLooks: number;
}

/** One request, taken apart. */
export interface Call {
  readonly method: string;
  /** The path under the repository, without its query. */
  readonly resource: string;
  readonly query: string;
  readonly body: Readonly<Record<string, unknown>>;
}

/** Answers a request it recognises; `undefined` leaves it to the next. */
export type Route = (state: State, call: Call) => FakeGhResult | undefined;

/**
 * Answer successfully.
 * @param value - The document, or nothing for an empty answer
 * @returns The result
 */
export function ok(value?: unknown): FakeGhResult {
  return {
    ok: true,
    stdout: value === undefined ? "" : JSON.stringify(value),
    stderr: "",
  };
}

/**
 * Answer the way `gh` reports a refused request.
 * @param message - The platform's message
 * @param status - The HTTP status
 * @returns The result
 */
export function refused(message: string, status: number): FakeGhResult {
  return {
    ok: false,
    stdout: JSON.stringify({ message }),
    stderr: `gh: ${message} (HTTP ${String(status)})`,
  };
}

/** The answer to a path the platform does not have. */
export const NOT_FOUND = refused("Not Found", 404);

/**
 * What each check concluded on a commit.
 * @param state - What the platform holds
 * @param sha - The commit
 * @returns Each check's conclusion by its name
 */
export function conclusions(
  state: State,
  sha: string
): Readonly<Record<string, string | null>> {
  const files = filesAt(state.objects, sha);
  if (state.options.conclude !== undefined) {
    return state.options.conclude(files);
  }
  const planted = [...files.values()].some(text =>
    text.includes(VIOLATION_MARK)
  );
  return Object.fromEntries(
    (state.options.required ?? []).map(name => [
      name,
      planted ? "failure" : "success",
    ])
  );
}

/**
 * A pull request as the platform returns it.
 * @param state - What the platform holds
 * @param pull - The pull request
 * @returns The document
 */
export function pullDocument(
  state: State,
  pull: FakePull
): Record<string, unknown> {
  const passed = Object.values(conclusions(state, pull.sha)).every(
    result => result === "success"
  );
  const undrafted = passed ? "clean" : "blocked";
  return {
    number: pull.number,
    state: pull.state,
    draft: pull.draft,
    merged: pull.merged,
    title: pull.title,
    mergeable: true,
    mergeable_state: pull.draft ? "draft" : undrafted,
    head: { ref: pull.head, sha: pull.sha },
    base: { ref: pull.base },
  };
}

/**
 * Find the pull request a path names.
 * @param state - What the platform holds
 * @param resource - The path under the repository
 * @returns The pull request, when the path names one that exists
 */
export function pullAt(state: State, resource: string): FakePull | undefined {
  const number = /^pulls\/(\d+)(?:\/|$)/u.exec(resource)?.[1];
  return state.pulls.find(held => held.number === Number(number));
}

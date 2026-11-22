/**
 * The writes the in-memory hosting platform accepts
 * (CodySwannGT/lisa#4997).
 *
 * It accepts more than `lisa controls attest` may ever send. In particular
 * it will accept a pull request into its base branch, which moves that
 * branch — the one thing the command must never ask for. A stand-in that
 * could not be merged into would let a test of "never merges" pass for the
 * wrong reason.
 * @module tests/unit/controls/support/fake-canary-writes
 */
import {
  ok,
  pullAt,
  pullDocument,
  refused,
  type Call,
  type FakePull,
  type Route,
  type State,
} from "./fake-canary-state.js";
import type { FakeGhResult } from "./fake-github.js";
import {
  addBlob,
  addCommit,
  addTree,
  type TreeChange,
} from "./fake-git-objects.js";

/** What a route answers: nothing when the request is not its own. */
type Answer = FakeGhResult | undefined;

/**
 * Refuse every write from an account that may not write.
 * @param state - What the platform holds
 * @returns The refusal, or nothing when the account may write
 */
function needsWriteAccess(state: State): Answer {
  return state.options.push === true || state.options.push === undefined
    ? undefined
    : refused("Resource not accessible", 403);
}

/**
 * Store a file, a tree or a commit.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the request is not this one
 */
function writeObject(state: State, call: Call): Answer {
  const { objects } = state;
  const { body } = call;
  if (call.method !== "POST") return undefined;
  if (call.resource === "git/blobs") {
    return ok({ sha: addBlob(objects, String(body.content)) });
  }
  if (call.resource === "git/trees") {
    return ok({
      sha: addTree(
        objects,
        body.base_tree as string | undefined,
        body.tree as readonly TreeChange[]
      ),
    });
  }
  return call.resource === "git/commits"
    ? ok({
        sha: addCommit(objects, {
          tree: String(body.tree),
          parents: body.parents as readonly string[],
          message: String(body.message),
        }),
      })
    : undefined;
}

/**
 * Create a branch.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the request is not this one
 */
function createRef(state: State, call: Call): Answer {
  if (call.method !== "POST" || call.resource !== "git/refs") return undefined;
  const name = String(call.body.ref).replace(/^refs\/heads\//u, "");
  if (state.refs.has(name)) return refused("Reference already exists", 422);
  state.refs.set(name, String(call.body.sha));
  return ok({ ref: call.body.ref, object: { sha: call.body.sha } });
}

/**
 * Delete a branch, which closes the pull requests opened from it.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the request is not this one
 */
function deleteRef(state: State, call: Call): Answer {
  const name = /^git\/refs\/heads\/(.+)$/u.exec(call.resource)?.[1];
  if (call.method !== "DELETE" || name === undefined) return undefined;
  if (!state.refs.delete(name)) return refused("Reference does not exist", 422);
  state.pulls
    .filter(pull => pull.head === name)
    .forEach(pull => {
      pull.state = "closed";
    });
  return ok();
}

/**
 * Open a pull request.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the request is not this one
 */
function openPull(state: State, call: Call): Answer {
  const { body } = call;
  if (call.method !== "POST" || call.resource !== "pulls") return undefined;
  if (body.draft === true && state.options.drafts === false) {
    return refused(
      "Draft pull requests are not supported in this repository.",
      422
    );
  }
  const pull: FakePull = {
    number: state.pulls.length + 1,
    head: String(body.head),
    base: String(body.base),
    sha: state.refs.get(String(body.head)) ?? "",
    draft: body.draft === true && state.options.draftsBecomeOrdinary !== true,
    title: String(body.title),
    body: String(body.body),
    state: "open",
    merged: false,
  };
  state.pulls.push(pull);
  return ok(pullDocument(state, pull));
}

/**
 * Accept a pull request into its base branch, which moves that branch. The
 * command must never ask for this.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the request is not this one
 */
function acceptPull(state: State, call: Call): Answer {
  const pull = pullAt(state, call.resource);
  const asked = call.method === "PUT" && call.resource.endsWith("/merge");
  if (!asked || pull === undefined) return undefined;
  state.refs.set(pull.base, pull.sha);
  pull.state = "closed";
  pull.merged = true;
  return ok({ merged: true });
}

/**
 * Close a pull request.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the request is not this one
 */
function changePull(state: State, call: Call): Answer {
  const pull = pullAt(state, call.resource);
  const asked = call.method === "PATCH" && /^pulls\/\d+$/u.test(call.resource);
  if (!asked || pull === undefined) return undefined;
  if (call.body.state === "closed") pull.state = "closed";
  return ok(pullDocument(state, pull));
}

/** Every write, in the order they are tried. */
export const WRITES: readonly Route[] = [
  needsWriteAccess,
  writeObject,
  createRef,
  deleteRef,
  openPull,
  acceptPull,
  changePull,
];

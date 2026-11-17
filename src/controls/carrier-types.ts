/**
 * The shape of what `lisa controls install-carriers` installs and reports.
 *
 * A carrier is the small piece that calls the gate runner at a moment: a git
 * hook at commit and at push. In a repository on a supported project type the
 * stack's own hooks are the carriers. In any other repository nothing calls
 * the runner, so the declared checks never run; this command installs the
 * carriers there.
 *
 * ## Adding a kind of carrier
 *
 * Every carrier is reported as one enforcement point: a `kind`, the
 * `location` and `moment` the control register uses for the same point, and
 * an outcome. A new kind (a coding agent's edit-time hook, for example) adds
 * a value to {@link CARRIER_KINDS}, a module that plans its points, and one
 * entry in the list `./carriers.ts` runs. Nothing existing has to move.
 * @module controls/carrier-types
 */
import type { EnforcementLocation } from "./register-types.js";

/** The format version of the result document and of the record. */
export const CARRIER_SCHEMA_VERSION = 1;

/** The moments a git hook carries, in the order a change reaches them. */
export const CARRIER_MOMENTS = ["commit", "push"] as const;

/** One moment a git hook carries. */
export type CarrierMoment = (typeof CARRIER_MOMENTS)[number];

/** The git hook that runs at each moment. */
export const CARRIER_HOOKS: Readonly<Record<CarrierMoment, string>> = {
  commit: "pre-commit",
  push: "pre-push",
};

/** Where a git hook enforces a rule, as the control register names it. */
export const GIT_HOOK_LOCATION: EnforcementLocation = "local-checkout";

/** The kinds of carrier this command installs. */
export const CARRIER_KINDS = ["git-hook"] as const;

/** One kind of carrier. */
export type CarrierKind = (typeof CARRIER_KINDS)[number];

/** The folder Lisa's own hook scripts live in, from the repository root. */
export const CARRIER_HOOKS_FOLDER = ".lisa/hooks";

/**
 * The folder the gate runner is placed in, from the repository root.
 *
 * The same folder `lisa apply` copies it to, so a repository that later
 * adopts a Lisa project type has one copy of the runner, not two.
 */
export const CARRIER_RUNNER_FOLDER = "scripts";

/** The runner's file name, in the Lisa package and in the repository. */
export const CARRIER_RUNNER_FILE = "lisa-run-gates.mjs";

/** The runner the carriers start, from the repository root. */
export const CARRIER_RUNNER_PATH = `${CARRIER_RUNNER_FOLDER}/${CARRIER_RUNNER_FILE}`;

/** The record of what this command wrote, from the repository root. */
export const CARRIER_RECORD_PATH = ".lisa/controls/carriers.json";

/** The command a person runs, as it is written in messages and files. */
export const INSTALL_CARRIERS_INVOCATION = "lisa controls install-carriers";

/** What became of one enforcement point. */
export const CARRIER_OUTCOMES = [
  "installed",
  "already-wired",
  "updated",
  "blocked",
] as const;

/** The outcome of one enforcement point, or of the whole run. */
export type CarrierOutcome = (typeof CARRIER_OUTCOMES)[number];

/**
 * Who owns git hooks in a repository, in the order the evidence is weighed.
 *
 * - `hooks-path`: `core.hooksPath` names a folder of the repository's own.
 * - `husky`, `lefthook`, `pre-commit`: that hook manager is set up.
 * - `git-hooks`: hooks written by hand in git's own hooks folder.
 * - `lisa`: `core.hooksPath` already names Lisa's hook folder.
 * - `none`: nothing runs at any hook.
 */
export const HOOK_OWNERS = [
  "hooks-path",
  "husky",
  "lefthook",
  "pre-commit",
  "git-hooks",
  "lisa",
  "none",
] as const;

/** The owner of git hooks in one repository. */
export type HookOwner = (typeof HOOK_OWNERS)[number];

/** A hook a Lisa project type ships, which already calls the runner. */
export const STACK_HOOK = "lisa-stack-hook";

/** What calls the carrier at an enforcement point. */
export type WiredThrough = HookOwner | typeof STACK_HOOK;

/** One enforcement point and what became of it. */
export interface CarrierPoint {
  /** The kind of carrier. */
  readonly kind: CarrierKind;
  /** Where it enforces, as the control register's enforcement points say. */
  readonly location: EnforcementLocation;
  /** The moment it carries, as the control register's points say. */
  readonly moment: CarrierMoment;
  /** The git hook that runs at that moment. */
  readonly hook: string;
  /** What became of it. */
  readonly outcome: CarrierOutcome;
  /** Why it is blocked, in a sentence; `null` for every other outcome. */
  readonly reason: string | null;
  /** What calls the carrier. */
  readonly wired_through: WiredThrough;
  /** The file or setting that holds the call; `null` when there is none. */
  readonly path: string | null;
}

/** What became of the runner's files. */
export type RunnerOutcome = CarrierOutcome | "not-needed";

/** The gate runner the carriers start. */
export interface CarrierRunner {
  /** The runner's entry file, from the repository root. */
  readonly path: string;
  /** Every file placed for it, from the repository root, in order. */
  readonly files: readonly string[];
  /** What became of those files. */
  readonly outcome: RunnerOutcome;
  /** Why they are blocked; `null` for every other outcome. */
  readonly reason: string | null;
}

/** One thing this run wrote, or would write under `--check`. */
export interface CarrierChange {
  /** The file, from the repository root where it is inside; or the setting. */
  readonly path: string;
  /** `create` or `update` for a file, `set` for a git setting. */
  readonly action: "create" | "update" | "set";
}

/** What every checkout of the repository needs, beyond the committed files. */
export interface CarrierCloneSetup {
  /** The command a teammate runs once in a new checkout. */
  readonly command: string;
  /** The command that says whether a checkout is wired; it writes nothing. */
  readonly check: string;
  /** Why a new checkout needs it. */
  readonly why: string;
}

/** The result of one run, printed as one JSON document. */
export interface CarrierResult {
  readonly schema_version: typeof CARRIER_SCHEMA_VERSION;
  /** `check` when nothing may be written. */
  readonly mode: "install" | "check";
  /** The worst outcome of any enforcement point. */
  readonly outcome: CarrierOutcome;
  /** The outcome in one sentence. */
  readonly reason: string;
  /** Who owns git hooks in this checkout. */
  readonly hook_owner: HookOwner;
  /** One entry per enforcement point, commit before push. */
  readonly enforcement_points: readonly CarrierPoint[];
  /** The gate runner. */
  readonly runner: CarrierRunner;
  /** Everything written, or under `--check` everything that would be. */
  readonly changes: readonly CarrierChange[];
  /** The record of what this command wrote. */
  readonly record: string;
  /** What a teammate runs in a new checkout. */
  readonly each_checkout: CarrierCloneSetup;
}

/** A file to write. */
export interface FileEdit {
  readonly kind: "file";
  /** How the file is named to a person. */
  readonly path: string;
  /** Where it is on disk. */
  readonly absolute: string;
  /** What it will hold. */
  readonly content: string | Buffer;
  /** Whether git must be able to start it. */
  readonly executable: boolean;
  /** Whether the file is new. */
  readonly action: "create" | "update";
}

/** A git setting to write in this checkout. */
export interface SettingEdit {
  readonly kind: "setting";
  /** The setting's name. */
  readonly path: string;
  /** The value to give it. */
  readonly value: string;
  readonly action: "set";
}

/** One write this run makes. */
export type CarrierEdit = FileEdit | SettingEdit;

/**
 * How the call to the carrier stands at one enforcement point.
 *
 * - `present`: it was already there and is right.
 * - `added`: this run writes it.
 * - `replaced`: it was there and this run rewrites it.
 * - `absent`: it is not there and this run does not write it.
 */
export type CallState = "present" | "added" | "replaced" | "absent";

/** The plan for one enforcement point, before anything is written. */
export interface PointPlan {
  readonly moment: CarrierMoment;
  /** What calls the carrier. */
  readonly through: WiredThrough;
  /** The file or setting that holds the call. */
  readonly path: string | null;
  /** How the call stands. */
  readonly call: CallState;
  /** Why the point is blocked, or `null`. */
  readonly blocked: string | null;
}

/** A whole file this command places in the repository and may replace. */
export interface PlacedFile {
  /** Where it goes, from the repository root, with `/` separators. */
  readonly path: string;
  /** What it holds. */
  readonly content: string | Buffer;
  /** Whether git must be able to start it. */
  readonly executable: boolean;
}

/** The plan for every point of one kind of carrier. */
export interface KindPlan {
  /** The kind of carrier the points are. */
  readonly kind: CarrierKind;
  /** Who owns the hooks. */
  readonly owner: HookOwner;
  /** One plan per moment. */
  readonly points: readonly PointPlan[];
  /** The carrier scripts the calls start, placed when any call is. */
  readonly scripts: readonly PlacedFile[];
  /** The writes that put the calls in place. */
  readonly edits: readonly CarrierEdit[];
}

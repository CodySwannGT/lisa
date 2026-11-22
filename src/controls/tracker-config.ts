/**
 * Which tracker a repository files its tickets in, if any.
 *
 * Read the way the vendor-neutral ticket writer reads it, so this code and the
 * writer cannot disagree: `tracker` from `.lisa.config.local.json` when that
 * file names one, otherwise from `.lisa.config.json`. A file that is absent,
 * or that cannot be read as JSON, names nothing.
 *
 * A repository with no usable tracker is not an error here. It is a fact the
 * caller reports: nothing can be filed, and why.
 * @module controls/tracker-config
 */
import { readProjectJsonObject } from "../health/read-only-fs.js";

/** The committed configuration file. */
const CONFIG_FILE = ".lisa.config.json";

/** The uncommitted file whose keys win over the committed one. */
const LOCAL_CONFIG_FILE = ".lisa.config.local.json";

/** The trackers Lisa can file a ticket in. */
export const SUPPORTED_TRACKERS = ["jira", "github", "linear"] as const;

/** One tracker Lisa can file in. */
type SupportedTracker = (typeof SUPPORTED_TRACKERS)[number];

/** Whether tickets can be filed, and when they cannot, why not. */
export type ConfiguredTracker =
  | {
      readonly configured: true;
      readonly name: SupportedTracker;
      readonly problem: null;
    }
  | {
      readonly configured: false;
      readonly name: null;
      /** What is wrong and what to do about it, in plain words. */
      readonly problem: string;
    };

/** What one configuration file says about the tracker. */
interface TrackerSetting {
  readonly file: string;
  /** Whether the file is there but could not be read as a JSON object. */
  readonly unreadable: boolean;
  /** The `tracker` value as text, or `null` when the file names none. */
  readonly value: string | null;
}

/**
 * Write a declared `tracker` value as the text an operator would recognise.
 * @param value - The raw value of the `tracker` key
 * @returns The value as text, or `null` when the key names nothing
 */
function trackerText(value: unknown): string | null {
  if (value === undefined || value === null || value === false) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text === "" ? null : text;
}

/**
 * Read what one configuration file says about the tracker.
 * @param root - Real path of the repository
 * @param file - Repository-relative configuration file
 * @returns The setting; a missing or unreadable file names no tracker
 */
async function readSetting(
  root: string,
  file: string
): Promise<TrackerSetting> {
  try {
    const config = await readProjectJsonObject(root, file);
    return { file, unreadable: false, value: trackerText(config?.tracker) };
  } catch {
    return { file, unreadable: true, value: null };
  }
}

/**
 * Tell whether a name is a tracker Lisa can file in.
 * @param name - The declared tracker
 * @returns Whether it is on the supported list
 */
function isSupported(name: string): name is SupportedTracker {
  return SUPPORTED_TRACKERS.some(supported => supported === name);
}

/** How every problem ends: what the operator does once it is fixed. */
const THEN = "then run the enforce step again.";

/**
 * Say why no ticket can be filed.
 * @param declared - The setting that names a tracker, when one does
 * @param unreadable - The configuration files that could not be read
 * @returns One or two plain sentences
 */
function problemFor(
  declared: TrackerSetting | undefined,
  unreadable: readonly string[]
): string {
  if (declared !== undefined) {
    return `The tracker named in ${declared.file} is ${JSON.stringify(declared.value)}, which is not one Lisa can file in, so no ticket can be filed. Set it to jira, github or linear, ${THEN}`;
  }
  return unreadable.length === 0
    ? `No tracker is configured in ${CONFIG_FILE}, so no ticket can be filed. Run /lisa:setup:jira, /lisa:setup:github or /lisa:setup:linear, ${THEN}`
    : `${unreadable.join(" and ")} could not be read, so the tracker is not known and no ticket can be filed. Fix the file, ${THEN}`;
}

/**
 * Find the tracker a repository is configured to file tickets in.
 * @param root - Real path of the repository
 * @returns The tracker, or the reason there is none to file in
 */
export async function readConfiguredTracker(
  root: string
): Promise<ConfiguredTracker> {
  const settings = [
    await readSetting(root, LOCAL_CONFIG_FILE),
    await readSetting(root, CONFIG_FILE),
  ];
  const declared = settings.find(setting => setting.value !== null);
  const name = declared?.value ?? "";
  if (isSupported(name)) {
    return { configured: true, name, problem: null };
  }
  return {
    configured: false,
    name: null,
    problem: problemFor(
      declared,
      settings
        .filter(setting => setting.unreadable)
        .map(setting => setting.file)
    ),
  };
}

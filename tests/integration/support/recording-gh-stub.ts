/**
 * A `gh` stub that behaves like one shared `pr-assets` release.
 *
 * The Jira evidence script uploads every pull request's evidence into the same
 * release, so a stub that answers `exit 0` to `gh release upload` cannot tell a
 * collision from a success (CodySwannGT/lisa#4639). This one keeps a release
 * directory: an upload copies the file in under its base name — the name `gh`
 * itself gives the asset — refuses a same-named asset unless `--clobber` is
 * passed, and `gh release view … --json assets` lists exactly what is there.
 * Every `gh release upload` argument list is appended to a log, one line per
 * call, so a case can assert what was asked for and not only what resulted.
 *
 * `gh pr edit <n> --body <body>` saves the body, so a case can assert the
 * description that was posted.
 *
 * Set `LISA_GH_DROP` to an asset name to have the release silently lose it,
 * which is how a case proves the script checks the release after uploading.
 * @module tests/integration/support/recording-gh-stub
 */

import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeStub } from "./shell-guard-refusal-fixture.js";

const GH_BODY = `state="\${LISA_GH_STATE:?}"
mkdir -p "$state/release"
case "$1 $2" in
  "repo view") printf 'org/repo\\n' ;;
  "pr view") printf 'existing body\\n' ;;
  "pr edit") printf '%s' "$5" > "$state/pr-body" ;;
  "release upload")
    printf '%s ' "$@" >> "$state/uploads.log"; printf '\\n' >> "$state/uploads.log"
    name=$(basename "$4")
    case " $* " in *" --clobber "*) ;; *) [ -e "$state/release/$name" ] && exit 1 ;; esac
    [ "$name" = "\${LISA_GH_DROP:-}" ] || cp "$4" "$state/release/$name"
    ;;
  "release view")
    case " $* " in *" --json assets "*) ;; *) exit 1 ;; esac
    case " $* " in *" --jq .assets[].name "*) ;; *) exit 1 ;; esac
    ls "$state/release" ;;
esac
exit 0
`;

/**
 * Install the recording `gh` stub and create its release state directory.
 * @param binDir - Directory that will be prepended to PATH.
 * @param stateDir - Directory holding the release contents and upload log.
 */
export function writeRecordingGh(binDir: string, stateDir: string): void {
  mkdirSync(path.join(stateDir, "release"), { recursive: true });
  writeStub(binDir, "gh", GH_BODY);
}

/**
 * The asset names currently held by the stubbed release.
 * @param stateDir - The stub's state directory.
 * @returns Sorted asset names.
 */
export function releaseAssets(stateDir: string): readonly string[] {
  return [...readdirSync(path.join(stateDir, "release"))].sort((a, b) =>
    a.localeCompare(b)
  );
}

/**
 * The contents of one asset in the stubbed release.
 * @param stateDir - The stub's state directory.
 * @param name - Asset name.
 * @returns The asset's text.
 */
export function releaseAsset(stateDir: string, name: string): string {
  return readFileSync(path.join(stateDir, "release", name), "utf8");
}

/**
 * Every recorded `gh release upload` argument list, one entry per call.
 * @param stateDir - The stub's state directory.
 * @returns Recorded argument lines, in call order.
 */
export function recordedUploads(stateDir: string): readonly string[] {
  try {
    return readFileSync(path.join(stateDir, "uploads.log"), "utf8")
      .split("\n")
      .filter(line => line.trim() !== "");
  } catch {
    return [];
  }
}

/**
 * The pull request body the script last posted with `gh pr edit --body`.
 * @param stateDir - The stub's state directory.
 * @returns The posted body, or an empty string when nothing was posted.
 */
export function postedBody(stateDir: string): string {
  try {
    return readFileSync(path.join(stateDir, "pr-body"), "utf8");
  } catch {
    return "";
  }
}

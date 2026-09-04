/**
 * Config files whose **filename carries precedence**, and which existing
 * sibling filenames the one Lisa ships would outrank.
 *
 * The guards in `strategies/copy-overwrite` all ask "does the destination path
 * already exist?" That question is exactly right for the file Lisa writes and
 * blind to the file Lisa's *outranks*. A repository configuring knip as
 * `knip.ts` has no `knip.json`, so every one of those guards evaluates against
 * a path that does not exist, passes trivially, and the template is written as
 * a NEW file rather than as a replacement. knip then prefers `.json` over
 * `.ts`, and the repository's own configuration silently stops being read
 * (CodySwannGT/lisa#3501).
 *
 * Measured with knip 5.82.1, varying only which files exist:
 *
 * | present            | knip reports                             |
 * | ------------------ | ---------------------------------------- |
 * | `knip.ts` only     | the repository's real findings           |
 * | `knip.json` only   | `Refine entry pattern (no matches)`      |
 * | **both**           | identical to `knip.json` only            |
 *
 * So the protection that already exists is path-level and this defect is
 * precedence-level. Lisa is not overwriting the host's config; it is
 * **outranking** it.
 *
 * **This is a seed-population guard and must stay one.** See
 * {@link shadowedConfigSibling} for why applying it to Lisa's governance
 * templates would open the hole it exists to close.
 * @module core/config-shadowing
 */

/**
 * One tool whose configuration Lisa seeds, and the filenames the one Lisa
 * writes would outrank.
 */
interface ConfigFamily {
  /** The tool being configured, for the operator-facing note. */
  readonly tool: string;
  /**
   * The repo-relative path Lisa ships. Matched exactly rather than by
   * basename: a `knip.json` nested inside some package directory is not the
   * root config and does not participate in precedence.
   */
  readonly template: string;
  /**
   * Repo-relative paths that configure the same tool and LOSE to
   * {@link template} — the files Lisa's would shadow.
   *
   * The direction is the easy thing to get backwards, and backwards inverts
   * the guard. A spelling the tool ranks ABOVE Lisa's file does not belong
   * here: that file already wins, nothing is shadowed, and standing down for
   * it would withhold the seed for no reason.
   *
   * Only spellings the tool ACTUALLY RESOLVES belong here, read out of the
   * tool's own resolution order rather than assembled from plausible-looking
   * extensions. A filename the tool never reads is not configuration, so
   * writing beside it shadows nothing — and standing down for it would leave
   * the tool running on defaults while the note told the operator the project
   * "already configures" it, which is this module's own failure mode wearing
   * the fix's hat.
   */
  readonly shadows: readonly string[];
}

/**
 * The families this guard knows about.
 *
 * Deliberately one entry. knip is the reported defect, and the shape of the
 * table is what makes the next tool a one-line addition rather than a
 * redesign — but adding a tool changes that tool's behaviour, so each earns
 * its own change and its own evidence.
 *
 * Surveyed and deliberately EXCLUDED, so the omissions are decisions rather
 * than oversights:
 *
 * - `eslint.config.ts`, `vitest.config.ts`, `commitlint.config.cjs`,
 *   `sgconfig.yml` — governance templates. See {@link shadowedConfigSibling};
 *   excluding them is the whole safety argument, not an unfinished edge.
 * - `tsconfig.json` — no alternative spelling exists. TypeScript resolves one
 *   filename, so nothing can outrank it and there is no family to declare.
 * - `.prettierrc.json`, `.lintstagedrc.json` — seed templates whose tools DO
 *   have precedence orders, so they are candidates. Left out because neither
 *   has been observed shadowing anything, and a guard added on speculation
 *   changes real behaviour on the strength of a guess. They are the natural
 *   second entries once a report or a measurement exists.
 */
const CONFIG_FAMILIES: readonly ConfigFamily[] = [
  {
    tool: "knip",
    template: "knip.json",
    // Read out of the resolver, not out of the report or the docs. knip walks
    // `KNIP_CONFIG_LOCATIONS` in order and takes the FIRST spelling that
    // exists (`util/create-options.js`, knip 5.82.1), and `knip.json` heads
    // that list — so every spelling below it loses its settings the moment
    // Lisa's file lands beside it. Listed in knip's own order, which is also
    // precedence order, so a reader can diff this against the constant.
    //
    // The report proposed `knip.{ts,js,mjs,cjs}`, and `knip.mjs`/`knip.cjs`
    // are deliberately absent: neither is in `KNIP_CONFIG_LOCATIONS`, so knip
    // never reads them and a project holding one has no working knip config to
    // shadow. Standing down for those would withhold the seed, leave knip on
    // defaults, and print a note claiming the project configures knip in a
    // file knip ignores — sending the next operator down exactly the debugging
    // dead end that made this defect expensive.
    //
    // `package.json#knip` is a real knip config surface and is NOT a filename,
    // so it cannot be probed through this table's exists-predicate. It is also
    // a weaker version of the same defect — `create-options.js` merges it
    // UNDER the config file (`Object.assign({}, manifest.knip, fileConfig)`),
    // so a written `knip.json` overrides whichever keys the host set there
    // rather than replacing the file wholesale. Recorded here as a known
    // adjacent surface rather than silently unhandled; closing it needs a
    // content probe, which is its own change and its own evidence.
    shadows: [
      "knip.jsonc",
      ".knip.json",
      ".knip.jsonc",
      "knip.ts",
      "knip.js",
      "knip.config.ts",
      "knip.config.js",
    ],
  },
];

/**
 * Normalise a repo-relative path so Windows separators compare equal.
 * @param relativePath - Repo-relative path as the caller spelled it
 * @returns The same path with forward slashes
 */
function normalise(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

/**
 * The existing configuration file that Lisa's template would outrank, if any.
 *
 * **Callers must apply this only to the seed population** — templates a host
 * owns after Lisa seeds them — and never to templates that declare
 * `declaresReplacedEveryRun`. The asymmetry is the point, and inverting it
 * would be worse than the defect this closes:
 *
 * - For a **seed** template (`knip.json`), Lisa's copy is a starting point the
 *   host then owns. A host that has already written its own config in another
 *   spelling has done the thing the seed exists to bootstrap, so writing would
 *   destroy the answer by outranking it.
 * - For a **governance** template (`eslint.config.ts`), writing IS the point —
 *   the file is the guardrail. Standing down because a same-family file exists
 *   would let any host silently disable Lisa's enforcement by dropping in an
 *   `eslint.config.js`, and nothing would report it. That is #2374's
 *   undeliverable-fix incident re-entering through the door opened here. For
 *   those templates a same-family host file is a conflict to SURFACE, not a
 *   reason to stand down.
 * @param relativePath - Repo-relative destination path of the managed template
 * @param exists - Predicate answering whether a repo-relative path is present
 *   in the destination project
 * @returns The existing sibling the template would outrank, with the tool it
 *   configures, or undefined when nothing would be shadowed
 */
export async function shadowedConfigSibling(
  relativePath: string,
  exists: (candidateRelativePath: string) => Promise<boolean>
): Promise<{ readonly tool: string; readonly sibling: string } | undefined> {
  const normalised = normalise(relativePath);
  const family = CONFIG_FAMILIES.find(
    candidate => candidate.template === normalised
  );
  if (family === undefined) return undefined;

  for (const sibling of family.shadows) {
    if (await exists(sibling)) {
      return { sibling, tool: family.tool };
    }
  }
  return undefined;
}

/**
 * The operator-facing explanation for a template Lisa declined to write.
 *
 * Written for someone who did not know the file was coming: it names what was
 * not written, what already configures the tool, and why silence would have
 * been worse than the skip.
 * @param template - Repo-relative path Lisa would have written
 * @param tool - Tool whose configuration is at stake
 * @param sibling - Existing repo-relative config the template would outrank
 * @returns One line for the apply summary
 */
export function shadowedConfigNote(
  template: string,
  tool: string,
  sibling: string
): string {
  return (
    `${template}: not written — this project already configures ${tool} in ` +
    `${sibling}, which ${template} would outrank, silently replacing your ` +
    `settings with Lisa's defaults.`
  );
}

import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every lane that ships templates. Kept explicit rather than globbed so a new
 * lane has to be added here deliberately, with its headers checked.
 */
const LANES = [
  "all",
  "cdk",
  "expo",
  "harper-fabric",
  "nestjs",
  "npm-package",
  "phaser",
  "rails",
  "typescript",
] as const;

/**
 * The header each strategy's templates must carry, minus the comment prefix.
 *
 * These sentences are the file's OWNERSHIP CONTRACT, and getting them backwards
 * has a cost in both directions:
 *
 * - A `create-only` file that claims it will be overwritten deters durable,
 *   correct edits to a file the consuming repo owns. That is issue #2538: a fix
 *   closing a live vacuous green in a downstream `ci.yml` was declined for an
 *   hour because the header said it would revert. It would not have.
 * - A `copy-overwrite` file that reads as editable silently loses downstream
 *   hardening on the next sync — already observed on a hook.
 */
const HEADERS = {
  "create-only": [
    "Seeded by Lisa on first setup — this file is YOURS.",
    "Lisa will not overwrite it. (copy-overwrite assets ARE replaced each run.)",
  ],
  "copy-overwrite": [
    "This file is managed by Lisa and IS replaced on each `lisa` run.",
    "Do not edit directly — durable changes belong upstream in Lisa.",
  ],
} as const;

/**
 * Extensions whose files can carry a leading comment at all.
 *
 * The list is the boundary of what "no template may be silent" can fairly
 * demand: JSON, `.nvmrc`, and `.gitkeep` have nowhere to put a sentence.
 */
const COMMENTABLE = /\.(ya?ml|[cm]?js|tsx?|sh|rb)$/u;

/**
 * The only `copy-overwrite` file formats allowed to say nothing, each with the
 * reason it cannot.
 *
 * Enumerated, and asserted to be exhaustive, because a category boundary that
 * nobody has to write down is how #2549 happened: `COMMENTABLE` above quietly
 * excused every file it did not match, so a create-only workflow with no header
 * at all was invisible to the guard meant to govern it. Here the whole lane is
 * the population and this map is the whole exception list — a template in a
 * format that is not written down below fails, and someone has to decide
 * whether it gets a header or an entry.
 *
 * Note what is NOT here. `.prettierignore`, `.yamllint`, `.gitleaksignore.local`,
 * `Gemfile.lisa`, `pre-push.verify`, `.easignore.extra` and a `.md` all take a
 * comment and all carry the header, so none of them needs an excuse.
 */
const NO_COMMENT_SYNTAX: Record<string, string> = {
  ".json": "JSON has no comment syntax at all",
  ".versionrc": "a JSON body under a dotfile name",
  ".nvmrc": "a bare version string — nvm reads the whole file as the version",
  ".gitkeep": "must stay empty; content defeats the placeholder",
  ".keep": "must stay empty; content defeats the placeholder",
};

/**
 * Line-1 constructs that stop working if the header lands above them, so
 * finding one on line 2 means the header displaced it.
 */
const DISPLACED_BY_HEADER = /^(#!|#\s*frozen_string_literal\s*:)/u;

/** The two copy strategies whose headers this file governs. */
type Strategy = keyof typeof HEADERS;

/** The strategies, in the order the report lists them. */
const STRATEGIES = Object.keys(HEADERS) as Strategy[];

/**
 * The retired header. It asserted the `copy-overwrite` contract on BOTH lanes,
 * which is what made it false for half of them.
 */
const RETIRED = "changes will be overwritten on the next `lisa` run";

/**
 * Every file under one lane/strategy tree.
 * @param lane - Project-type lane.
 * @param strategy - Copy strategy directory.
 * @returns Absolute paths, or an empty list when the tree does not exist.
 */
const templateFiles = async (
  lane: string,
  strategy: Strategy
): Promise<string[]> => {
  const root = path.join(process.cwd(), lane, strategy);
  try {
    const entries = await readdir(root, {
      recursive: true,
      withFileTypes: true,
    });
    return entries
      .filter(entry => entry.isFile())
      .map(entry => path.join(entry.parentPath, entry.name));
  } catch {
    return [];
  }
};

/**
 * Files that carry SOME ownership header, paired with their contents.
 *
 * Absence is deliberately not an assertion here: many templates are JSON,
 * `.nvmrc`, or `.gitkeep` files that cannot hold a comment at all. The claim
 * under test is that a header, where one exists, tells the truth about its
 * lane.
 * @param strategy - Copy strategy to collect for.
 * @returns Repo-relative path and contents for each headered template.
 */
const headeredTemplates = async (
  strategy: Strategy
): Promise<{ relativePath: string; contents: string }[]> => {
  const collected: { relativePath: string; contents: string }[] = [];
  for (const lane of LANES) {
    for (const file of await templateFiles(lane, strategy)) {
      const contents = await readFile(file, "utf8");
      if (
        !contents.includes("managed by Lisa") &&
        !contents.includes("YOURS")
      ) {
        continue;
      }
      collected.push({
        relativePath: path.relative(process.cwd(), file),
        contents,
      });
    }
  }
  return collected;
};

describe("template ownership headers state their real contract (#2538)", () => {
  for (const strategy of STRATEGIES) {
    describe(strategy, () => {
      it("carries the header for its own strategy, on every lane", async () => {
        const templates = await headeredTemplates(strategy);
        // A lane rename or a moved tree would empty this silently, and the
        // test would then pass by testing nothing.
        expect(templates.length).toBeGreaterThan(10);

        const offenders = templates
          .filter(
            ({ contents }) =>
              !HEADERS[strategy].every(line => contents.includes(line))
          )
          .map(({ relativePath }) => relativePath);

        expect(offenders).toEqual([]);
      });

      it("never carries the OTHER strategy's header", async () => {
        const other = STRATEGIES.find(name => name !== strategy) as Strategy;
        const templates = await headeredTemplates(strategy);

        // The distinguishing sentence, not the shared boilerplate: both
        // headers name Lisa, so only the contract clause discriminates.
        const [otherClaim] = HEADERS[other];
        const offenders = templates
          .filter(({ contents }) => contents.includes(otherClaim))
          .map(({ relativePath }) => relativePath);

        expect(offenders).toEqual([]);
      });

      it("no longer carries the retired one-size-fits-both warning", async () => {
        const offenders = (await headeredTemplates(strategy))
          .filter(({ contents }) => contents.includes(RETIRED))
          .map(({ relativePath }) => relativePath);

        expect(offenders).toEqual([]);
      });
    });
  }

  it("gives the two lanes headers that actually differ", async () => {
    // Guards the guard: if both entries were edited to the same text, every
    // assertion above would still pass while distinguishing nothing.
    expect(HEADERS["create-only"]).not.toEqual(HEADERS["copy-overwrite"]);
    expect(HEADERS["create-only"][0]).not.toBe(HEADERS["copy-overwrite"][0]);
  });

  it("leaves no commentable create-only template silent about who owns it (#2549)", async () => {
    // Every assertion above reads `headeredTemplates`, which selects the
    // population on "already contains a header". That is right for JSON and
    // `.gitkeep`, which cannot hold a comment — but it means SILENCE is the one
    // state those assertions structurally cannot see, and a file created
    // without a header is excused by the very check meant to govern it.
    //
    // It is not hypothetical. `expo/create-only/.github/workflows/ci.yml` — the
    // file #2538's opening names by path — still had no ownership header after
    // the PR that corrected 86 others, because nothing selected it.
    //
    // So this one asserts over the whole commentable population instead: not
    // "every headered file is right" but "no ownable file is silent".
    const silent: string[] = [];
    let audited = 0;
    for (const lane of LANES) {
      for (const file of await templateFiles(lane, "create-only")) {
        if (!COMMENTABLE.test(file)) continue;
        audited += 1;
        const contents = await readFile(file, "utf8");
        if (!HEADERS["create-only"].every(line => contents.includes(line))) {
          silent.push(path.relative(process.cwd(), file));
        }
      }
    }

    // Without this, an extension list or lane list that stopped matching would
    // report zero offenders and read as a pass — the same vacuous green #2538
    // was filed about, reproduced inside its own guard.
    expect(audited).toBeGreaterThan(50);
    expect(silent).toEqual([]);
  });

  it("leaves no commentable copy-overwrite template silent about who owns it (#2547)", async () => {
    // The #2549 assertion above, pointed at the other lane — and this is the
    // lane where silence costs the most. A create-only file that says nothing
    // is read as maybe-Lisa's and left alone; a copy-overwrite file that says
    // nothing is read as editable and edited, and the next sync deletes the
    // edit without telling anyone. That already happened to a consumer repo's
    // hardened `block-no-verify.sh`.
    const silent: string[] = [];
    let audited = 0;
    for (const lane of LANES) {
      for (const file of await templateFiles(lane, "copy-overwrite")) {
        if (!COMMENTABLE.test(file)) continue;
        audited += 1;
        const contents = await readFile(file, "utf8");
        if (!HEADERS["copy-overwrite"].every(line => contents.includes(line))) {
          silent.push(path.relative(process.cwd(), file));
        }
      }
    }

    expect(audited).toBeGreaterThan(50);
    expect(silent).toEqual([]);
  });

  it("exempts only copy-overwrite formats that cannot hold a comment (#2547)", async () => {
    // The population here is the WHOLE lane, not the commentable slice, because
    // `COMMENTABLE` is itself an exemption and an exemption nobody writes down
    // is the #2549 defect in a different costume. Every file either states its
    // contract or its format appears in `NO_COMMENT_SYNTAX` with a reason.
    const unexplained: string[] = [];
    const exemptionsUsed = new Set<string>();
    let audited = 0;

    for (const lane of LANES) {
      for (const file of await templateFiles(lane, "copy-overwrite")) {
        audited += 1;
        const contents = await readFile(file, "utf8");
        if (HEADERS["copy-overwrite"].every(line => contents.includes(line))) {
          continue;
        }
        // `.nvmrc` and `.gitkeep` are dotfiles, and `extname` reports no
        // extension for those — falling back to the whole name is what lets
        // them be named in the exemption list rather than slipping past it.
        const extension = path.extname(file) || path.basename(file);
        if (extension in NO_COMMENT_SYNTAX) {
          exemptionsUsed.add(extension);
          continue;
        }
        unexplained.push(path.relative(process.cwd(), file));
      }
    }

    expect(audited).toBeGreaterThan(100);
    expect(unexplained).toEqual([]);
    // A written-down excuse for a format the lane no longer ships is a hole
    // waiting for a file to fall into it, so the list has to stay used.
    const byName = (a: string, b: string): number => a.localeCompare(b);
    expect([...exemptionsUsed].sort(byName)).toEqual(
      Object.keys(NO_COMMENT_SYNTAX).sort(byName)
    );
  });

  it("cannot generate a copy-overwrite asset without stamping the header (#2547)", async () => {
    // Thirteen copy-overwrite assets are not authored where they ship: the
    // build materializes them from `plugins/src/base/hooks/` and from
    // `scripts/lisa-enforcement-fallback.sh`. A header typed into those copies
    // is erased on the next `bun run build`, which is why #2545 could correct
    // 86 files and not these.
    //
    // The fix stamps the header during generation, so the assertion that keeps
    // it true is about the GENERATOR, not about today's thirteen files. A
    // fourteenth asset added with a bare `cp` into a copy-overwrite tree would
    // pass every file-list check above by simply not being in the list — this
    // one fails on the `cp` itself.
    const build = await readFile(
      path.join(process.cwd(), "scripts", "build-plugins.sh"),
      "utf8"
    );

    // Matched on the `cp` itself rather than on a `copy-overwrite` substring in
    // the destination: two of the four sync sites write through a shell
    // variable (`$HOST_GUARD_DIR`, `$ratchet_scripts_dir`), so a path-shaped
    // filter reads them as harmless. Measured — the first version of this
    // assertion did exactly that and sat green while a reverted call site was
    // shipping headerless guards.
    //
    // So the rule is an allowlist of one: the plugin tree copy, which lands in
    // `plugins/` and is not a template. Any other `cp` has to be justified here
    // before it can ship.
    const PLUGIN_TREE_COPY = 'cp -r "$src/." "$out/"';
    const copies = build
      .split("\n")
      .map(line => line.trim())
      .filter(line => !line.startsWith("#"))
      .filter(line => /(^|\s)cp\s/u.test(line));

    expect(copies).toEqual([PLUGIN_TREE_COPY]);
    // And the stamping helper is actually reached, so deleting the sync
    // altogether would not read as a pass.
    expect(build).toContain("materialize-copy-overwrite.mjs");
  });

  it("keeps the header below a shebang and a Ruby magic comment", async () => {
    // Placement is not cosmetic. A `#!` line that stops being line 1 stops
    // being a shebang, and `# frozen_string_literal: true` silently stops
    // applying if anything but a shebang precedes it — so a careless header
    // insert is a behavior change wearing a comment's clothes.
    // Both lanes. The generated copy-overwrite hooks are shebang scripts the
    // build now writes a header into (#2547), so this is exactly where a
    // placement bug would be introduced by machine rather than by hand.
    const files = (
      await Promise.all(
        STRATEGIES.flatMap(strategy =>
          LANES.map(lane => templateFiles(lane, strategy))
        )
      )
    )
      .flat()
      .filter(file => COMMENTABLE.test(file));

    const misplaced = (
      await Promise.all(
        files.map(async file => {
          const second = (await readFile(file, "utf8")).split("\n")[1] ?? "";
          return DISPLACED_BY_HEADER.test(second)
            ? path.relative(process.cwd(), file)
            : "";
        })
      )
    ).filter(Boolean);

    expect(misplaced).toEqual([]);
  });
});

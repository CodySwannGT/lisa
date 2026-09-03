/**
 * The guard's remediation text must only teach routes that exist.
 *
 * `block-direct-issue-create.sh` refuses an undeclared filing and then prints
 * two sanctioned routes. One of them told callers to route a deliberately-held
 * item through `/lisa:track` and "pass `human_gate:`" — a parameter that skill's
 * contract did not mention anywhere, on any agent variant. Nothing errored: the
 * caller followed the guard exactly, the gate was silently dropped, and the
 * held decision was published into the lane build-intake claims from and then
 * claimed, which made it look already-attended too.
 *
 * A test that only checked for the string `human_gate` in one skill would pin
 * this instance and nothing else. The failure CLASS is a guard confidently
 * teaching a remedy no surface implements, so these tests read the guard's own
 * remediation, extract the routes and parameters it teaches, and verify them
 * against the contracts of the skills it names — whatever those turn out to be.
 * A future route that names a parameter its target does not accept fails here
 * without anyone remembering to add a case.
 * @module tests/unit/hooks/block-direct-issue-create-remediation-executability
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Where the remediation's list of sanctioned routes starts. */
const ROUTES_START = "FILE IT THE SANCTIONED WAY";
/** The first line after the routes; everything past it is CLI advice. */
const ROUTES_END = "If you must run the CLI directly,";
/** Plugin trees searched for guard copies and skill variants. */
const PLUGIN_ROOTS = ["plugins", "all"] as const;
/** Skill contracts fall back here when a guard copy has no sibling skills. */
const BASE_SKILLS = path.resolve("plugins/src/base/skills");
/** The guard filename, as it appears in every tree that ships a copy. */
const GUARD_FILE = "block-direct-issue-create.sh";

/**
 * Whether a path is an existing directory.
 * @param candidate - Path to test.
 * @returns True when the path is a directory.
 */
const existsDir = (candidate: string): boolean => {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Every file with the given basename beneath a directory.
 * @param dir - Directory to walk.
 * @param basename - Exact filename to collect.
 * @returns Absolute paths, in directory order.
 */
const findByName = (dir: string, basename: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : findByName(full, basename);
    }
    return entry.name === basename ? [full] : [];
  });

/**
 * Every file with the given basename across the shipped plugin trees.
 * @param basename - Exact filename to collect.
 * @returns Absolute paths.
 */
const findEverywhere = (basename: string): readonly string[] =>
  PLUGIN_ROOTS.filter(root => existsDir(path.resolve(root))).flatMap(root =>
    findByName(path.resolve(root), basename)
  );

/**
 * The sanctioned-routes section of a guard copy's refusal message.
 * @param guardPath - Path to a guard copy.
 * @returns The section text, or an empty string when the copy has none.
 */
const routesSection = (guardPath: string): string => {
  const text = readFileSync(guardPath, "utf-8");
  const start = text.indexOf(ROUTES_START);
  const end = text.indexOf(ROUTES_END, start + 1);
  return start === -1 || end === -1 ? "" : text.slice(start, end);
};

/**
 * The declaration parameters a routes section teaches, e.g. `build_ready`.
 * @param section - A sanctioned-routes section.
 * @returns Unique parameter names.
 */
const taughtParameters = (section: string): readonly string[] => [
  ...new Set(
    [...section.matchAll(/\\?`([a-z][a-z0-9_]*):\s/gu)].map(
      match => match[1] ?? ""
    )
  ),
];

/**
 * The Lisa skills a routes section names as filing routes.
 *
 * Both surface forms count: the slash command a caller types (`/lisa:track`)
 * and the skill the prose names directly (`lisa-tracker-write`). A token that
 * is not a real skill directory — a rule slug, a body marker — is discarded.
 * @param section - A sanctioned-routes section.
 * @returns Unique skill directory names.
 */
const namedSkills = (section: string): readonly string[] => {
  const commands = [...section.matchAll(/\/lisa:([a-z0-9:-]+)/gu)].map(
    match => `lisa-${(match[1] ?? "").replaceAll(":", "-")}`
  );
  const direct = [...section.matchAll(/\\?`(lisa-[a-z0-9-]+)\\?`/gu)].map(
    match => match[1] ?? ""
  );
  return [...new Set([...commands, ...direct])].filter(name =>
    existsDir(path.join(BASE_SKILLS, name))
  );
};

/**
 * The skills directory a guard copy's routes resolve against.
 * @param guardPath - Path to a guard copy.
 * @returns The sibling plugin skills directory, else the base source.
 */
const skillsDirFor = (guardPath: string): string => {
  const sibling = path.resolve(path.dirname(guardPath), "..", "skills");
  return existsDir(sibling) ? sibling : BASE_SKILLS;
};

/** Guard copies that actually print a sanctioned-routes section. */
const GUARDS = findEverywhere(GUARD_FILE).filter(
  guardPath => routesSection(guardPath) !== ""
);
/** Every skill contract in the shipped plugin trees, walked once. */
const ALL_CONTRACTS = findEverywhere("SKILL.md");
/** The filing routes the guards name, deduplicated. */
const ROUTE_NAMES = [
  ...new Set(
    GUARDS.flatMap(guardPath => namedSkills(routesSection(guardPath)))
  ),
];
/** The declarations the guards teach, deduplicated. */
const TAUGHT = [
  ...new Set(
    GUARDS.flatMap(guardPath => taughtParameters(routesSection(guardPath)))
  ),
];

/**
 * Every agent variant of a skill contract.
 * @param name - Skill directory name.
 * @returns Absolute paths to each variant's SKILL.md.
 */
const skillVariants = (name: string): readonly string[] => [
  ...new Set(
    ALL_CONTRACTS.filter(file => path.basename(path.dirname(file)) === name)
  ),
];

describe("the guard's remediation only teaches executable routes", () => {
  it("finds guard copies that print sanctioned routes", () => {
    expect(GUARDS.length).toBeGreaterThan(0);
  });

  it("extracts routes and declarations from them", () => {
    expect(ROUTE_NAMES.length).toBeGreaterThan(0);
    expect(TAUGHT.length).toBeGreaterThan(0);
  });

  it.each(GUARDS)("%s names only accepted parameters", guardPath => {
    const section = routesSection(guardPath);
    const skillsDir = skillsDirFor(guardPath);
    const unaccepted = namedSkills(section).flatMap(skill => {
      const contract = readFileSync(
        path.join(skillsDir, skill, "SKILL.md"),
        "utf-8"
      );
      return taughtParameters(section)
        .filter(parameter => !contract.includes(parameter))
        .map(parameter => `${skill} does not accept ${parameter}`);
    });
    expect(unaccepted).toEqual([]);
  });
});

describe("a filing route documents the hold wherever it documents readiness", () => {
  it.each(ROUTE_NAMES)("%s never presents build-ready alone", name => {
    const offenders = skillVariants(name).filter(file =>
      readFileSync(file, "utf-8")
        .split("\n")
        .some(
          line =>
            line.includes("build_ready: true") && !line.includes("human_gate")
        )
    );
    expect(offenders).toEqual([]);
  });

  it.each(ROUTE_NAMES)(
    "%s carries every declaration on every variant",
    name => {
      const variants = skillVariants(name);
      const gaps = variants.flatMap(file => {
        const contract = readFileSync(file, "utf-8");
        return TAUGHT.filter(parameter => !contract.includes(parameter)).map(
          parameter => `${file} omits ${parameter}`
        );
      });
      expect(variants.length).toBeGreaterThan(0);
      expect(gaps).toEqual([]);
    }
  );
});

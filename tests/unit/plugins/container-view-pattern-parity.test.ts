/**
 * Proof that every shipped copy of the `container-view-pattern` skill carries
 * the same, corrected View gate.
 *
 * The skill exists once in `plugins/src/expo` and is materialised into five
 * more places — `lisa-expo`, its `.codex-plugin` sibling, `lisa-expo-agy`,
 * `lisa-expo-cursor`, `lisa-expo-copilot` — and per AGENTS.md every coding
 * agent must stay at parity with Claude, the reference implementation. Editing
 * the copies by hand is how one of them silently keeps the old text; so is
 * writing a test that names them.
 *
 * This suite therefore ENUMERATES: it walks `plugins/` for the skill directory
 * and asserts each copy it finds. A seventh plugin added tomorrow inherits
 * every assertion with nobody remembering to add it, and an enumeration that
 * finds nothing fails rather than passing vacuously.
 *
 * The Python validator is checked by RUNNING it, not by reading it. Its hook
 * scan used to list a general `\\buse[A-Z]\\w+\\s*\\(` pattern and then narrow to
 * four hardcoded names and `break`, leaving the general pattern unreachable —
 * dead code that read as coverage. Only execution tells those apart.
 * @module tests/unit/plugins/container-view-pattern-parity
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const PLUGINS_ROOT = path.join(REPO_ROOT, "plugins");
const SKILL_DIR = "container-view-pattern";
const PYTHON_BIN = process.env.PYTHON ?? "python3";

/**
 * The lowest number of copies this repository is known to ship.
 *
 * A floor, not a count: adding a plugin must not require editing this file, and
 * a walk that suddenly finds one copy has found a broken build, not a
 * simplification.
 */
const MINIMUM_COPIES = 6;

/**
 * Every `container-view-pattern` directory under `plugins/`.
 * @param from - Directory to search below.
 * @returns Absolute paths, sorted.
 */
function findSkillCopies(from: string): readonly string[] {
  const found = fs
    .readdirSync(from, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "node_modules")
    .flatMap(entry => {
      const child = path.join(from, entry.name);
      return entry.name === SKILL_DIR ? [child] : [...findSkillCopies(child)];
    });
  return [...found].sort((left, right) => left.localeCompare(right));
}

const COPIES = findSkillCopies(PLUGINS_ROOT);

/** Temp roots this file has created, emptied after every case. */
const TEMP_ROOTS: string[] = [];

afterEach(() => {
  TEMP_ROOTS.splice(0).forEach(root => {
    fs.rmSync(root, { force: true, recursive: true });
  });
});

/** A Container whose returned tree is only the View. */
const PLAIN_CONTAINER =
  'import WidgetView from "./WidgetView";\n' +
  "const WidgetContainer = () => <WidgetView />;\n" +
  "export default WidgetContainer;\n";

/**
 * A Container holding a `renderItem` callback that returns JSX.
 *
 * Legitimate, and the destination the View hook ban sends such a callback to —
 * Containers may hold logic. The script's whole-file JSX scan cannot tell this
 * from a Container that RENDERS `<Row />`, which is exactly why that check
 * reports as an advisory instead of failing.
 */
const RENDER_ITEM_CONTAINER =
  'import { useCallback } from "react";\n' +
  'import WidgetView from "./WidgetView";\n' +
  "const WidgetContainer = () => {\n" +
  "  const renderItem = useCallback(({ item }) => <Row item={item} />, []);\n" +
  "  return <WidgetView renderItem={renderItem} />;\n" +
  "};\n" +
  "export default WidgetContainer;\n";

/**
 * Write a Widget component directory whose View has the given body.
 *
 * Registers its own temp root for cleanup, so a case that throws before it
 * could have registered one still leaves nothing behind.
 * @param viewSource - Contents of `WidgetView.tsx`.
 * @param containerSource - Contents of `WidgetContainer.tsx`.
 * @returns The component directory to hand the validator.
 */
function widget(
  viewSource: string,
  containerSource: string = PLAIN_CONTAINER
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-cvp-"));
  const dir = path.join(root, "Widget");
  TEMP_ROOTS.push(root);
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, "index.tsx"),
    'export { default } from "./WidgetContainer";\n'
  );
  fs.writeFileSync(path.join(dir, "WidgetContainer.tsx"), containerSource);
  fs.writeFileSync(path.join(dir, "WidgetView.tsx"), viewSource);
  return dir;
}

/** Everything a View file needs beyond the component itself. */
const VIEW_PREAMBLE = 'import { memo } from "react";\n';

/** The memo export and displayName the validator also checks for. */
const VIEW_EPILOGUE =
  'WidgetView.displayName = "WidgetView";\nexport default memo(WidgetView);\n';

/**
 * A complete View file around one component declaration.
 * @param component - The component's source, without imports or export.
 * @returns The file's text.
 */
const viewFile = (component: string): string =>
  `${VIEW_PREAMBLE}${component}${VIEW_EPILOGUE}`;

const COMPLIANT_VIEW = viewFile(
  "const WidgetView = ({ label, onPress = () => {} }: Props) => (\n" +
    "  <Box onPress={onPress}>{label}</Box>\n" +
    ");\n"
);

const DECLARATION_FORM_VIEW = viewFile(
  "function WidgetView({ label }: Props) {\n" +
    "  return <Box>{label}</Box>;\n" +
    "}\n"
);

const CUSTOM_HOOK_VIEW = viewFile(
  "const WidgetView = ({ label }: Props) => (\n" +
    "  <Box>{useCreateNoteQuickActionEnabled() ? label : null}</Box>\n" +
    ");\n"
);

describe("container-view-pattern copies are enumerated, not listed", () => {
  it("finds every shipped copy of the skill", () => {
    expect(COPIES.length).toBeGreaterThanOrEqual(MINIMUM_COPIES);
  });

  it("finds the canonical source among them", () => {
    expect(COPIES).toContain(
      path.join(PLUGINS_ROOT, "src", "expo", "skills", SKILL_DIR)
    );
  });
});

describe.each(COPIES.map(copy => [path.relative(REPO_ROOT, copy), copy]))(
  "%s",
  (_label, copy) => {
    const skill = (): string =>
      fs.readFileSync(path.join(copy, "SKILL.md"), "utf8");

    it("names the hook rule in its enforcement table", () => {
      expect(skill()).toContain("component-structure/no-hooks-in-view");
    });

    it("names the import restriction in its enforcement table", () => {
      expect(skill()).toContain("no-restricted-imports");
    });

    it("states the guarantee as no statements and no hooks", () => {
      // Not "pure". An expression body admits `{Date.now()}` and
      // `{Math.random() > 0.5 ? … : …}`, so claiming purity would be the same
      // false assurance this skill was corrected for.
      expect(skill()).toContain("no statements and no hooks");
    });

    it("separates the requirements lint does not enforce", () => {
      expect(skill()).toContain("What lint does NOT enforce");
    });

    it("documents a script path that exists in a consumer", () => {
      // `.claude/skills/container-view-pattern/scripts/…` is where the skill is
      // NOT: it ships inside the plugin cache.
      expect(skill()).not.toContain(`.claude/skills/${SKILL_DIR}/scripts/`);
      expect(skill()).toContain("CLAUDE_PLUGIN_ROOT");
    });
  }
);

describe.each(COPIES.map(copy => [path.relative(REPO_ROOT, copy), copy]))(
  "%s validate_component.py",
  (_label, copy) => {
    const script = path.join(copy, "scripts", "validate_component.py");

    /**
     * Run the validator over a fixture View.
     * @param viewSource - Contents of `WidgetView.tsx`.
     * @param containerSource - Contents of `WidgetContainer.tsx`.
     * @returns The child's exit status and combined output.
     */
    const validate = (
      viewSource: string,
      containerSource?: string
    ): { readonly status: number | null; readonly output: string } => {
      const outcome = boundedSpawnSync({
        label: "validate_component.py",
        command: PYTHON_BIN,
        args: [script, widget(viewSource, containerSource)],
      });
      return {
        status: outcome.status,
        output: `${outcome.stdout}${outcome.stderr}`,
      };
    };

    it("accepts a compliant View", () => {
      expect(validate(COMPLIANT_VIEW).status).toBe(0);
    });

    it("rejects a declaration-form View", () => {
      // The arrow-only block-body regex it used to carry reproduced the ESLint
      // rule's defect exactly: this file passed.
      const result = validate(DECLARATION_FORM_VIEW);
      expect(result.status).toBe(1);
      expect(result.output).toContain("arrow function with an expression body");
    });

    it("rejects a project-local custom hook a name list would miss", () => {
      const result = validate(CUSTOM_HOOK_VIEW);
      expect(result.status).toBe(1);
      expect(result.output).toContain("useCreateNoteQuickActionEnabled");
    });

    it("does not fail a Container holding a JSX-returning callback", () => {
      // Moving a renderItem out of a View is one of the two sanctioned fixes
      // for the hook ban, and the Container is where it lands. The script's
      // whole-file JSX scan cannot distinguish that from a Container that
      // RENDERS <Row />, so it reports and stands down. Left as an error it
      // would reject the very migration the View rules ask for.
      const result = validate(COMPLIANT_VIEW, RENDER_ITEM_CONTAINER);
      expect(result.status).toBe(0);
      expect(result.output).toContain("does not fail validation");
    });
  }
);

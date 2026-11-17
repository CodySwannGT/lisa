/**
 * An Expo-shaped host whose imports only resolve the way TypeScript resolves
 * them, and the `knip.ts` the `knip-platform-files` skill tells a host to
 * write (CodySwannGT/lisa#4932).
 *
 * The `knip.ts` is the skill's own worked example, read out of the skill, so a
 * test that runs it proves the documented fix rather than a private copy.
 * @module tests/helpers/expo-knip-fixture
 */
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The skill an agent reads when knip reports unresolved platform files. */
export const KNIP_PLATFORM_SKILL = path.join(
  REPO_ROOT,
  "plugins",
  "src",
  "expo",
  "skills",
  "knip-platform-files",
  "SKILL.md"
);

/** Lisa's knip entry point, as source, so no build is needed to run it. */
const HELPER_SOURCE = path.join(
  REPO_ROOT,
  "src",
  "configs",
  "knip",
  "index.ts"
);

/** The import a host writes, which the fixture points at the source. */
const PUBLISHED_IMPORT = '"@codyswann/lisa/knip"';

/**
 * The worked example's `knip.ts`, exactly as the skill prints it.
 * @returns The first `ts` code block in the skill
 */
export function workedExample(): string {
  const skill = fs.readFileSync(KNIP_PLATFORM_SKILL, "utf8");
  const block = /```ts\n([\s\S]*?)```/u.exec(skill)?.[1];
  if (block === undefined)
    throw new Error(`${KNIP_PLATFORM_SKILL} has no ts example`);
  return block;
}

/**
 * The worked example with its Lisa import pointed at this checkout's source.
 * @param source - A `knip.ts` written against the published import
 * @returns The same file, runnable inside this repository
 */
export function againstSource(source: string): string {
  if (!source.includes(PUBLISHED_IMPORT))
    throw new Error(`the example does not import ${PUBLISHED_IMPORT}`);
  return source.replace(PUBLISHED_IMPORT, JSON.stringify(HELPER_SOURCE));
}

/**
 * Write a host laid out like Lisa's Expo stack: `tsconfig.json` extends a
 * `tsconfig.local.json` that sets `baseUrl` and `@/*` and excludes
 * `src/components/ui`. It imports platform files directly and through the
 * alias, and imports `tailwind.config` by `baseUrl` from the excluded
 * directory; `@/lib/tone` resolves either way and proves the `*` alias does
 * not shadow `@/*`.
 * @param dir - Empty host directory
 */
export function writeExpoKnipHost(dir: string): void {
  const files: Readonly<Record<string, string>> = {
    "package.json": JSON.stringify({ name: "host", type: "module" }),
    "tsconfig.json": JSON.stringify({
      extends: ["./tsconfig.local.json"],
      compilerOptions: {
        jsx: "react-jsx",
        moduleSuffixes: [".ios", ".android", ".native", ".web", ""],
      },
      include: ["**/*.ts", "**/*.tsx"],
    }),
    "tsconfig.local.json": JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
      exclude: ["node_modules", "src/components/ui"],
    }),
    "index.tsx": 'export { Screen } from "./src/app/screen";\n',
    "src/app/screen.tsx": [
      'import { Picker } from "../Picker";',
      'import { button } from "@/components/ui/button";',
      "export const Screen = [Picker, button];",
      "",
    ].join("\n"),
    "src/Picker.native.tsx": 'export const Picker = "native";\n',
    "src/Picker.web.tsx": 'export const Picker = "web";\n',
    "src/Swatch.native.tsx": 'export const Swatch = "native";\n',
    "src/components/ui/button.tsx": [
      'import { Swatch } from "@/Swatch";',
      'import { tone } from "@/lib/tone";',
      'import theme from "tailwind.config";',
      "export const button = [Swatch, tone, theme];",
      "",
    ].join("\n"),
    "src/lib/tone.ts": 'export const tone = "dark";\n',
    "tailwind.config.js": "export default {};\n",
  };
  for (const [relative, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    fs.writeFileSync(path.join(dir, relative), contents);
  }
}

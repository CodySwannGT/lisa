---
name: knip-platform-files
description: "Fix knip flagging imports TypeScript resolves in an Expo app: platform files (Foo.native.tsx, Foo.web.tsx) imported as ./Foo or @/…/Foo, or tailwind.config imported by baseUrl inside an excluded directory such as components/ui. Use when knip:check reports them."
---

# Knip and Expo platform files

## Symptom

`knip` reports imports that the app builds and type-checks with:

- **Unresolved imports**: `./Picker` or `@/components/Picker` where only
  `Picker.native.tsx` and `Picker.web.tsx` exist
- **Unlisted dependencies**: `tailwind.config` imported inside
  `src/components/ui/**` (gluestack), a directory `tsconfig.local.json`
  excludes

## Cause

Knip 6 resolves imports with oxc-resolver, not TypeScript. It does not read
`moduleSuffixes` from the tsconfig, and it resolves bare specifiers against
`baseUrl` only in files the tsconfig includes. A `knip.json` cannot change
either; only a `knip.ts` can. Upstream knip leaves this to oxc-resolver
(oxc-project/oxc-resolver#1401).

## Fix: move the config to `knip.ts` and spread Lisa's resolution

1. Create `knip.ts` with everything from `knip.json` — keep its `entry`,
   `project` and `ignore` exactly — and spread `expoKnipResolution()` last.
2. Delete `knip.json`. Knip reads `knip.json` before `knip.ts`, so leaving it
   in place keeps the old config active. Lisa does not write a `knip.json`
   next to a project's own `knip.ts`.
3. Run `bun run knip:check`. The platform files and `baseUrl` imports now
   resolve.

```ts
import type { KnipConfig } from "knip";
import { expoKnipResolution } from "@codyswann/lisa/knip";

const config: KnipConfig = {
  entry: ["index.tsx", "src/app/**/*.{ts,tsx}"],
  project: ["index.tsx", "src/**/*.{ts,tsx}"],
  ignore: ["**/generated/**"],
  ignoreExportsUsedInFile: true,
  ...expoKnipResolution(),
};

export default config;
```

`expoKnipResolution()` reads the project's own `tsconfig.json` (with
everything it extends from Lisa), and returns:

- `compilers` — one pass-through compiler per `moduleSuffixes` entry and
  source extension (`native.tsx`, `web.ts`, …). They return the file
  unchanged; declaring them is what makes knip try those extensions.
- `paths` — the tsconfig `paths`, then `baseUrl` as a final `*`, applied by
  knip to every file, excluded ones included. The aliases come first so
  `@/…` keeps winning over `baseUrl`, as it does in TypeScript.

The two halves are also exported on their own as `platformSuffixCompilers()`
and `tsconfigPathAliases()`. Each takes `{ cwd, tsconfig }` when the config
does not sit next to `tsconfig.json`.

## Never

- Never add `ignoreUnresolved`, `ignoreDependencies`, `ignoreIssues` or an
  `ignore` glob over the platform files to make the report quiet. Those hide
  every future broken import in the same files; the resolution above fixes the
  cause.
- Never rename platform files to dodge the report. The platform extensions are
  how Metro picks the implementation (see `cross-platform-compatibility`).

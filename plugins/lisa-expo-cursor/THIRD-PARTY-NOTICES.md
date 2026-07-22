# Third-Party Notices

## Official Expo skills (vendored)

The following skills under `skills/` are vendored verbatim from Expo's official
plugin and are **not** Lisa-authored. Do not hand-edit them; re-vendor from
upstream to update.

- **Source:** https://github.com/expo/skills (`plugins/expo/skills/`)
- **Upstream commit:** `510373b50956ef4dc84c20bb4c9cce70b618aa06`
- **License:** MIT — Copyright (c) 2025-present 650 Industries, Inc. (aka Expo)

Vendored skills:

```
add-app-clip            expo-cicd-workflows     expo-ui-jetpack-compose
building-native-ui      expo-deployment         expo-ui-swift-ui
eas-update-insights     expo-dev-client         native-data-fetching
expo-api-routes         expo-module             upgrading-expo
expo-brownfield         expo-tailwind-setup     use-dom
```

These ship alongside Lisa's own opinionated Expo/React Native skills
(`apollo-client`, `gluestack-nativewind`, `container-view-pattern`, etc.), which
they complement rather than replace. Notably both `expo-tailwind-setup`
(Tailwind v4 / NativeWind v5) and Lisa's `gluestack-nativewind` (Gluestack v3 /
NativeWind v4) are kept intentionally; choose per project.

The accompanying `expo` MCP server in `.mcp.json` points at Expo's official
remote server (`https://mcp.expo.dev/mcp`), replacing the previously bundled
third-party `expo-local-docs-mcp` stdio server.

The Maestro CLI's built-in MCP server (`maestro mcp`, STDIO) is intentionally
NOT registered in `.mcp.json`. Coding agents spawn stdio servers with a
non-login PATH, so an always-on entry fails visibly (Claude Code shows a
"Failed to reconnect … -32000" error every session) on any machine missing the
Maestro CLI or a resolvable Java runtime — which is most of the fleet. Opt in
per machine instead.

The supported path is the **`/lisa-expo:maestro-mcp-setup`** skill (Codex:
`$maestro-mcp-setup`), which detects the Maestro CLI and a usable Java runtime,
installs or guides whatever is missing, and registers `maestro mcp` at
**local/per-machine scope** with an absolute command path and injected
`JAVA_HOME`/`PATH` — so the spawn works even under a non-login PATH.

To register by hand instead, keep it at local scope and inject the toolchain,
e.g.:

```
claude mcp add --scope local maestro \
  --env "JAVA_HOME=$JAVA_HOME" --env "PATH=$(dirname "$(command -v java)"):$HOME/.maestro/bin:$PATH" \
  -- "$HOME/.maestro/bin/maestro" mcp
```

Never register at `--scope project` / a committed `.mcp.json` — that is the
always-on form that reds out every other machine in the fleet.

### MIT License

```
The MIT License (MIT)

Copyright (c) 2025-present 650 Industries, Inc. (aka Expo)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

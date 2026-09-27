# Static Export Verification

When `expo export` runs with static output (`output: "static"` in app.json),
every route must produce an HTML file with the right title and the expected
initial markup. `expo export` succeeding only proves the bundle built — a
missing route, a wrong title, or an empty shell all ship green unless the
exported output itself is checked.

## Enumerate the dynamic routes

Static export prerenders each route it can enumerate. Dynamic segments need
`generateStaticParams` — an unenumerated `[id]` route produces no page at all.
After export, enumerate the routes the app *declares* and assert each one has
a file under `dist/`:

```typescript
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve("dist");

// The routes the app owns — keep this in sync with app/, or derive it from
// the route manifest expo-router emits.
const EXPECTED_ROUTES = ["index", "settings", "players/[id]"];

for (const route of EXPECTED_ROUTES) {
  const html = path.join(DIST, `${route}.html`);
  expect(existsSync(html)).toBe(true);
}
```

## Per-route titles

`<Stack.Screen options={{ title: "..." }}>` sets the native header title; the
web `<title>` comes from `Head` (`expo-router/head`). Assert the title the
exported HTML actually carries:

```typescript
const html = readFileSync(path.join(DIST, "settings.html"), "utf8");
expect(html).toMatch(/<title>[^<]*Settings[^<]*<\/title>/);
```

## Expected initial content

The exported page should ship its prerendered content, not a bare shell —
that is what makes static export worth shipping at all. Assert a stable marker
of the route's expected first paint:

```typescript
expect(html).toContain("Sign in to continue");
```

Keep the marker to content that exists in the static HTML, never something
hydration adds later.

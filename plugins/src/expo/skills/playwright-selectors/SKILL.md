---
name: playwright-selectors
description: Best practices for writing reliable Playwright E2E tests and adding testID/aria-label selectors in Expo web applications using GlueStack UI and NativeWind. Use this skill when creating, debugging, or modifying Playwright tests, adding E2E test coverage, creating components that need test selectors, reviewing code for testability, or troubleshooting testID/data-testid issues. Trigger on any mention of Playwright, E2E tests, end-to-end tests, testID, data-testid, or GlueStack testing in an Expo web context.
---

# Playwright E2E Testing for Expo + GlueStack UI

## The #1 Rule: Browser First, Code Second

Before writing ANY Playwright test, open the target page in a browser and manually walk through the flow. Never write tests blind from code reading alone.

Expo/GlueStack apps have complex rendering pipelines — what you see in source code is not always what renders in the DOM. Components may have state-dependent behavior (a button that opens an actionsheet OR a confirm dialog depending on data), elements may live on different tabs than you expect, and testIDs may or may not forward to the web DOM depending on the component type.

### Workflow for each new test

1. **Navigate** to the page using Playwright MCP browser tools
2. **Click through** the exact user flow the test will cover
3. **Run** `document.querySelectorAll('[data-testid]')` to see which testIDs are actually in the DOM
4. **Note** any conditional UI states, loading sequences, and tab navigation required
5. **Then** write the test code matching exactly what you observed

### Verify testIDs before scaling

Before writing a batch of tests that depend on testIDs, verify ONE testID end-to-end:

```javascript
// Run this in the browser console or via Playwright MCP evaluate
document.querySelectorAll('[data-testid]').length
// Should return > 0 after page fully loads
```

Accessibility snapshots from Playwright MCP may NOT show `data-testid` attributes. Always use `document.querySelectorAll` for ground truth. Pages may show very few testIDs before full render (e.g., 3 elements on initial load vs 80+ after data loads) — wait for the page to settle before checking.

---

## Selector Strategy

### Priority order

1. **`getByTestId`** — most stable, survives copy changes and redesigns
2. **`getByRole`** — good for interactive elements (`button`, `tab`, `switch`, `heading`)
3. **`getByLabel`** — form elements with labels
4. **`getByPlaceholder`** — inputs with placeholder text
5. **`getByText`** — fragile, use only when no testID or role is available

The generic web testing advice to prefer `getByRole` over `getByTestId` doesn't fully apply to React Native Web apps because ARIA role mapping is inconsistent across GlueStack components. testIDs are more reliable when properly set up.

```typescript
// 1. Preferred — testID
await expect(page.getByTestId("settings:dark-mode-toggle")).toBeVisible();

// 2. Good — role + accessible name
await page.getByRole("button", { name: "Close dialog" }).click();

// 3. Good — placeholder
await page.getByPlaceholder("Search players...").fill("Messi");

// 4. Fallback — text (fragile)
await expect(page.getByText("Settings").first()).toBeVisible();
```

### Fallback pattern for migration periods

When adding testIDs to components that are deployed separately from tests, use `.or()` to fall back gracefully:

```typescript
// Works before AND after testID is deployed
const heading = page
  .getByTestId("feature:heading")
  .or(page.getByText("Feature Title").first());
await expect(heading.first()).toBeVisible();
```

Remove the `.or()` fallback once the testID is confirmed deployed and working.

---

## testID Naming Convention

Use a namespaced pattern with colons as separators: `screen:element`

### Format

```
{screen}:{element}
```

- **screen**: lowercase screen/feature name (e.g., `home`, `profile`, `settings`)
- **element**: lowercase element identifier (e.g., `container`, `title`, `submit-button`)

### Examples

| testID                      | Description                    |
| --------------------------- | ------------------------------ |
| `home:container`            | Main container on home screen  |
| `home:title`                | Title text on home screen      |
| `profile:avatar`            | User avatar on profile screen  |
| `settings:dark-mode-toggle` | Dark mode toggle in settings   |
| `auth:login-button`         | Login button on auth screen    |

### Rules

1. Use lowercase only
2. Use colons (`:`) to separate screen from element
3. Use hyphens (`-`) for multi-word elements
4. Be descriptive but concise
5. Avoid redundant words (e.g., `home:home-title` should be `home:title`)

---

## testID Forwarding: Which Components Support What

This is the most critical technical knowledge for this stack. GlueStack UI components have **different** testID behavior depending on their render pipeline.

### The render chain

React Native Web converts `testID` → `data-testid` through its `createDOMProps` function. But this only happens for components that go through RN Web's `createElement` path. GlueStack wraps many components with NativeWind utilities (`withStyleContext`, `tva`) that bypass this path.

### Rules by component type

| Component | testID approach | Why |
|-----------|----------------|-----|
| `Pressable` (GlueStack) | `testID={value}` | Wraps RN `Pressable` → `View` → `createDOMProps` ✅ |
| `View` (react-native) | `testID={value}` | Goes through `createDOMProps` ✅ |
| `Text` (react-native) | `testID={value}` | Goes through `createDOMProps` ✅ |
| `Text` (GlueStack `@/components/ui/text`) | `{...{"data-testid": value}}` | NativeWind wrapper renders `<span>`, bypasses `createDOMProps` |
| `HStack` / `VStack` / `Box` (GlueStack) | `{...{"data-testid": value}}` | Same — NativeWind wrapper bypasses pipeline |
| `Heading` (GlueStack) | `data-testid={value}` | Renders raw `<h1>`–`<h6>` HTML elements |
| `Button` (GlueStack) | Unreliable — verify first | May or may not forward depending on version |
| Third-party (e.g., BouncyCheckbox) | Usually not possible | Use text/role selectors instead |

### How to tell which path a component uses

Trace the component's render chain:

```
GlueStack Pressable → createPressable({ Root: withStyleContext(RNPressable) })
  → withStyleContext passes {...props} to RNPressable
  → RN Web Pressable renders <View {...rest}>
  → View goes through createElement → createDOMProps
  → createDOMProps converts testID → data-testid ✅
```

vs:

```
GlueStack Text → tva-styled component
  → Renders <span> or <p> directly
  → Never hits createDOMProps
  → testID prop is silently ignored ❌
```

### Adding a testID to a new component

1. Check the component type against the table above
2. If it's a `Pressable` or RN `View`/`Text`, use `testID={value}` directly
3. If it's GlueStack `Text`, `HStack`, `VStack`, `Box`, use `{...{"data-testid": value}}`
4. If it's GlueStack `Heading`, use `data-testid={value}` as a JSX attribute
5. **Build and verify** in the browser before writing tests against it

```tsx
// Pressable — testID prop works
<Pressable testID="feature:action-button" onPress={handlePress}>
  <Text>Click me</Text>
</Pressable>

// GlueStack Text — use data-testid spread
<Text {...{"data-testid": "feature:section-heading"}}>
  Section Title
</Text>

// GlueStack HStack — use data-testid spread
<HStack {...{"data-testid": "feature:row"}} className="items-center">
  <Icon as={Star} />
  <Text>Rating</Text>
</HStack>

// GlueStack Heading — use data-testid attribute
<Heading data-testid="feature:page-title" size="lg">
  Page Title
</Heading>
```

---

## When to Add testID

### Add testID To

1. **Interactive elements** that E2E tests will click/interact with
2. **Key structural containers** for page load verification
3. **Dynamic content areas** that change based on state
4. **Form elements** that lack semantic labels

### Do Not Add testID To

1. Every element (over-testing creates maintenance burden)
2. Elements with good semantic selectors (use getByRole instead)
3. Decorative elements not needed for testing
4. Elements inside third-party components (may not propagate)

---

## Accessibility Best Practices

Prefer semantic selectors and aria-labels over testID when possible. This benefits both testing and screen reader users.

### aria-label for Testing and Accessibility

```typescript
// Correct — benefits both testing and accessibility
<Pressable
  accessibilityLabel="Close dialog"
  onPress={handleClose}
>
  <XIcon />
</Pressable>

// E2E test uses accessible name
await page.getByRole("button", { name: "Close dialog" }).click();
```

### accessibilityRole for Semantic Elements

```typescript
// Correct — semantic role for assistive technology
<Box accessibilityRole="banner" testID="header:container">
  <Text accessibilityRole="heading">Welcome</Text>
</Box>

// E2E test can use role
await expect(page.getByRole("banner")).toBeVisible();
await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
```

---

## CI Architecture: Test the PR's Own Code

Playwright must test against the code in the PR, not a remote deployed environment. If CI tests against a deployed app, new testIDs and component changes are invisible until deployed — creating a frustrating push-wait-fail cycle.

### Expo web setup for CI

The CI pipeline should:
1. Build the web app: `npx expo export --platform web` (creates `dist/`)
2. Serve it locally: `npx serve dist -l 8081 -s`
3. Run Playwright against `http://localhost:8081/`

### playwright.config.ts

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  // In CI, serve the static web build locally
  ...(process.env.CI
    ? {
        webServer: {
          command: "npx serve dist -l 8081 -s",
          port: 8081,
          reuseExistingServer: false,
        },
      }
    : {}),

  use: {
    baseURL: process.env.CI
      ? "http://localhost:8081/"
      : "https://dev.example.com/",
  },
});
```

---

## Writing Robust Tests

### Data independence

Never assert on data-dependent elements as required. The CI test user may have different data than your local environment.

```typescript
// BAD — fails if test user has no data
const tableRows = page.locator("table tr");
await expect(tableRows.first()).toBeVisible();
expect(await tableRows.count()).toBeGreaterThan(1);

// GOOD — handles empty state gracefully
const tableRows = page.locator("table tbody tr");
const rowCount = await tableRows.count();
if (rowCount === 0) {
  await expect(page.getByPlaceholder("Search...")).toBeVisible();
  return;
}
await tableRows.first().click();
```

### Timeouts

Use environment-aware timeouts from a shared constants file. CI runners are slower than local machines.

```typescript
export const TIMEOUT = {
  test: isCI ? 90_000 : 60_000,
  expect: isCI ? 30_000 : 15_000,
  navigation: isCI ? 45_000 : 30_000,
};

// In tests — never hardcode
await expect(element).toBeVisible({ timeout: TIMEOUT.navigation });
```

### Serial vs parallel mode

Use serial mode for tests that mutate shared backend state. Read-only tests can run in parallel.

```typescript
test.describe("Feature with mutations", () => {
  test.describe.configure({ mode: "serial" });
});
```

### State-dependent UI

Some UI elements behave differently depending on application state. Discover this during the browser-first step, then handle both cases:

```typescript
const addButton = page.getByTestId("feature:add-button").first();
await expect(addButton).toBeVisible();

const modal = page.getByText("Add to List");
const isModalVisible = await modal.isVisible();

if (isModalVisible) {
  await page.getByText("Done").click();
} else {
  await expect(addButton).toBeVisible();
}
```

---

## Common Pitfalls

### SonarCloud security hotspots

These patterns trigger SonarCloud security hotspot warnings that block PR merges:

```typescript
// BAD — triggers security hotspot
page.on("dialog", dialog => dialog.dismiss());
const result = await element.waitFor().catch(() => false);

// GOOD — use explicit checks instead
const isVisible = await element.isVisible();
const count = await elements.count();
```

### Page not fully rendered

Always wait for a content-dependent element before asserting on testIDs:

```typescript
// BAD — may run before page renders
const count = await page.evaluate(() =>
  document.querySelectorAll('[data-testid]').length
);

// GOOD — wait for known element first
await page.waitForLoadState("domcontentloaded");
const item = page.getByTestId("feature:item").first();
await item.waitFor({ state: "visible", timeout: 15000 });
```

### Third-party component testIDs

Components from third-party libraries (e.g., `react-native-bouncy-checkbox`, `react-native-gifted-chat`) generally do NOT forward `testID` to the web DOM. Use text, role, or structural selectors for these.

---

## Implementation Checklist

When adding E2E test coverage to a component:

- [ ] Open the page in a browser and walk through the flow first
- [ ] Run `document.querySelectorAll('[data-testid]')` to see existing testIDs
- [ ] Identify elements that need selectors for testing
- [ ] Check component type against the forwarding rules table
- [ ] Use namespaced testID pattern (`screen:element`) for elements without semantics
- [ ] Add accessibility labels where beneficial
- [ ] Verify testID propagates to `data-testid` on web before writing tests
- [ ] Use environment-aware timeouts, not hardcoded values
- [ ] Handle empty data states gracefully
- [ ] Document testIDs in component JSDoc preamble

## Example Component

```typescript
/**
 * Profile screen component.
 *
 * Test IDs for E2E testing:
 * - `profile:container` - Main container
 * - `profile:avatar` - User avatar image
 *
 * @module features/profile/screens/Main
 */
export const ProfileScreen = () => (
  <Box testID="profile:container" className="flex-1 p-4">
    <Image
      testID="profile:avatar"
      source={{ uri: user.avatarUrl }}
      accessibilityLabel={`${user.name}'s profile photo`}
    />
    <Text accessibilityRole="heading">
      {user.name}
    </Text>
    <Pressable
      accessibilityLabel="Edit profile"
      onPress={handleEdit}
    >
      <Text>Edit</Text>
    </Pressable>
  </Box>
);
```

## Corresponding E2E Test

```typescript
test.describe("Profile Screen", () => {
  test.use({ viewport: VIEWPORT.desktop });

  test.beforeEach(async ({ auth }) => {
    await auth.login();
  });

  test("displays user information", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForLoadState("domcontentloaded");

    // Verify structural container
    await expect(page.getByTestId("profile:container")).toBeVisible();

    // Prefer accessible queries when available
    await expect(page.getByRole("heading")).toHaveText("John Doe");
    await expect(
      page.getByRole("button", { name: "Edit profile" })
    ).toBeVisible();

    // Use testID for elements without semantic roles
    await expect(page.getByTestId("profile:avatar")).toBeVisible();
  });
});
```

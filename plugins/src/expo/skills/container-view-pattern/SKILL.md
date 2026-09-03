---
name: container-view-pattern
description: This skill enforces the Container/View pattern for React components. It should be used when creating new components, validating existing components, or refactoring components to follow the separation of concerns pattern where Container handles logic and View handles presentation.
---

# Container/View Pattern

This skill provides guidance and validation for the Container/View component pattern used in this codebase.

## Pattern Overview

The Container/View pattern separates components into two distinct files:

- **Container** (`*Container.tsx`): Handles logic, state, API calls, data fetching, and event handlers
- **View** (`*View.tsx`): Handles rendering UI only, receiving all data and callbacks as props
- **Index** (`index.tsx`): Exports the Container as the default component

## Where This Pattern Applies

The Container/View pattern is **required** in these directories:

| Directory                | Applies | Notes                     |
| ------------------------ | ------- | ------------------------- |
| `features/*/components/` | Yes     | All feature components    |
| `features/*/screens/`    | Yes     | All feature screens       |
| `components/`            | Yes     | Shared components         |
| `screens/`               | Yes     | Shared screens            |
| `components/ui/`         | No      | UI primitives (GlueStack) |
| `components/shared/`     | No      | Simple shared utilities   |
| `components/icons/`      | No      | Icon components           |

## When to Use This Skill

- Creating a new component in any of the directories above
- Validating that existing components follow the pattern
- Refactoring a component to follow the pattern
- Reviewing code for pattern compliance

## Creating a New Component

### Option 1: Use the Skill Generator Script

Run the skill's generator script for any component type:

```bash
python3 "${CLAUDE_PLUGIN_ROOT:-node_modules/@codyswann/lisa/plugins/lisa-expo}/skills/container-view-pattern/scripts/create_component.py" <type> <name> [feature]
```

The `:-` default is load-bearing. This skill ships inside the Lisa plugin, not in
the consumer's `.claude/skills/`, and `CLAUDE_PLUGIN_ROOT` is not exported into
an agent's Bash environment — so a bare `.claude/skills/…` path names a file that
does not exist in a consumer, and a bare `"${CLAUDE_PLUGIN_ROOT}/…"` expands to
an absolute `/skills/…` and exits 1. The default resolves from the consumer
repository root, which is where the script is actually invoked.

**Component Types:**

| Type              | Command                                                          | Creates in                                      |
| ----------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| Global component  | `create_component.py global-component PlayerCard`                | `components/PlayerCard/`                        |
| Feature component | `create_component.py feature-component PlayerCard player-kanban` | `features/player-kanban/components/PlayerCard/` |
| Global screen     | `create_component.py global-screen Settings`                     | `screens/Settings/`                             |
| Feature screen    | `create_component.py feature-screen Main dashboard`              | `features/dashboard/screens/Main/`              |


### Option 2: Manual Creation

Create the following directory structure:

```
ComponentName/
├── ComponentNameContainer.tsx
├── ComponentNameView.tsx
└── index.tsx
```

## Container Component Requirements

Container components handle all business logic:

1. **Single View render**: A Container's **returned tree** is only its corresponding View component — no other UI elements beside it. This constrains what the Container renders, not what it holds: a Container may define a callback that returns JSX (a `renderItem` passed down as a prop is the common case), and that is where such a callback belongs once a View may no longer call hooks.
2. **State management**: Use `useState`, `useReducer`
3. **Data fetching**: Use GraphQL hooks, API calls
4. **Memoization**: Wrap all computed values in `useMemo`
5. **Event handlers**: Wrap all handlers in `useCallback` with proper dependencies
6. **Formatting**: All data transformation and formatting logic
7. **Conditional logic**: Determine what state to pass to View (loading, error, empty flags)

### Container Code Order (enforced by ESLint)

Containers must follow this specific order:

```tsx
const ExampleContainer = () => {
  // 1. Variables, state, useMemo, useCallback (same group)
  const [state, setState] = useState();
  const computed = useMemo(() => state * 2, [state]);
  const handleClick = useCallback(() => {}, []);

  // 2. useEffect hooks
  useEffect(() => {
    // side effects
  }, []);

  // 3. Return statement (always last)
  return <ExampleView />;
};
```

### Container Template

```tsx
import { useCallback, useMemo, useState } from "react";
import ComponentNameView from "./ComponentNameView";

/**
 * Props for the ComponentName component.
 */
interface ComponentNameProps {
  readonly id: string;
}

/**
 * Container component that manages state and logic for ComponentName.
 * @param props - Component properties
 * @param props.id - The unique identifier
 */
const ComponentNameContainer = ({ id }: ComponentNameProps) => {
  // State
  const [isLoading, setIsLoading] = useState(false);

  // Memoized computed values
  const formattedData = useMemo(() => {
    return data?.toUpperCase() ?? "";
  }, [data]);

  // Event handlers wrapped in useCallback
  const handleSubmit = useCallback(() => {
    setIsLoading(true);
  }, []);

  return (
    <ComponentNameView
      formattedData={formattedData}
      isLoading={isLoading}
      onSubmit={handleSubmit}
    />
  );
};

export default ComponentNameContainer;
```

## View Component Requirements

View components carry **no statements and no hooks**. That is the guarantee, and
it is deliberately narrower than "pure": `{Date.now()}` and
`{Math.random() > 0.5 ? … : …}` sit happily inside an expression body and no
rule below rejects them. Claiming purity here would repeat the defect this
section was rewritten to fix — see [Validation](#validation).

1. **Expression-bodied arrow function**: The View component must be
   `const XView = (props) => (...)`. Not `() => { return (...); }`, and not
   `function XView(props) { ... }` — a function declaration cannot have an
   expression body, so declaration form always carries a statement list. This is
   the requirement; the other two shapes are the two ways of failing it.
2. **No statements**: The component body is a single JSX expression.
3. **memo wrapper**: Export with `memo()` for performance optimization
4. **displayName**: Set `ComponentName.displayName = "ComponentName"`
5. **Readonly props**: All props should be marked as `readonly`
6. **No hooks anywhere in the file**: No call of the shape `use` + an uppercase
   letter — `useState`, `useEffect`, `useMemo`, `useCallback`, and every
   project-local custom hook alike. The ban is on the shape, not on a list of
   names: the call that motivated this gate was a project-local hook that no
   name list would have contained. `useMemo` and `useCallback` are caught for
   the same reason — a data hook and a render helper are indistinguishable by
   name, and this document already forbade `useMemo` in a View. There is no
   exemption list, no per-site waiver, and no opt-out flag; a View that calls a
   hook is fixed by moving the hook into the Container.
7. **No logic**: All conditional rendering should use ternary expressions in JSX.
   Unlike 1, 2 and 6, this one is **not lint-enforced** — see the second table
   under [Validation](#validation).

### View Template

```tsx
import { memo } from "react";

import { Box } from "@/components/ui/box";
import { Text } from "@/components/ui/text";

/**
 * Props for the ComponentNameView component.
 */
interface ComponentNameViewProps {
  readonly formattedData: string;
  readonly isLoading: boolean;
  readonly onSubmit: () => void;
}

/**
 * View component that renders the ComponentName UI.
 * @param props - Component properties
 * @param props.formattedData - Pre-formatted display data
 * @param props.isLoading - Loading state indicator
 * @param props.onSubmit - Submit handler callback
 */
const ComponentNameView = ({
  formattedData,
  isLoading,
  onSubmit,
}: ComponentNameViewProps) => (
  <Box testID="COMPONENT_NAME.CONTAINER">
    {isLoading ? <Text>Loading...</Text> : <Text>{formattedData}</Text>}
  </Box>
);

ComponentNameView.displayName = "ComponentNameView";

export default memo(ComponentNameView);
```

## Index File

Export the Container as the default:

```tsx
export { default } from "./ComponentNameContainer";
```

## Validation

### ESLint Rules

Each row names the numbered requirement it enforces. Every requirement above
appears in exactly one of the two tables, so a requirement with no rule is
visible as such rather than implied to be covered.

For most of this skill's life the table below listed four rules under the
heading "the following ESLint rules enforce the pattern" — and none of them
enforced requirement 6 or 7. That false assurance is why nobody checked, and why
a declaration-form View with a hook in it passed lint for years.

| Rule                                              | Enforces  | Description                                                       |
| ------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| `component-structure/enforce-component-structure` | structure | Validates directory structure and file naming                     |
| `component-structure/no-return-in-view`           | 1, 2      | View must be an arrow function with an expression body            |
| `component-structure/no-hooks-in-view`            | 6         | No `use[A-Z]…()` call anywhere in a View file, by shape not name  |
| `no-restricted-imports` (View files)              | 6         | No React hook named-import, and no `**/hooks/**` import           |
| `component-structure/require-memo-in-view`        | 3, 4      | Ensures View uses memo and displayName                            |
| `component-structure/single-component-per-file`   | structure | One component per file                                            |

`no-hooks-in-view` and `no-restricted-imports` are two independent axes, not one
duplicated: a hook re-exported through a barrel escapes the import patterns, and
an import with no call site yet escapes the call matcher.

### What lint does NOT enforce

| Requirement                       | Why not                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 5 — readonly props                | A convention on the props interface; carried by review and the templates above.                          |
| 7 — no logic beyond ternaries     | "Logic" has no AST shape. `{Date.now()}` and `{Math.random() > 0.5 ? … : …}` are legal expression bodies. |

### Manual Validation

Run the validation script to check a component:

```bash
python3 "${CLAUDE_PLUGIN_ROOT:-node_modules/@codyswann/lisa/plugins/lisa-expo}/skills/container-view-pattern/scripts/validate_component.py" <path-to-component-directory>
```

The script is a fast pre-check, not the gate: it reads one component directory
with regexes, while ESLint reads the AST of every file. When they disagree,
ESLint is right.

Run ESLint to check all components:

```bash
bun run lint
```

> **Note:** Replace `bun` with your project's package manager (`npm`, `yarn`, `pnpm`) as needed.

## Common Violations

### Container Violations

| Issue                                | Resolution                                                  |
| ------------------------------------ | ----------------------------------------------------------- |
| Returning UI elements besides View   | Container's returned tree is ONLY the corresponding View     |
| Rendering multiple components        | Move all UI to View; Container returns only View            |
| Missing `useMemo` for objects/arrays | Wrap computed values in `useMemo`                           |
| Missing `useCallback` for functions  | Wrap handlers in `useCallback`                              |
| Logic in View component              | Move logic to Container                                     |
| Inline function props                | Create memoized handler                                     |

### View Violations

| Issue                                | Resolution                                        |
| ------------------------------------ | ------------------------------------------------- |
| Using block body `{ return }`        | Convert to arrow shorthand `() => (...)`          |
| Declared as `function XView() {…}`   | Convert to `const XView = (props) => (...)`       |
| Missing `memo` wrapper               | Add `export default memo(ComponentView)`          |
| Missing `displayName`                | Add `ComponentView.displayName = "ComponentView"` |
| Contains hooks (including custom)    | Move hooks to Container                           |
| Contains state                       | Move state to Container                           |

## Extracting Helper Functions

When View components exceed ESLint's cognitive complexity threshold (28), extract render helper functions. For simple cases, prefer inline JSX:

```tsx
/**
 * Renders the loading skeleton state.
 * @param props - Helper function properties
 * @param props.isDark - Whether dark mode is active
 */
function renderLoadingState(props: { readonly isDark: boolean }) {
  const { isDark } = props;
  return <LoadingSkeleton isDark={isDark} />;
}

const ComponentView = ({ isLoading, isDark }: Props) => (
  <Box>{isLoading ? renderLoadingState({ isDark }) : <Content />}</Box>
);
```

A local render helper may be a function declaration. Requirement 1 is about the
**View component**, not about the word `function` appearing in the file — which
is why it is stated as "expression-bodied arrow" rather than as a ban on
declarations. The helper is still inside a View file, so requirement 6 applies to
it: it may not call a hook either.

## Event Handler Naming Convention

- **Container**: Use `handle*` prefix (e.g., `handleSubmit`, `handleClick`)
- **View props**: Use `on*` prefix (e.g., `onSubmit`, `onClick`)

```tsx
// Container
const handleSubmit = useCallback(() => { ... }, []);
return <ComponentView onSubmit={handleSubmit} />;

// View
const ComponentView = ({ onSubmit }: Props) => (
  <Button onPress={onSubmit}>Submit</Button>
);
```

## Reference Documentation

For detailed examples and edge cases, read:

- `references/patterns.md` - Common patterns and anti-patterns
- `references/examples.md` - Complete component examples

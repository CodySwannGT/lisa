# ESLint Plugin: Component Structure

Custom ESLint rules for enforcing component structure standards in the frontend.

## Rules

### enforce-component-structure

Enforces the Container/View pattern for React components by ensuring component directories contain exactly three files: `*Container.tsx`, `*View.tsx`, and `index.tsx`.

This rule helps maintain consistent component organization and separation of concerns throughout the codebase.

#### Rule Details

This rule checks component directories to ensure they follow the standard three-file structure:

- `ComponentNameContainer.tsx` - Contains logic, state, and data fetching
- `ComponentNameView.tsx` - Pure UI presentation receiving props only
- `index.tsx` - Default export of the Container

**Where does this rule apply?**

- Files in `features/**/components/` directories
- Files in `components/` directory
- **Excludes**: `components/ui/`, `components/shared/`, `components/icons/`

#### Configuration

In `.eslintrc.json`:

```json
{
  "rules": {
    "component-structure/enforce-component-structure": "error"
  }
}
```

---

### no-return-in-view

Requires a View component to be an arrow function with an **expression body**.

#### Rule Details

Stated as a required shape rather than as "no return statements", because a
`FunctionDeclaration` cannot have an expression body — so requiring one bans
declaration form by construction, with no prose scanning and no false-positive
surface.

That distinction is the bug this rule shipped with. It registered a single
`ArrowFunctionExpression` visitor, and nothing anywhere required a View to be an
arrow function, so:

```typescript
const HomeScreenView = ({ label }) => { return <Box />; };  // reported
function HomeScreenView({ label }) { return <Box />; }      // never visited
```

Writing `function` instead of `const` was a complete, silent opt-out, with
`require-memo-in-view` still passing because it checks the export.

What the rule guarantees is **no statement list**. It is not a purity gate:
`{Date.now()}` and `{Math.random() > 0.5 ? … : …}` are legal expression bodies.
Hooks are the other half — see `no-hooks-in-view`.

**Where does this rule apply?**

- Files matching `*View.tsx`, `*View.jsx`
- In `features/**/components/`, `features/**/screens/`, and `components/`
- **Excludes**: `components/ui/`, `components/custom/ui/`

#### Configuration

In `.eslintrc.json`:

```json
{
  "rules": {
    "component-structure/no-return-in-view": "error"
  }
}
```

---

### no-hooks-in-view

Disallows any hook call anywhere in a View component file.

#### Rule Details

The matcher is a **shape** — `use` followed by an uppercase letter, called — and
never a list of names. The call that motivated this rule was a project-local
custom hook, which any enumerated list would have missed.

That is also why there is no exemption list: a custom data hook and a render
helper are indistinguishable by name, so `useMemo` and `useCallback` are caught
too. Both the bare call (`useFlag()`) and the namespaced one (`React.useMemo()`)
are matched.

Scope is the file, not the component body — a hook called from a local render
helper still runs during that View's render.

❌ **Incorrect**:

```typescript
// HomeScreenView.tsx — already in the shape no-return-in-view demands
const HomeScreenView = ({ label }) => (
  <Box>{useCreateNoteQuickActionEnabled() ? <Text>{label}</Text> : null}</Box>
);
```

✅ **Correct** — the hook moves to the Container and its result arrives as a prop:

```typescript
const HomeScreenView = ({ label, isQuickActionEnabled }) => (
  <Box>{isQuickActionEnabled ? <Text>{label}</Text> : null}</Box>
);
```

**Where does this rule apply?**

- Files matching `*View.tsx`, `*View.jsx`
- In `features/**/components/`, `features/**/screens/`, and `components/`
- **Excludes**: `components/ui/`, `components/custom/ui/`

Pair it with `no-restricted-imports` on the same files to catch the import line
before a call site exists. The two are independent axes: a hook re-exported
through a barrel escapes the import patterns, and an import with no call yet
escapes this rule.

#### Configuration

In `.eslintrc.json`:

```json
{
  "rules": {
    "component-structure/no-hooks-in-view": "error"
  }
}
```

---

### require-memo-in-view

Enforces the use of `React.memo()` for View components to optimize rendering performance.

#### Rule Details

All View components should be wrapped with `React.memo()` to prevent unnecessary re-renders when props haven't changed.

**Where does this rule apply?**

- Files matching `*View.tsx`, `*View.jsx`
- **Excludes**: `components/ui/` directory

#### Configuration

In `.eslintrc.json`:

```json
{
  "rules": {
    "component-structure/require-memo-in-view": "error"
  }
}
```

---

### single-component-per-file

Enforces one React component per file to improve code organization and maintainability.

#### Rule Details

This rule ensures that each file contains exactly one React component. Multiple components in a single file make code harder to navigate, test, and maintain.

**What is considered a React component?**

- Any function with PascalCase naming that returns JSX
- This includes components wrapped with `memo()` or `React.memo()`
- Both arrow functions and function declarations

**Where does this rule apply?**

- Files matching `*View.tsx`, `*View.jsx`, `*Container.tsx`, `*Container.jsx`
- In `features/**/components/` directories
- In `components/` directory
- **Excludes**: `components/ui/`, `components/shared/`, `components/icons/`

#### Examples

❌ **Incorrect** (multiple components):

```typescript
// MessageListView.tsx
const MessageItem = ({ item }) => <div>{item}</div>;

const MessageListView = ({ messages }) => (
  <div>
    {messages.map(msg => <MessageItem item={msg} />)}
  </div>
);

export default MessageListView;
```

✅ **Correct** (one component per file):

```typescript
// MessageItem.tsx
const MessageItem = ({ item }) => <div>{item}</div>;
export default MessageItem;

// MessageListView.tsx
import MessageItem from "./MessageItem";

const MessageListView = ({ messages }) => (
  <div>
    {messages.map(msg => <MessageItem item={msg} />)}
  </div>
);

export default MessageListView;
```

#### Configuration

In `.eslintrc.json`:

```json
{
  "rules": {
    "component-structure/single-component-per-file": "error"
  }
}
```

#### When to Disable

This rule should rarely be disabled. If you have a valid use case, use an inline comment:

```typescript
/* eslint-disable component-structure/single-component-per-file --
   Reason: These components are tightly coupled and only used together
*/
```

## Installation

This plugin is installed locally as a file dependency:

```json
{
  "devDependencies": {
    "eslint-plugin-component-structure": "file:./eslint-plugin-component-structure"
  }
}
```

## Usage

### ESLint 9 Flat Config (Recommended)

```javascript
// eslint.config.mjs
import componentStructurePlugin from './eslint-plugin-component-structure/index.js';

export default [
  {
    plugins: {
      'component-structure': componentStructurePlugin,
    },
    rules: {
      'component-structure/enforce-component-structure': 'error',
      'component-structure/no-hooks-in-view': 'error',
      'component-structure/no-return-in-view': 'error',
      'component-structure/require-memo-in-view': 'error',
      'component-structure/single-component-per-file': 'error',
    },
  },
];
```

### Legacy Config (.eslintrc.json)

```json
{
  "plugins": ["component-structure"],
  "rules": {
    "component-structure/enforce-component-structure": "error",
    "component-structure/no-hooks-in-view": "error",
    "component-structure/no-return-in-view": "error",
    "component-structure/require-memo-in-view": "error",
    "component-structure/single-component-per-file": "error"
  }
}
```

## Version

1.0.0

## Contributing

When adding new rules to this plugin:

1. Create the rule implementation in `rules/`
2. Add comprehensive tests in `__tests__/`
3. Export the rule in `index.js`
4. Update this README with rule documentation
5. Add the rule to `.eslintrc.json` configuration

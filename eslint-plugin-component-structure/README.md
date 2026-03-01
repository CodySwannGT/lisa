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

Prevents early returns and conditional logic in View components to maintain pure presentation components.

#### Rule Details

View components should only contain JSX presentation logic. Any conditional rendering or early returns should be handled in the Container component or passed as props.

**Where does this rule apply?**

- Files matching `*View.tsx`, `*View.jsx`

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

# eslint-plugin-code-organization

ESLint plugin to enforce code organization standards for the PropSwap frontend application.

## Rules

### `enforce-statement-order`

Enforces the standard statement order in all functions:

1. **Definitions** - Variable declarations (`const`, `let`, `var`) and function declarations
2. **Side effects** - Expression statements that are function calls
3. **Return statement** - Final return

This rule applies to all functions: React components, hooks, utilities, and plain JavaScript functions.

**Examples:**

❌ Incorrect - side effect before definition:

```javascript
function process() {
  initialize(); // Side effect
  const config = getConfig(); // Definition after side effect - WRONG
  return config;
}
```

❌ Incorrect - definition after side effect (React):

```typescript
const useExample = () => {
  useEffect(() => {}, []); // Side effect

  const data = useMemo(() => [], []); // Definition after side effect - WRONG

  return data;
};
```

✅ Correct - Proper order:

```javascript
function process() {
  // 1. Definitions
  const config = getConfig();
  const options = { debug: true };

  // 2. Side effects
  initialize();
  logger.info("starting");

  // 3. Return
  return config;
}
```

✅ Correct - React hook with proper order:

```typescript
const useExample = () => {
  // 1. Definitions
  const [state, setState] = useState(null);
  const data = useMemo(() => [], []);
  const handleClick = useCallback(() => {}, []);

  // 2. Side effects
  useEffect(() => {}, []);

  // 3. Return
  return data;
};
```

## Installation

This plugin is installed locally as a file dependency:

```json
{
  "devDependencies": {
    "eslint-plugin-code-organization": "file:./eslint-plugin-code-organization"
  }
}
```

## Usage

### ESLint 9 Flat Config (Recommended)

```javascript
// eslint.config.mjs
import codeOrganizationPlugin from './eslint-plugin-code-organization/index.js';

export default [
  {
    plugins: {
      'code-organization': codeOrganizationPlugin,
    },
    rules: {
      'code-organization/enforce-statement-order': 'error',
    },
  },
];
```

### Legacy Config (.eslintrc.json)

```json
{
  "plugins": ["code-organization"],
  "rules": {
    "code-organization/enforce-statement-order": "error"
  }
}
```

## Special Cases

### Guard Clauses

If statements (often used for early returns/guard clauses) are intentionally excluded from this rule. They can appear anywhere in the function:

```typescript
function processUser(userId: string) {
  // Guard clause - allowed anywhere
  if (!userId) {
    return null;
  }

  const user = getUser(userId);
  validateUser(user);
  return user;
}
```

### React Hooks

For React hooks, the definitions category includes:
- `useState`, `useRef`, `useMemo`, `useCallback` (return values to variables)
- Any hook that returns a value assigned to a variable

Side effects include:
- `useEffect`, `useLayoutEffect` (no return value used)
- Any expression statement with function calls

## Version

1.0.0

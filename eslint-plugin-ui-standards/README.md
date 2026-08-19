# ESLint Plugin: UI Standards

Custom ESLint rules for enforcing UI-related coding standards in React Native applications.

## Rules

### no-classname-outside-ui

Restricts the use of `className` prop to designated UI component directories.

#### Rule Details

This rule ensures that `className` (used with Tailwind/NativeWind) is only used in reusable UI components. Business components should use semantic props instead of styling classes.

**Why this rule exists:**
- Keeps styling concerns in UI layer components
- Business components remain style-agnostic
- Makes component APIs more semantic and maintainable
- Facilitates design system consistency

**Where is className allowed?**
- `components/ui/` - Core UI components
- `components/custom/ui/` - Custom UI components

#### Examples

**Incorrect** (className in business component):

```tsx
// features/user/components/ProfileCard/ProfileCardView.tsx
const ProfileCardView = ({ user }) => (
  <View className="p-4 bg-white rounded-lg">  {/* className here - NOT allowed */}
    <Text className="text-lg font-bold">{user.name}</Text>
  </View>
);
```

**Correct** (using UI components with semantic props):

```tsx
// features/user/components/ProfileCard/ProfileCardView.tsx
import { Card, Heading } from '@/components/ui';

const ProfileCardView = ({ user }) => (
  <Card variant="elevated">
    <Heading size="lg">{user.name}</Heading>
  </Card>
);
```

**Correct** (className in UI component):

```tsx
// components/ui/Card/CardView.tsx
const CardView = ({ variant, children }) => (
  <View className={cn("rounded-lg", variants[variant])}>
    {children}
  </View>
);
```

#### Configuration

```javascript
// eslint.config.mjs
{
  rules: {
    'ui-standards/no-classname-outside-ui': ['error', {
      allowedPaths: ['/components/ui/', '/components/custom/ui/']
    }]
  }
}
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowedPaths` | `string[]` | `['/components/ui/', '/components/custom/ui/']` | Paths where className is allowed |

---

### no-direct-rn-imports

Prevents direct imports from `react-native` to encourage use of wrapped UI components.

#### Rule Details

This rule blocks direct imports from `react-native` in favor of using the project's UI component library. This ensures:

- Consistent styling across the app
- Ability to swap underlying implementations
- Centralized accessibility handling
- Design system compliance

**What's blocked?**
- `import { View, Text, ... } from 'react-native'`

**What to use instead?**
- `import { View, Text, ... } from '@/components/ui'`

#### Examples

**Incorrect:**

```tsx
import { View, Text, TouchableOpacity } from 'react-native';

const MyComponent = () => (
  <View>
    <Text>Hello</Text>
    <TouchableOpacity onPress={handlePress}>
      <Text>Click me</Text>
    </TouchableOpacity>
  </View>
);
```

**Correct:**

```tsx
import { View, Text, Button } from '@/components/ui';

const MyComponent = () => (
  <View>
    <Text>Hello</Text>
    <Button onPress={handlePress}>Click me</Button>
  </View>
);
```

#### Configuration

```javascript
// eslint.config.mjs
{
  rules: {
    'ui-standards/no-direct-rn-imports': 'error'
  }
}
```

**Allowed directories:**
- `components/ui/` - UI wrappers need to import from react-native
- `components/custom/ui/` - Custom UI components

---

### no-unbound-design-value

Flags a hardcoded style value in an axis that has a published design-variable
collection behind it.

#### Rule Details

Design handoff has one rule: **values come from design variables where a variable
system exists.** Visual measurement is supplemental there, and legitimate as the
primary source where no variable system exists.

The regime is resolved **per axis, not per project**. A library with a mature
colour system and no spacing scale is the common case, and it has to work:
colour is bound and a literal is a defect, while spacing is measured and a
literal is correct — in the same file, on the same day.

**Regime-awareness is by declaration, not by live query.** ESLint cannot ask a
design tool which collections are published, so the typed axes arrive as the
`typedAxes` option, mirroring `design.tokens.axes` in `.lisa.config.json`. The
default is the empty list, so **an unconfigured project sees nothing**. That
silence is deliberate: a rule that fires on every project is indistinguishable
from no rule at all, because the first thing anyone does is switch it off.

The rule answers only the objective question — is a value in a typed axis
written as a literal? It never judges whether a design is ambiguous or ugly.
That is an opinion, and an agent asked for one blocks on everything or nothing.

**Axes:** `color`, `spacing`, `typography`, `radius`, `elevation`, `motion`.

**Surfaces covered:** style-object properties (`StyleSheet.create`, inline style
objects, theme objects), JSX attributes, and `styled`/`css` tagged-template
bodies — whose declarations live inside a string and are invisible to a
property-name visitor.

**Not covered:** stylesheet files (`.css`, `.scss`) — ESLint does not parse them.

#### Examples

Given `typedAxes: ["color", "radius"]` — colour and radius are published, spacing
is not:

**Incorrect** (a literal in a typed axis):

```tsx
const styles = StyleSheet.create({
  card: { backgroundColor: "#3A7BD5", borderRadius: 12 },
});
```

**Correct** (bound in the typed axes, measured in the untyped one):

```tsx
const styles = StyleSheet.create({
  card: {
    backgroundColor: tokens.surface.raised,
    borderRadius: tokens.radius.card,
    padding: 12, // spacing has no variable collection — measuring is the source
  },
});
```

#### Configuration

```javascript
// eslint.config.local.ts
{
  rules: {
    "ui-standards/no-unbound-design-value": ["error", {
      typedAxes: ["color", "radius"],
    }],
  },
}
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `typedAxes` | `string[]` | `[]` | Axes with a published variable collection. Empty means the rule reports nothing. |
| `ignoreValues` | `(string \| number)[]` | `[0, 1]` | Values never worth a token — a zero is the absence of a value, a one is a hairline. |
| `tokenSourcePaths` | `string[]` | `["/theme/", "/themes/", "/tokens/", "/design-system/", "/design-tokens/"]` | Path fragments where literals belong, because those files mirror the published variables. |

This rule is the executable rung of the design-handoff policy. The judgment rung
— regime detection against the live variable collections, the five block
conditions, and escalation of a blocked item — lives in the `lisa-design-intake`
skill (`/lisa:design:intake`).

---

## Installation

This plugin is installed locally as a file dependency:

```json
{
  "devDependencies": {
    "eslint-plugin-ui-standards": "file:./eslint-plugin-ui-standards"
  }
}
```

## Usage with ESLint 9 Flat Config

```javascript
// eslint.config.mjs
import uiStandardsPlugin from './eslint-plugin-ui-standards/index.js';

export default [
  {
    plugins: {
      'ui-standards': uiStandardsPlugin,
    },
    rules: {
      'ui-standards/no-classname-outside-ui': 'error',
      'ui-standards/no-direct-rn-imports': 'error',
      'ui-standards/no-unbound-design-value': ['error', { typedAxes: ['color'] }],
    },
  },
];
```

## Contributing

When adding new rules:

1. Create rule implementation in `rules/`
2. Add tests in `__tests__/`
3. Export in `index.js`
4. Document in this README
5. Add to ESLint configuration

## Version

1.0.0

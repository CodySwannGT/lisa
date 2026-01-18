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

### no-inline-styles

Prevents inline style objects in favor of className-based styling.

#### Rule Details

This rule prohibits inline `style` props with object literals. All styling should use className with Tailwind/NativeWind classes.

**Why this rule exists:**
- Inline styles bypass the design system
- Harder to maintain consistency
- NativeWind provides better performance
- Enables theme support

#### Examples

**Incorrect:**

```tsx
const MyView = () => (
  <View style={{ padding: 16, backgroundColor: 'white' }}>
    <Text style={{ fontSize: 18, fontWeight: 'bold' }}>Title</Text>
  </View>
);
```

**Incorrect** (StyleSheet is also discouraged):

```tsx
const styles = StyleSheet.create({
  container: { padding: 16 }
});

const MyView = () => (
  <View style={styles.container}>
    <Text>Content</Text>
  </View>
);
```

**Correct:**

```tsx
const MyView = () => (
  <View className="p-4 bg-white">
    <Text className="text-lg font-bold">Title</Text>
  </View>
);
```

#### Configuration

```javascript
// eslint.config.mjs
{
  rules: {
    'ui-standards/no-inline-styles': 'error'
  }
}
```

**Allowed exceptions:**
- Dynamic styles computed at runtime (with eslint-disable comment)
- Animation styles (Reanimated)

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
      'ui-standards/no-inline-styles': 'error',
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

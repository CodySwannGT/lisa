---
name: directory-structure
description: "This skill enforces the…"
---

# Directory Structure Enforcement

## Overview

This skill ensures all new code follows the documented directory structure standards. It validates file placement, enforces the Container/View pattern, and ensures proper organization of features, components, and tests.

## When to Use

- Creating new components or screens
- Adding new features
- Creating hooks, utilities, or stores
- Adding test files
- Moving or restructuring existing code
- Reviewing file placement decisions

## Root Directory Structure

Expo SDK 55+/56 adopts the `/src` convention: all **application source** lives
under `src/`, while config, assets, tests, and tooling stay at the project root.
Older projects keep source at the root. The structure below shows the `/src`
layout; for a root-layout project, read `src/<dir>` as `<dir>`. The `@/*`
TypeScript path alias points at `./src/*` (or `./*` for root layout), so imports
are identical either way. The validator and lint/coverage configs auto-detect a
`src/` directory.

```
<project-root>/
├── src/                    # APPLICATION SOURCE (SDK 55+/56 /src convention)
│   ├── app/                # Expo Router - THIN WRAPPERS ONLY
│   ├── features/           # Feature modules - PRIMARY CODE LOCATION
│   ├── components/         # Shared components
│   │   ├── ui/             # GlueStack UI primitives
│   │   ├── icons/          # Icon components
│   │   ├── custom/         # Custom UI components
│   │   └── [ComponentName]/ # Feature-agnostic components
│   ├── hooks/              # Global hooks (with __tests__/)
│   ├── providers/          # Global React context providers (with __tests__/)
│   ├── stores/             # Global state - Apollo reactive variables (with __tests__/)
│   ├── utils/              # Utility functions (with __tests__/)
│   ├── lib/                # Utility libraries / integrations
│   ├── types/              # Global TypeScript types
│   ├── generated/          # Auto-generated GraphQL types (DO NOT EDIT)
│   ├── config/             # Configuration files
│   └── constants/          # Global constants
├── assets/                 # Static assets (fonts/, icons/, css/) — STAYS AT ROOT
├── e2e/                    # End-to-end tests (fixtures/, pages/, tests/, utils/) — STAYS AT ROOT
├── scripts/                # Build and development scripts — STAYS AT ROOT
├── public/                 # Public web assets — STAYS AT ROOT
├── __mocks__/              # Jest manual mocks — STAYS AT ROOT
├── docs/                   # Documentation — STAYS AT ROOT
└── projects/               # Project-specific files (archive/) — STAYS AT ROOT
```

## Feature Module Structure

Each feature in `features/` MUST follow this structure:

```
features/[feature-name]/
├── components/             # Feature-specific components
│   └── [ComponentName]/    # Each component in its own directory
│       ├── [ComponentName]Container.tsx
│       ├── [ComponentName]View.tsx
│       └── index.tsx
├── screens/                # Screen components (same pattern as components)
│   └── [ScreenName]/
│       ├── [ScreenName]Container.tsx
│       ├── [ScreenName]View.tsx
│       └── index.tsx
├── hooks/                  # Feature-specific hooks
│   └── __tests__/          # Hook tests
├── stores/                 # Feature state (Apollo reactive variables)
├── utils/                  # Feature utilities
│   └── __tests__/          # Utility tests
├── types.ts                # Feature TypeScript types
├── constants.ts            # Feature constants
├── config/                 # Feature configuration
└── operations.graphql      # GraphQL queries/mutations
```

## Container/View Pattern Rules

Components and screens MUST follow the Container/View pattern:

### Container (`[Name]Container.tsx`)

- Contains ALL business logic
- Uses hooks (useState, useEffect, useCallback, useMemo)
- Manages state and side effects
- Passes data and handlers as props to View
- ONLY renders the corresponding View component

### View (`[Name]View.tsx`)

- Pure presentation component
- Receives ALL data via props
- MUST be wrapped in `memo()`
- NO business logic or hooks (except UI-specific like useRef for scroll)
- Handles conditional rendering (loading, error, empty, populated states)

### Index (`index.tsx`)

- Exports the Container as default
- May export types if needed

### Example Structure

```typescript
// PlayerCard/PlayerCardContainer.tsx
export const PlayerCardContainer = () => {
  const { data, loading } = useQuery(GET_PLAYER);
  const handleClick = useCallback(() => {}, []);
  return <PlayerCardView data={data} loading={loading} onClick={handleClick} />;
};

// PlayerCard/PlayerCardView.tsx
export const PlayerCardView = memo(({ data, loading, onClick }: Props) => {
  if (loading) return <Skeleton />;
  return <Pressable onPress={onClick}>...</Pressable>;
});

// PlayerCard/index.tsx
export { PlayerCardContainer as default } from './PlayerCardContainer';
```

## App Directory Rules

The `app/` directory contains Expo Router file-based routing. Route files MUST be thin wrappers:

### Correct Pattern

```typescript
// app/(root)/(tabs)/players/[playerId]/index.tsx
import { Main } from "@/features/player-detail/screens/Main";

export default function PlayerDetailScreen() {
  return <Main />;
}
```

### Violations

- Business logic in route files
- Component definitions in route files
- Hooks usage beyond route params
- Direct UI rendering beyond wrapper

## Test File Placement

Test files MUST be placed in `__tests__/` subdirectories:

```
hooks/
├── usePlayer.ts
└── __tests__/
    └── usePlayer.test.ts

utils/
├── formatDate.ts
└── __tests__/
    └── formatDate.test.ts
```

### Test File Naming

- Unit tests: `*.test.ts` or `*.test.tsx`
- Spec tests: `*.spec.ts` or `*.spec.tsx`

## Validation Script

To validate directory structure, run the validation script:

```bash
python3 .claude/skills/directory-structure/scripts/validate_structure.py [path]
```

The script checks:

1. Feature module structure completeness
2. Container/View pattern compliance
3. Test file placement in `__tests__/` directories
4. Route file thin wrapper compliance
5. Proper naming conventions

## Quick Reference

| File Type           | Correct Location                        |
| ------------------- | --------------------------------------- |
| Feature component   | `features/[feature]/components/[Name]/` |
| Feature screen      | `features/[feature]/screens/[Name]/`    |
| Feature hook        | `features/[feature]/hooks/`             |
| Feature test        | `features/[feature]/hooks/__tests__/`   |
| Global hook         | `hooks/`                                |
| Global hook test    | `hooks/__tests__/`                      |
| Shared component    | `components/[Name]/`                    |
| UI primitive        | `components/ui/`                        |
| Global utility      | `utils/`                                |
| Global utility test | `utils/__tests__/`                      |
| Route wrapper       | `app/(root)/...`                        |
| GraphQL types       | `generated/` (auto-generated)           |

## Common Mistakes to Avoid

1. **Placing feature code in `app/`** - Route files are wrappers only
2. **Test files alongside source** - Must be in `__tests__/` subdirectory
3. **Missing Container/View split** - Every component needs both files
4. **Business logic in View** - Views are pure presentation only
5. **Multiple components per file** - One component per file, enforced by ESLint
6. **Barrel exports** - Never use index.ts to re-export multiple components

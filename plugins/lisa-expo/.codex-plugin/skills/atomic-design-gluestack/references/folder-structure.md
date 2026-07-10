# Folder Structure Reference

## Complete Directory Structure

```
acme-frontend/
├── app/                                    # Expo Router - PAGES live here
│   ├── (auth)/                            # Auth route group
│   │   ├── login.tsx                      # Login page
│   │   ├── register.tsx                   # Register page
│   │   └── _layout.tsx                    # Auth layout
│   ├── (tabs)/                            # Tab route group
│   │   ├── index.tsx                      # Home page
│   │   ├── profile.tsx                    # Profile page
│   │   └── _layout.tsx                    # Tab layout
│   └── _layout.tsx                        # Root layout
│
├── components/
│   ├── ui/                                # Gluestack UI library (DO NOT MODIFY)
│   │   ├── accordion/
│   │   ├── actionsheet/
│   │   ├── alert/
│   │   ├── alert-dialog/
│   │   ├── avatar/
│   │   ├── badge/
│   │   ├── box/
│   │   ├── button/
│   │   ├── card/
│   │   ├── center/
│   │   ├── checkbox/
│   │   ├── divider/
│   │   ├── drawer/
│   │   ├── form-control/
│   │   ├── gluestack-ui-provider/         # Theme config lives here
│   │   │   └── config.ts                  # Design tokens
│   │   ├── grid/
│   │   ├── heading/
│   │   ├── hstack/
│   │   ├── icon/
│   │   ├── image/
│   │   ├── input/
│   │   ├── link/
│   │   ├── menu/
│   │   ├── modal/
│   │   ├── popover/
│   │   ├── pressable/
│   │   ├── progress/
│   │   ├── radio/
│   │   ├── select/
│   │   ├── slider/
│   │   ├── spinner/
│   │   ├── switch/
│   │   ├── text/
│   │   ├── textarea/
│   │   ├── toast/
│   │   ├── tooltip/
│   │   └── vstack/
│   │
│   ├── atoms/                             # Project-specific atoms
│   │   ├── AppLogo/
│   │   │   ├── index.tsx                  # Main component
│   │   │   ├── AppLogo.test.tsx           # Unit tests
│   │   │   └── types.ts                   # TypeScript types
│   │   ├── BrandIcon/
│   │   │   └── ...
│   │   └── index.ts                       # Barrel export
│   │
│   ├── molecules/                         # Simple compositions
│   │   ├── SearchField/
│   │   │   ├── index.tsx                  # Container (if needed)
│   │   │   ├── SearchFieldView.tsx        # View component
│   │   │   ├── SearchField.test.tsx       # Tests
│   │   │   └── types.ts                   # Types
│   │   ├── FormField/
│   │   │   └── ...
│   │   ├── AvatarWithName/
│   │   │   └── ...
│   │   └── index.ts                       # Barrel export
│   │
│   ├── organisms/                         # Complex sections
│   │   ├── Header/
│   │   │   ├── index.tsx                  # Container
│   │   │   ├── HeaderView.tsx             # View
│   │   │   ├── Header.test.tsx            # Tests
│   │   │   ├── useHeader.ts               # Hook (if needed)
│   │   │   └── types.ts                   # Types
│   │   ├── ProductCard/
│   │   │   └── ...
│   │   ├── NavigationDrawer/
│   │   │   └── ...
│   │   └── index.ts                       # Barrel export
│   │
│   ├── templates/                         # Page layouts
│   │   ├── MainLayout/
│   │   │   ├── index.tsx                  # Layout component
│   │   │   ├── MainLayoutView.tsx         # View
│   │   │   └── types.ts                   # Types
│   │   ├── AuthLayout/
│   │   │   └── ...
│   │   ├── DashboardLayout/
│   │   │   └── ...
│   │   └── index.ts                       # Barrel export
│   │
│   └── shared/                            # Cross-cutting components
│       └── ...
│
├── features/                              # Feature modules
│   └── [feature-name]/
│       ├── components/                    # Feature-specific components
│       │   ├── atoms/                     # Feature atoms
│       │   │   └── ...
│       │   ├── molecules/                 # Feature molecules
│       │   │   └── ...
│       │   └── organisms/                 # Feature organisms
│       │       └── ...
│       ├── screens/                       # Feature pages (if not in app/)
│       │   └── ...
│       ├── hooks/                         # Feature hooks
│       │   └── ...
│       └── types/                         # Feature types
│           └── ...
│
└── hooks/                                 # Global hooks
    └── ...
```

## File Naming Conventions

### Component Files

| File | Purpose | Example |
|------|---------|---------|
| `index.tsx` | Main export / Container | `components/molecules/SearchField/index.tsx` |
| `*View.tsx` | View component (presentation) | `SearchFieldView.tsx` |
| `*.test.tsx` | Unit/integration tests | `SearchField.test.tsx` |
| `types.ts` | TypeScript interfaces | `types.ts` |
| `use*.ts` | Custom hook | `useSearchField.ts` |

### Platform-Specific Files

| Suffix | Platform | Example |
|--------|----------|---------|
| `.native.tsx` | iOS + Android | `Button.native.tsx` |
| `.web.tsx` | Web only | `Button.web.tsx` |
| `.ios.tsx` | iOS only | `Button.ios.tsx` |
| `.android.tsx` | Android only | `Button.android.tsx` |

## Import Patterns

### Path Aliases (from tsconfig.json)

```typescript
// Recommended imports
import { Button, Text } from "@/components/ui/button";
import { SearchField } from "@/components/molecules/SearchField";
import { Header } from "@/components/organisms/Header";
import { MainLayout } from "@/components/templates/MainLayout";

// Feature imports
import { useAuth } from "@/features/auth/hooks/useAuth";
import { LoginForm } from "@/features/auth/components/organisms/LoginForm";
```

### Barrel Exports

Each atomic level folder should have an `index.ts` barrel:

```typescript
// components/atoms/index.ts
export { AppLogo } from "./AppLogo";
export { BrandIcon } from "./BrandIcon";
export type { AppLogoProps } from "./AppLogo/types";
export type { BrandIconProps } from "./BrandIcon/types";

// components/molecules/index.ts
export { SearchField } from "./SearchField";
export { FormField } from "./FormField";
// ... etc
```

### Import Rules

1. **Atoms** can only import:
   - Other atoms from `@/components/ui/`
   - Design tokens from `@/components/ui/gluestack-ui-provider/config`
   - Utility functions from `@/utils/`

2. **Molecules** can only import:
   - Atoms from `@/components/ui/` or `@/components/atoms/`
   - Other molecules (sparingly)
   - Utility functions

3. **Organisms** can only import:
   - Atoms
   - Molecules
   - Other organisms (sparingly)
   - Feature hooks

4. **Templates** can only import:
   - Atoms
   - Molecules
   - Organisms
   - Layout utilities

5. **Pages** can import:
   - Everything above
   - Data fetching hooks (Apollo queries/mutations)
   - Global state (Context)

## Creating New Components

### Checklist for New Atom

```bash
components/atoms/MyAtom/
├── index.tsx          # Required
├── MyAtom.test.tsx    # Required
└── types.ts           # Required if props > 3
```

### Checklist for New Molecule

```bash
components/molecules/MyMolecule/
├── index.tsx              # Container (optional if no logic)
├── MyMoleculeView.tsx     # Required
├── MyMolecule.test.tsx    # Required
└── types.ts               # Required
```

### Checklist for New Organism

```bash
components/organisms/MyOrganism/
├── index.tsx              # Container (handles state/logic)
├── MyOrganismView.tsx     # View (presentation only)
├── MyOrganism.test.tsx    # Required
├── useMyOrganism.ts       # Optional custom hook
└── types.ts               # Required
```

### Checklist for New Template

```bash
components/templates/MyLayout/
├── index.tsx              # Layout component
├── MyLayoutView.tsx       # View with slots
└── types.ts               # Required
```

### Checklist for New Page

```bash
app/my-page.tsx            # Expo Router page
# OR
features/my-feature/screens/MyScreen.tsx
```

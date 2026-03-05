# Platform-Specific File Extensions

This reference documents Metro bundler's platform-specific file extension resolution for Expo/React Native projects.

## Table of Contents

- [Available Extensions](#available-extensions)
- [Resolution Order](#resolution-order)
- [Usage in app/ Directory](#usage-in-app-directory)
- [Usage Outside app/ Directory](#usage-outside-app-directory)
- [Patterns and Examples](#patterns-and-examples)
- [TypeScript Considerations](#typescript-considerations)

## Available Extensions

| Extension      | Platforms     | Description                  |
| -------------- | ------------- | ---------------------------- |
| `.ios.tsx`     | iOS only      | iPhone and iPad              |
| `.android.tsx` | Android only  | Android phones and tablets   |
| `.native.tsx`  | iOS + Android | Shared native implementation |
| `.web.tsx`     | Web only      | Browser environments         |
| `.tsx`         | All platforms | Universal fallback           |

## Resolution Order

Metro resolves files in this priority order:

### For iOS Build:

1. `Component.ios.tsx`
2. `Component.native.tsx`
3. `Component.tsx`

### For Android Build:

1. `Component.android.tsx`
2. `Component.native.tsx`
3. `Component.tsx`

### For Web Build:

1. `Component.web.tsx`
2. `Component.tsx`

**Note:** `.native.tsx` is NOT resolved on web. Web only looks for `.web.tsx` or the base `.tsx`.

## Usage in app/ Directory

### Requirement: Base Version Required

Platform-specific files in Expo Router's `app/` directory **must have a corresponding base version** to ensure route universality for deep linking.

```
app/
├── _layout.tsx          ✅ Required base
├── _layout.web.tsx      ✅ Web override
├── index.tsx            ✅ Required base
├── settings.tsx         ✅ Required base
├── settings.native.tsx  ✅ Native override
└── about.web.tsx        ❌ Missing base! Will cause issues
```

### Valid Combinations

```
# Layout with web override
_layout.tsx + _layout.web.tsx          ✅

# Screen with native override
profile.tsx + profile.native.tsx       ✅

# Screen with all platforms
dashboard.tsx                          ✅ (base only)
dashboard.tsx + dashboard.web.tsx      ✅
dashboard.tsx + dashboard.ios.tsx + dashboard.android.tsx  ✅
```

### Invalid Combinations

```
# Missing base file
_layout.web.tsx (no _layout.tsx)       ❌

# Orphaned platform file
settings.ios.tsx (no settings.tsx)     ❌
```

## Usage Outside app/ Directory

Files outside the `app/` directory have more flexibility and do not require base versions.

### Components Directory

```
components/
├── Button/
│   ├── ButtonContainer.tsx      # Shared container logic
│   ├── ButtonView.tsx           # Default/fallback view
│   ├── ButtonView.web.tsx       # Web-specific view
│   └── index.tsx                # Exports container
│
├── DatePicker/
│   ├── DatePickerContainer.tsx
│   ├── DatePickerView.native.tsx  # iOS + Android
│   ├── DatePickerView.web.tsx     # Web
│   └── index.tsx
│
└── Camera/
    ├── CameraContainer.tsx
    ├── CameraView.ios.tsx         # iOS only
    ├── CameraView.android.tsx     # Android only
    ├── CameraView.web.tsx         # Web only
    └── index.tsx
```

### Hooks Directory

```
hooks/
├── useCamera.ts           # Shared hook interface
├── useCamera.native.ts    # Native implementation
├── useCamera.web.ts       # Web implementation
│
├── useHaptics.ts          # Base (may be no-op on web)
└── useHaptics.native.ts   # Native with haptic feedback
```

### Utils Directory

```
utils/
├── storage.ts             # Interface
├── storage.native.ts      # AsyncStorage implementation
└── storage.web.ts         # localStorage implementation
```

## Patterns and Examples

### Pattern 1: Re-export from app/ Directory

When you need platform-specific routes, create the implementation outside `app/` and re-export:

```tsx
// components/about/index.tsx
// Platform-specific implementations live here

// components/about/AboutScreen.tsx
export const AboutScreen = () => <CommonAboutContent />;

// components/about/AboutScreen.web.tsx
export const AboutScreen = () => <WebSpecificAboutContent />;

// app/about.tsx
export { AboutScreen as default } from "@/components/about/AboutScreen";
```

### Pattern 2: Shared Container, Platform Views

Following the Container/View pattern with platform-specific views:

```tsx
// components/FileUploader/FileUploaderContainer.tsx
import FileUploaderView from "./FileUploaderView";

const FileUploaderContainer = () => {
  const [file, setFile] = useState<File | null>(null);

  const handleUpload = useCallback(async () => {
    // Shared upload logic
  }, [file]);

  return <FileUploaderView file={file} onUpload={handleUpload} />;
};

// components/FileUploader/FileUploaderView.native.tsx
const FileUploaderView = ({ file, onUpload }: Props) => (
  <TouchableOpacity onPress={onUpload}>
    <Text>Upload from Device</Text>
  </TouchableOpacity>
);

// components/FileUploader/FileUploaderView.web.tsx
const FileUploaderView = ({ file, onUpload }: Props) => (
  <input type="file" onChange={onUpload} />
);
```

### Pattern 3: Platform-Specific Hooks

```tsx
// hooks/useClipboard.ts (interface/types)
export interface UseClipboardResult {
  readonly copy: (text: string) => Promise<void>;
  readonly paste: () => Promise<string>;
}

// hooks/useClipboard.native.ts
import * as Clipboard from "expo-clipboard";

export const useClipboard = (): UseClipboardResult => ({
  copy: async text => await Clipboard.setStringAsync(text),
  paste: async () => await Clipboard.getStringAsync(),
});

// hooks/useClipboard.web.ts
export const useClipboard = (): UseClipboardResult => ({
  copy: async text => await navigator.clipboard.writeText(text),
  paste: async () => await navigator.clipboard.readText(),
});
```

### Pattern 4: Conditional Feature Files

```tsx
// features/ar-viewer/index.ts (base export)
export { ARViewer } from "./ARViewer";

// features/ar-viewer/ARViewer.tsx (fallback)
export const ARViewer = () => <Text>AR is not supported on this platform</Text>;

// features/ar-viewer/ARViewer.native.tsx
import { ARView } from "react-native-ar";

export const ARViewer = () => <ARView />;
```

## TypeScript Considerations

### Shared Type Definitions

Create a shared types file that all platform versions import:

```tsx
// components/Modal/types.ts
export interface ModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
}

// components/Modal/ModalView.native.tsx
import type { ModalProps } from "./types";

const ModalView = ({ visible, onClose, children }: ModalProps) => (
  // Native implementation
);

// components/Modal/ModalView.web.tsx
import type { ModalProps } from "./types";

const ModalView = ({ visible, onClose, children }: ModalProps) => (
  // Web implementation
);
```

### Module Declaration for Web APIs

When using web-only libraries:

```tsx
// types/dom-to-image.d.ts
declare module "dom-to-image" {
  export function toJpeg(
    node: HTMLElement | null,
    options?: { quality?: number; width?: number; height?: number }
  ): Promise<string>;

  export function toPng(
    node: HTMLElement | null,
    options?: { width?: number; height?: number }
  ): Promise<string>;
}
```

### Platform-Specific Type Guards

```tsx
// types/platform.ts

/**
 * Type for web-specific window properties.
 */
declare global {
  interface Window {
    // Add web-specific properties
  }
}

/**
 * Ensures code only runs on web.
 */
export const assertWeb = (): void => {
  if (Platform.OS !== "web") {
    throw new Error("This code should only run on web");
  }
};
```

## Common Mistakes

### 1. Missing Base File in app/

```
❌ app/settings.web.tsx (without app/settings.tsx)
```

**Fix:** Always create base file first, then add platform overrides.

### 2. Expecting .native.tsx on Web

```tsx
// components/Button.native.tsx exists
// Expecting it to work on web - it won't!
```

**Fix:** Either create `.web.tsx` or ensure `.tsx` base exists.

### 3. Inconsistent Exports

```tsx
// Button.native.tsx
export const Button = () => {};

// Button.web.tsx
export default function Button() {} // Different export style!
```

**Fix:** Use consistent export patterns across all platform versions.

### 4. Different Props Between Platforms

```tsx
// Modal.native.tsx
const Modal = ({ visible, animationType }: Props) => {};

// Modal.web.tsx
const Modal = ({ isOpen }: Props) => {}; // Different prop names!
```

**Fix:** Use shared type definitions to ensure consistent interfaces.

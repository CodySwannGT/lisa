# Environment Validation Patterns

Advanced Zod patterns for environment variable validation in Expo/React Native.

## Complete Schema Example

```typescript
import { z } from "zod";

/**
 * Transforms a string "true"/"false" to boolean.
 */
const booleanString = z
  .string()
  .transform(v => v.toLowerCase() === "true")
  .default("false");

/**
 * Transforms a string to number with validation.
 */
const numberString = (defaultValue: number) =>
  z
    .string()
    .transform(v => {
      const parsed = parseInt(v, 10);
      if (isNaN(parsed)) {
        throw new Error(`Invalid number: ${v}`);
      }
      return parsed;
    })
    .default(String(defaultValue));

/**
 * Transforms comma-separated string to array.
 */
const arrayString = z
  .string()
  .transform(v => (v ? v.split(",").map(s => s.trim()) : []))
  .default("");

/**
 * Complete environment schema.
 */
const envSchema = z.object({
  // Required strings
  EXPO_PUBLIC_API_URL: z.string().url(),
  EXPO_PUBLIC_APP_ENV: z.enum(["development", "staging", "production"]),

  // Optional strings
  EXPO_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  EXPO_PUBLIC_ANALYTICS_ID: z.string().optional(),

  // Booleans (from string)
  EXPO_PUBLIC_DEBUG_MODE: booleanString,
  EXPO_PUBLIC_FEATURE_NEW_UI: booleanString,

  // Numbers (from string)
  EXPO_PUBLIC_API_TIMEOUT_MS: numberString(5000),
  EXPO_PUBLIC_MAX_RETRIES: numberString(3),

  // Arrays (from comma-separated string)
  EXPO_PUBLIC_ALLOWED_ORIGINS: arrayString,

  // Conditional/derived
  EXPO_PUBLIC_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
```

## Common Transforms

### Boolean from String

```typescript
// Handles "true", "TRUE", "True", etc.
const booleanEnv = z
  .string()
  .transform(v => v.toLowerCase() === "true")
  .default("false");

// Usage
EXPO_PUBLIC_FEATURE_FLAG: booleanEnv,
```

### Number from String

```typescript
// With validation
const numberEnv = z.string().transform((v, ctx) => {
  const parsed = parseInt(v, 10);
  if (isNaN(parsed)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Must be a valid number",
    });
    return z.NEVER;
  }
  return parsed;
});

// With default
const numberWithDefault = (def: number) =>
  z
    .string()
    .optional()
    .transform(v => (v ? parseInt(v, 10) : def));
```

### Array from Comma-Separated String

```typescript
const arrayEnv = z
  .string()
  .transform(v =>
    v
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  )
  .default("");

// Example: "host1.com, host2.com" -> ["host1.com", "host2.com"]
```

### URL with Protocol Validation

```typescript
const httpUrl = z.string().url().refine(
  url => url.startsWith("https://") || url.startsWith("http://"),
  { message: "Must be an HTTP(S) URL" }
);

// HTTPS only in production
const secureUrl = z.string().url().refine(
  url => {
    if (process.env.EXPO_PUBLIC_APP_ENV === "production") {
      return url.startsWith("https://");
    }
    return true;
  },
  { message: "Production URLs must use HTTPS" }
);
```

## Environment-Specific Defaults

```typescript
const getDefaultApiUrl = () => {
  switch (process.env.EXPO_PUBLIC_APP_ENV) {
    case "production":
      return "https://api.example.com";
    case "staging":
      return "https://staging-api.example.com";
    default:
      return "http://localhost:3000";
  }
};

const envSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url().default(getDefaultApiUrl()),
});
```

## Refinements and Cross-Field Validation

```typescript
const envSchema = z
  .object({
    EXPO_PUBLIC_APP_ENV: z.enum(["development", "staging", "production"]),
    EXPO_PUBLIC_DEBUG_MODE: booleanString,
    EXPO_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  })
  .refine(
    data => {
      // Sentry DSN required in production
      if (data.EXPO_PUBLIC_APP_ENV === "production") {
        return !!data.EXPO_PUBLIC_SENTRY_DSN;
      }
      return true;
    },
    {
      message: "EXPO_PUBLIC_SENTRY_DSN is required in production",
      path: ["EXPO_PUBLIC_SENTRY_DSN"],
    }
  )
  .refine(
    data => {
      // Debug mode forbidden in production
      if (data.EXPO_PUBLIC_APP_ENV === "production") {
        return !data.EXPO_PUBLIC_DEBUG_MODE;
      }
      return true;
    },
    {
      message: "Debug mode cannot be enabled in production",
      path: ["EXPO_PUBLIC_DEBUG_MODE"],
    }
  );
```

## Error Handling

### Custom Error Messages

```typescript
const envSchema = z.object({
  EXPO_PUBLIC_API_URL: z
    .string({
      required_error: "API URL is required. Set EXPO_PUBLIC_API_URL in your .env file.",
    })
    .url({
      message: "API URL must be a valid URL (e.g., https://api.example.com)",
    }),
});
```

### Graceful Error Formatting

```typescript
const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map(issue => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  return result.data;
};

export const env = parseEnv();
```

## Testing Patterns

### Complete Mock Setup

```typescript
// jest.setup.local.ts
const mockEnv = {
  EXPO_PUBLIC_API_URL: "https://test.example.com",
  EXPO_PUBLIC_APP_ENV: "development" as const,
  EXPO_PUBLIC_DEBUG_MODE: false,
  EXPO_PUBLIC_FEATURE_NEW_UI: true,
  EXPO_PUBLIC_API_TIMEOUT_MS: 5000,
  EXPO_PUBLIC_MAX_RETRIES: 3,
  EXPO_PUBLIC_ALLOWED_ORIGINS: ["localhost"],
  EXPO_PUBLIC_LOG_LEVEL: "info" as const,
  EXPO_PUBLIC_SENTRY_DSN: undefined,
  EXPO_PUBLIC_ANALYTICS_ID: undefined,
};

jest.mock("@/lib/env", () => ({
  env: mockEnv,
}));
```

### Override for Specific Tests

```typescript
// In test file
import { env } from "@/lib/env";

jest.mock("@/lib/env");

const mockEnv = env as jest.Mocked<typeof env>;

describe("Feature with production behavior", () => {
  beforeEach(() => {
    mockEnv.EXPO_PUBLIC_APP_ENV = "production";
    mockEnv.EXPO_PUBLIC_DEBUG_MODE = false;
  });

  afterEach(() => {
    mockEnv.EXPO_PUBLIC_APP_ENV = "development";
  });

  it("should disable debug features in production", () => {
    // Test production-specific behavior
  });
});
```

### Testing Validation Itself

```typescript
// env.test.ts
describe("Environment Schema Validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should throw for missing required variables", () => {
    delete process.env.EXPO_PUBLIC_API_URL;

    expect(() => {
      require("@/lib/env");
    }).toThrow(/EXPO_PUBLIC_API_URL/);
  });

  it("should throw for invalid URL format", () => {
    process.env.EXPO_PUBLIC_API_URL = "not-a-url";

    expect(() => {
      require("@/lib/env");
    }).toThrow(/url/i);
  });

  it("should use defaults for optional variables", () => {
    process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
    process.env.EXPO_PUBLIC_APP_ENV = "development";

    const { env } = require("@/lib/env");

    expect(env.EXPO_PUBLIC_DEBUG_MODE).toBe(false);
    expect(env.EXPO_PUBLIC_API_TIMEOUT_MS).toBe(5000);
  });
});
```

## EAS Build Integration

### eas.json Configuration

```json
{
  "build": {
    "development": {
      "env": {
        "EXPO_PUBLIC_APP_ENV": "development",
        "EXPO_PUBLIC_API_URL": "https://dev-api.example.com"
      }
    },
    "staging": {
      "env": {
        "EXPO_PUBLIC_APP_ENV": "staging",
        "EXPO_PUBLIC_API_URL": "https://staging-api.example.com"
      }
    },
    "production": {
      "env": {
        "EXPO_PUBLIC_APP_ENV": "production",
        "EXPO_PUBLIC_API_URL": "https://api.example.com"
      }
    }
  }
}
```

### EAS Secrets for Sensitive Values

```bash
# Set secrets via CLI (not in eas.json)
eas secret:create --name SENTRY_AUTH_TOKEN --value "your-token"
eas secret:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json
```

## app.config.ts Build-Time Validation

```javascript
// app.config.ts
const { z } = require("zod");

// Validate at build time
const buildSchema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url(),
  EXPO_PUBLIC_APP_ENV: z.enum(["development", "staging", "production"]),
  // Build-only (not exposed to client)
  SENTRY_AUTH_TOKEN: z.string().optional(),
  EAS_PROJECT_ID: z.string().optional(),
});

const result = buildSchema.safeParse(process.env);

if (!result.success) {
  console.error("Build environment validation failed:");
  result.error.issues.forEach(issue => {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  });
  throw new Error("Invalid build environment");
}

const env = result.data;

module.exports = {
  name: "MyApp",
  slug: "my-app",
  version: "1.0.0",
  extra: {
    eas: {
      projectId: env.EAS_PROJECT_ID,
    },
  },
  hooks: {
    postPublish: [
      {
        file: "sentry-expo/upload-sourcemaps",
        config: {
          authToken: env.SENTRY_AUTH_TOKEN,
        },
      },
    ],
  },
};
```

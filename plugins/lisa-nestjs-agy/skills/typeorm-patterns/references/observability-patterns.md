# Observability Patterns

Detailed patterns for TypeORM observability including the X-Ray logger implementation with graceful degradation for local development.

## Custom X-Ray Logger

The custom logger provides distributed tracing in production while working gracefully in local environments where X-Ray is unavailable.

### typeorm-xray-logger.ts

```typescript
import { Logger as NestLogger } from "@nestjs/common";
import type { Logger as TypeOrmLogger, QueryRunner } from "typeorm";

/**
 * X-Ray segment interface for type safety.
 */
interface XRaySegment {
  addNewSubsegment(name: string): XRaySubsegment;
}

/**
 * X-Ray subsegment interface for type safety.
 */
interface XRaySubsegment {
  addAnnotation(key: string, value: string | number | boolean): void;
  addMetadata(key: string, value: unknown): void;
  addError(error: Error): void;
  close(): void;
}

/**
 * X-Ray SDK namespace interface.
 */
interface XRayNamespace {
  getSegment(): XRaySegment | null;
}

/**
 * Query type extracted from SQL.
 */
type QueryType = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "OTHER";

/**
 * Extract query type from SQL string.
 *
 * @param query - The SQL query string
 * @returns The query type
 */
const extractQueryType = (query: string): QueryType => {
  const normalized = query.trim().toUpperCase();
  if (normalized.startsWith("SELECT")) return "SELECT";
  if (normalized.startsWith("INSERT")) return "INSERT";
  if (normalized.startsWith("UPDATE")) return "UPDATE";
  if (normalized.startsWith("DELETE")) return "DELETE";
  return "OTHER";
};

/**
 * Extract table name from SQL string.
 *
 * @param query - The SQL query string
 * @returns The table name or "unknown"
 */
const extractTableName = (query: string): string => {
  const patterns = [
    /FROM\s+["']?(\w+)["']?/i,
    /INTO\s+["']?(\w+)["']?/i,
    /UPDATE\s+["']?(\w+)["']?/i,
    /DELETE\s+FROM\s+["']?(\w+)["']?/i,
  ];

  const results = patterns
    .map(pattern => query.match(pattern))
    .filter((match): match is RegExpMatchArray => match !== null);

  return results[0]?.[1] ?? "unknown";
};

/**
 * Sanitize query parameters to prevent logging sensitive data.
 *
 * @param parameters - The query parameters
 * @returns Sanitized parameter representation
 */
const sanitizeParameters = (
  parameters: readonly unknown[] | undefined
): string => {
  if (!parameters || parameters.length === 0) return "[]";
  return `[${parameters.length} parameters]`;
};

/**
 * Attempt to get X-Ray namespace with graceful fallback.
 *
 * @returns X-Ray namespace or null if unavailable
 */
const getXRayNamespace = (): XRayNamespace | null => {
  try {
    // Dynamic import to avoid hard dependency on X-Ray SDK
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic require for optional dependency
    const AWSXRay = require("aws-xray-sdk-core");
    return AWSXRay.getNamespace() as XRayNamespace;
  } catch {
    // X-Ray SDK not available (local development)
    return null;
  }
};

/**
 * TypeORM logger with AWS X-Ray distributed tracing integration.
 *
 * @remarks
 * This logger provides:
 * - AWS X-Ray subsegment creation for each query
 * - Query type and table name extraction for metrics
 * - Parameter sanitization (no sensitive data logged)
 * - Graceful degradation when X-Ray is unavailable
 * - Never throws exceptions (defensive programming)
 *
 * In local development without X-Ray, falls back to NestJS Logger.
 */
export class TypeOrmXRayLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger("TypeORM");

  /**
   * Create an X-Ray subsegment for a database operation.
   *
   * @param name - The subsegment name
   * @returns The subsegment or null if X-Ray unavailable
   */
  private createSubsegment(name: string): XRaySubsegment | null {
    try {
      const namespace = getXRayNamespace();
      const segment = namespace?.getSegment();
      return segment?.addNewSubsegment(name) ?? null;
    } catch {
      // Silently fail - X-Ray tracing is optional
      return null;
    }
  }

  /**
   * Close a subsegment safely.
   *
   * @param subsegment - The subsegment to close
   */
  private closeSubsegment(subsegment: XRaySubsegment | null): void {
    try {
      subsegment?.close();
    } catch {
      // Silently fail - never throw from logger
    }
  }

  /**
   * Log a query with X-Ray tracing.
   *
   * @param query - The SQL query
   * @param parameters - Query parameters
   * @param _queryRunner - TypeORM query runner (unused)
   */
  logQuery(
    query: string,
    parameters?: readonly unknown[],
    _queryRunner?: QueryRunner
  ): void {
    const queryType = extractQueryType(query);
    const tableName = extractTableName(query);
    const subsegment = this.createSubsegment(`db-${queryType.toLowerCase()}`);

    try {
      subsegment?.addAnnotation("db.type", "postgresql");
      subsegment?.addAnnotation("db.operation", queryType);
      subsegment?.addAnnotation("db.table", tableName);
      subsegment?.addMetadata("query", query);
      subsegment?.addMetadata("parameters", sanitizeParameters(parameters));

      this.logger.debug(
        `[${queryType}] ${tableName}: ${query.substring(0, 100)}...`
      );
    } finally {
      this.closeSubsegment(subsegment);
    }
  }

  /**
   * Log a failed query with X-Ray error tracking.
   *
   * @param error - The error message or Error object
   * @param query - The SQL query that failed
   * @param parameters - Query parameters
   * @param _queryRunner - TypeORM query runner (unused)
   */
  logQueryError(
    error: string | Error,
    query: string,
    parameters?: readonly unknown[],
    _queryRunner?: QueryRunner
  ): void {
    const queryType = extractQueryType(query);
    const tableName = extractTableName(query);
    const subsegment = this.createSubsegment(`db-${queryType.toLowerCase()}-error`);

    try {
      const errorObj = typeof error === "string" ? new Error(error) : error;

      subsegment?.addAnnotation("db.type", "postgresql");
      subsegment?.addAnnotation("db.operation", queryType);
      subsegment?.addAnnotation("db.table", tableName);
      subsegment?.addAnnotation("db.error", true);
      subsegment?.addError(errorObj);
      subsegment?.addMetadata("query", query);
      subsegment?.addMetadata("parameters", sanitizeParameters(parameters));

      this.logger.error(
        `[${queryType}] ${tableName} FAILED: ${errorObj.message}`,
        errorObj.stack
      );
    } finally {
      this.closeSubsegment(subsegment);
    }
  }

  /**
   * Log a slow query with X-Ray annotation.
   *
   * @param time - Query execution time in milliseconds
   * @param query - The SQL query
   * @param parameters - Query parameters
   * @param _queryRunner - TypeORM query runner (unused)
   */
  logQuerySlow(
    time: number,
    query: string,
    parameters?: readonly unknown[],
    _queryRunner?: QueryRunner
  ): void {
    const queryType = extractQueryType(query);
    const tableName = extractTableName(query);
    const subsegment = this.createSubsegment(`db-${queryType.toLowerCase()}-slow`);

    try {
      subsegment?.addAnnotation("db.type", "postgresql");
      subsegment?.addAnnotation("db.operation", queryType);
      subsegment?.addAnnotation("db.table", tableName);
      subsegment?.addAnnotation("db.slow", true);
      subsegment?.addAnnotation("db.duration_ms", time);
      subsegment?.addMetadata("query", query);
      subsegment?.addMetadata("parameters", sanitizeParameters(parameters));

      this.logger.warn(
        `[SLOW ${time}ms] [${queryType}] ${tableName}: ${query.substring(0, 100)}...`
      );
    } finally {
      this.closeSubsegment(subsegment);
    }
  }

  /**
   * Log schema build operations.
   *
   * @param message - The log message
   * @param _queryRunner - TypeORM query runner (unused)
   */
  logSchemaBuild(message: string, _queryRunner?: QueryRunner): void {
    this.logger.log(`[Schema] ${message}`);
  }

  /**
   * Log migration operations.
   *
   * @param message - The log message
   * @param _queryRunner - TypeORM query runner (unused)
   */
  logMigration(message: string, _queryRunner?: QueryRunner): void {
    this.logger.log(`[Migration] ${message}`);
  }

  /**
   * Log general TypeORM messages.
   *
   * @param level - The log level
   * @param message - The log message
   * @param _queryRunner - TypeORM query runner (unused)
   */
  log(
    level: "log" | "info" | "warn",
    message: unknown,
    _queryRunner?: QueryRunner
  ): void {
    const messageStr = typeof message === "string" ? message : JSON.stringify(message);

    const logMethod = level === "warn" ? "warn" : "log";
    this.logger[logMethod](messageStr);
  }
}
```

## Usage in Configuration

```typescript
import { TypeOrmXRayLogger } from "./typeorm-xray-logger";

const createBaseConfig = (): Partial<DataSourceOptions> => ({
  type: "postgres",
  // ... other config
  logging: ["query", "error", "warn"],
  logger: new TypeOrmXRayLogger(),
});
```

## Logging Levels

Configure which operations to log:

| Option | Description |
|--------|-------------|
| `"query"` | Log all queries |
| `"error"` | Log failed queries |
| `"warn"` | Log warnings |
| `"schema"` | Log schema build operations |
| `"migration"` | Log migration operations |
| `true` | Log everything |
| `false` | Disable logging |

### Recommended Configuration

```typescript
// Development - verbose logging
logging: true,

// Production - errors and slow queries only
logging: ["error", "warn"],
```

## X-Ray Annotations vs Metadata

| Type | Purpose | Searchable | Size Limit |
|------|---------|------------|------------|
| **Annotation** | Filter and search traces | Yes | 50 per segment |
| **Metadata** | Additional context | No | 64KB total |

### Best Practices

```typescript
// Annotations - use for filtering
subsegment.addAnnotation("db.operation", "SELECT");  // Searchable
subsegment.addAnnotation("db.table", "users");       // Searchable
subsegment.addAnnotation("db.error", true);          // Searchable

// Metadata - use for debugging context
subsegment.addMetadata("query", query);              // Not searchable
subsegment.addMetadata("parameters", params);        // Not searchable
```

## Health Check Integration

Combine with NestJS Terminus for production-ready health monitoring.

### health.controller.ts

```typescript
import { Controller, Get } from "@nestjs/common";
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from "@nestjs/terminus";

/**
 * Health check controller for load balancer probes.
 */
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator
  ) {}

  /**
   * Perform health check including database connectivity.
   *
   * @returns Health check result with database status
   */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck("database", { timeout: 3000 }),
    ]);
  }
}
```

### health.module.ts

```typescript
import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "./health.controller";

/**
 * Health check module for application monitoring.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

## Testing the Logger

### typeorm-xray-logger.test.ts

```typescript
import { TypeOrmXRayLogger } from "./typeorm-xray-logger";

describe("TypeOrmXRayLogger", () => {
  const logger = new TypeOrmXRayLogger();

  describe("logQuery", () => {
    it("should log SELECT queries without throwing", () => {
      expect(() => {
        logger.logQuery("SELECT * FROM users WHERE id = $1", ["uuid"]);
      }).not.toThrow();
    });

    it("should log INSERT queries without throwing", () => {
      expect(() => {
        logger.logQuery(
          "INSERT INTO users (email) VALUES ($1)",
          ["test@example.com"]
        );
      }).not.toThrow();
    });
  });

  describe("logQueryError", () => {
    it("should log errors without throwing", () => {
      expect(() => {
        logger.logQueryError(
          new Error("Connection refused"),
          "SELECT * FROM users",
          []
        );
      }).not.toThrow();
    });

    it("should handle string errors", () => {
      expect(() => {
        logger.logQueryError("Timeout", "SELECT * FROM users", []);
      }).not.toThrow();
    });
  });

  describe("logQuerySlow", () => {
    it("should log slow queries without throwing", () => {
      expect(() => {
        logger.logQuerySlow(5000, "SELECT * FROM users", []);
      }).not.toThrow();
    });
  });

  describe("graceful degradation", () => {
    it("should work without X-Ray SDK installed", () => {
      // X-Ray SDK is not installed in test environment
      // Logger should fall back to NestJS Logger
      expect(() => {
        logger.logQuery("SELECT 1", []);
        logger.logQueryError("Test error", "SELECT 1", []);
        logger.logQuerySlow(1000, "SELECT 1", []);
      }).not.toThrow();
    });
  });
});
```

## Production X-Ray Setup

For production environments with X-Ray:

### Install X-Ray SDK (production only)

```bash
bun add aws-xray-sdk-core
```

### Lambda Handler Integration

```typescript
import * as AWSXRay from "aws-xray-sdk-core";

// Capture all AWS SDK calls
AWSXRay.captureAWS(require("aws-sdk"));

// Capture HTTP calls
AWSXRay.captureHTTPsGlobal(require("http"));
AWSXRay.captureHTTPsGlobal(require("https"));
```

### serverless.yml Configuration

```yaml
provider:
  tracing:
    lambda: true
    apiGateway: true
```

## Metrics Dashboard

X-Ray annotations enable CloudWatch dashboards:

### Sample CloudWatch Insights Query

```sql
-- Query latency by table
fields @timestamp, @message
| filter annotation.db.type = 'postgresql'
| stats avg(annotation.db.duration_ms) as avg_latency by annotation.db.table
| sort avg_latency desc
```

### Alerting on Slow Queries

```sql
-- Find slow queries over 1 second
fields @timestamp, metadata.query
| filter annotation.db.slow = true
| filter annotation.db.duration_ms > 1000
| sort @timestamp desc
| limit 100
```

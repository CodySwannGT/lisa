# Configuration Patterns

Detailed patterns for TypeORM configuration using the official NestJS `TypeOrmModule.forRootAsync()` with `dataSourceFactory` and ConfigService.

## Why This Approach?

Per [NestJS documentation](https://docs.nestjs.com/techniques/database), `TypeOrmModule.forRootAsync()` is the recommended approach for async configuration. Adding `dataSourceFactory` gives full control over DataSource initialization while staying within NestJS patterns.

**Benefits**:
- `@InjectRepository()` works automatically
- Health checks integrate seamlessly via `@nestjs/terminus`
- Proper NestJS lifecycle management
- Less boilerplate than custom providers
- Type-safe configuration via ConfigService

## Database Module

### database.module.ts

```typescript
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource, DataSourceOptions } from "typeorm";
import { Configuration } from "../config/configuration";
import { createTypeOrmOptionsFromConfigService } from "./database.config";

/**
 * Database module using official NestJS TypeORM integration.
 *
 * @remarks
 * Uses forRootAsync with dataSourceFactory for:
 * - Async configuration via ConfigService
 * - Custom DataSource initialization
 * - Replication support with dynamic passwords
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Configuration, true>) =>
        createTypeOrmOptionsFromConfigService(configService),
      dataSourceFactory: async (options?: DataSourceOptions) => {
        if (!options) {
          throw new Error("DataSource options are required");
        }
        const dataSource = new DataSource(options);
        return dataSource.initialize();
      },
    }),
  ],
})
export class DatabaseModule {}
```

## Configuration Factory

### database.config.ts

```typescript
import { ConfigService } from "@nestjs/config";
import type { TypeOrmModuleOptions } from "@nestjs/typeorm";
import type { DataSourceOptions, LoggerOptions } from "typeorm";
import { SnakeNamingStrategy } from "typeorm-naming-strategies";
import { Configuration, getStandaloneConfig } from "../config/configuration";
import * as entities from "./entities";
import { generateRdsAuthToken } from "./rds-signer";
import { TypeOrmXRayLogger } from "./typeorm-xray-logger";

/** Default database host for local development */
const DEFAULT_DATABASE_HOST = "localhost";

/** Default SSL setting (disabled for local development) */
const DEFAULT_DATABASE_SSL = false;

/** Default logging configuration */
const DEFAULT_LOGGING_OPTIONS: LoggerOptions = ["error", "warn", "migration"];

/**
 * Creates the base TypeORM configuration shared by all environments.
 */
function createBaseConfig(): Partial<DataSourceOptions> & { type: "postgres" } {
  return {
    type: "postgres",
    synchronize: false,
    namingStrategy: new SnakeNamingStrategy(),
    logger: new TypeOrmXRayLogger(),
    logging: DEFAULT_LOGGING_OPTIONS,
    entities: Object.values(entities),
  };
}

/**
 * Determines if running in local environment.
 */
function isLocalEnvironmentFromService(
  configService: ConfigService<Configuration, true>
): boolean {
  const isOffline = configService.get("app.isOffline", { infer: true });
  const isTest = configService.get("app.nodeEnv", { infer: true }) === "test";
  return isOffline || isTest;
}

/**
 * Creates local development configuration using ConfigService.
 */
function createLocalConfigFromService(
  configService: ConfigService<Configuration, true>
): DataSourceOptions {
  const baseConfig = createBaseConfig();
  const host = configService.get("database.host", { infer: true });
  const port = configService.get("database.port", { infer: true });
  const username = configService.get("database.username", { infer: true });
  const password = configService.get("database.password", { infer: true });
  const database = configService.get("database.name", { infer: true });

  return {
    ...baseConfig,
    host,
    port,
    username,
    password,
    database,
    ssl: DEFAULT_DATABASE_SSL,
  };
}

/**
 * Creates production configuration with replication using ConfigService.
 *
 * @remarks IAM tokens are generated at initialization. Lambda functions
 * typically have short lifespans, so token expiration is not a concern.
 */
async function createProductionConfigFromService(
  configService: ConfigService<Configuration, true>
): Promise<DataSourceOptions> {
  const baseConfig = createBaseConfig();
  const masterHost =
    configService.get("database.proxyHost", { infer: true }) ??
    DEFAULT_DATABASE_HOST;
  const readHost =
    configService.get("database.proxyHostRead", { infer: true }) ?? masterHost;
  const port = configService.get("database.port", { infer: true });
  const username = configService.get("database.username", { infer: true });
  const database = configService.get("database.name", { infer: true });
  const ssl = configService.get("database.ssl", { infer: true })
    ? { rejectUnauthorized: configService.get("database.sslRejectUnauthorized", { infer: true }) }
    : DEFAULT_DATABASE_SSL;

  const masterToken = await generateRdsAuthToken(masterHost, port, username);
  const readToken = await generateRdsAuthToken(readHost, port, username);

  return {
    ...baseConfig,
    ssl,
    replication: {
      master: {
        host: masterHost,
        port,
        username,
        password: masterToken,
        database,
      },
      slaves: [
        {
          host: readHost,
          port,
          username,
          password: readToken,
          database,
        },
      ],
    },
  };
}

/**
 * Creates TypeORM module options for NestJS using ConfigService.
 *
 * @param configService - NestJS ConfigService instance
 * @returns Promise resolving to TypeOrmModuleOptions
 */
export async function createTypeOrmOptionsFromConfigService(
  configService: ConfigService<Configuration, true>
): Promise<TypeOrmModuleOptions> {
  const config = isLocalEnvironmentFromService(configService)
    ? createLocalConfigFromService(configService)
    : await createProductionConfigFromService(configService);

  return {
    ...config,
    autoLoadEntities: false,
  };
}

// =============================================================================
// Standalone functions for TypeORM CLI (migrations)
// These functions use getStandaloneConfig() for environments without ConfigService
// =============================================================================

/**
 * Determines if running in local environment (standalone).
 * @remarks Used by TypeORM CLI and other contexts without ConfigService
 */
export function isLocalEnvironment(): boolean {
  const config = getStandaloneConfig();
  return config.app.isOffline || config.app.nodeEnv === "test";
}

/**
 * Creates local development configuration (standalone).
 * @remarks Used by TypeORM CLI (typeorm.config.ts) for migrations
 */
export function createLocalConfig(): DataSourceOptions {
  const baseConfig = createBaseConfig();
  const config = getStandaloneConfig();

  return {
    ...baseConfig,
    host: config.database.host,
    port: config.database.port,
    username: config.database.username,
    password: config.database.password,
    database: config.database.name,
    ssl: DEFAULT_DATABASE_SSL,
  };
}
```

## Configuration Schema

All configuration is centralized in `src/config/configuration.ts`:

```typescript
export interface Configuration {
  readonly app: {
    readonly nodeEnv: string;
    readonly isOffline: boolean;
  };
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly username: string;
    readonly password: string;
    readonly name: string;
    readonly ssl: boolean;
    readonly sslRejectUnauthorized: boolean;
    readonly proxyHost: string | undefined;
    readonly proxyHostRead: string | undefined;
  };
  // ... other namespaces
}

export const configuration = (): Configuration => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? "development",
    isOffline: process.env.IS_OFFLINE === "true",
  },
  database: {
    host: process.env.DATABASE_HOST ?? "localhost",
    port: parseInt(process.env.DATABASE_PORT ?? "5432", 10),
    username: process.env.DATABASE_USER ?? "thumbwar",
    password: process.env.DATABASE_PASSWORD ?? "thumbwar_local",
    name: process.env.DATABASE_NAME ?? "thumbwar",
    ssl: process.env.DATABASE_SSL === "true",
    sslRejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
    proxyHost: process.env.DATABASE_PROXY_HOST,
    proxyHostRead: process.env.DATABASE_PROXY_HOST_READ_1,
  },
});
```

## AWS RDS Signer Integration

### rds-signer.ts

```typescript
import { Signer } from "@aws-sdk/rds-signer";
import { Logger } from "@nestjs/common";

const logger = new Logger("RdsSigner");

/**
 * Generate an IAM authentication token for RDS.
 *
 * @param hostname - The RDS endpoint hostname
 * @param port - The database port
 * @param username - The database username
 * @returns A temporary authentication token valid for 15 minutes
 */
export const generateRdsAuthToken = async (
  hostname: string,
  port: number,
  username: string
): Promise<string> => {
  const signer = new Signer({
    hostname,
    port,
    username,
    region: process.env.AWS_REGION ?? "us-east-1",
  });

  const token = await signer.getAuthToken();
  logger.debug(`Generated RDS auth token for ${username}@${hostname}:${port}`);

  return token;
};
```

## Read-Write Replication Behavior

When replication is configured, TypeORM automatically routes queries:

### Automatic Routing

| Method | Connection |
|--------|------------|
| `find()`, `findOne()`, `findBy()` | Slave (read) |
| `count()`, `exists()` | Slave (read) |
| `query()` with SELECT | Slave (read) |
| `save()`, `insert()` | Master (write) |
| `update()`, `delete()`, `remove()` | Master (write) |
| `query()` with INSERT/UPDATE/DELETE | Master (write) |

### Forcing Master for Reads

When read-after-write consistency is required:

```typescript
// Option 1: Use transaction (always uses master)
async findUserWithConsistency(id: string): Promise<User | null> {
  return this.dataSource.transaction(async manager => {
    return manager.findOne(User, { where: { id } });
  });
}

// Option 2: Explicit QueryRunner
async findUserFromMaster(id: string): Promise<User | null> {
  const queryRunner = this.dataSource.createQueryRunner("master");
  try {
    return await queryRunner.manager.findOne(User, { where: { id } });
  } finally {
    await queryRunner.release();
  }
}
```

## Registering Entities in Feature Modules

Use `TypeOrmModule.forFeature()` in feature modules:

```typescript
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../database/entities/user.entity";
import { UserService } from "./user.service";
import { UserResolver } from "./user.resolver";

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UserService, UserResolver],
  exports: [UserService],
})
export class UserModule {}
```

## CLI Configuration

For migrations and CLI operations, maintain a separate configuration file.

### typeorm.config.ts (project root)

```typescript
import { DataSource } from "typeorm";
import { createLocalConfig } from "./src/database/database.config";

/**
 * TypeORM CLI DataSource for migrations.
 *
 * @remarks
 * This configuration is used by typeorm-ts-node-commonjs for:
 * - migration:generate
 * - migration:run
 * - migration:revert
 *
 * Uses createLocalConfig() which uses getStandaloneConfig() internally
 * for type-safe configuration access.
 */
export default new DataSource({
  ...createLocalConfig(),
  migrations: ["src/database/migrations/*.ts"],
});
```

## Environment Variables

### .env.example

```bash
# Database Configuration
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=thumbwar
DATABASE_PASSWORD=thumbwar_local
DATABASE_NAME=thumbwar
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=true

# Local development flag (set by serverless-offline)
IS_OFFLINE=true

# Production Only - RDS Proxy endpoints
# DATABASE_PROXY_HOST=thumbwar-proxy.proxy-xxxxx.us-east-1.rds.amazonaws.com
# DATABASE_PROXY_HOST_READ_1=thumbwar-proxy-read.proxy-xxxxx.us-east-1.rds.amazonaws.com

# AWS Configuration (production)
# AWS_REGION=us-east-1
```

## Dependencies

Required packages:

```bash
bun add @nestjs/config @nestjs/typeorm typeorm pg typeorm-naming-strategies @aws-sdk/rds-signer
```

| Package | Purpose |
|---------|---------|
| `@nestjs/config` | Type-safe configuration via ConfigService |
| `@nestjs/typeorm` | Official NestJS TypeORM integration |
| `typeorm` | TypeORM core |
| `pg` | PostgreSQL driver |
| `typeorm-naming-strategies` | SnakeNamingStrategy for camelCase → snake_case |
| `@aws-sdk/rds-signer` | IAM authentication token generation (production) |

## Health Check Integration

With `TypeOrmModule`, health checks work automatically:

### health.module.ts

```typescript
import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { HealthController } from "./health.controller";

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

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

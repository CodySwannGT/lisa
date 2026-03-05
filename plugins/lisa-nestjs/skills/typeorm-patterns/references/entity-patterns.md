# Entity Patterns

Detailed patterns for TypeORM entity design including base entity, relationships, indexes, enums, and database views.

## Abstract Base Entity

All entities must extend the abstract `TimestampedEntity` class.

**Important naming**: We use `TimestampedEntity` instead of `BaseEntity` to avoid confusion with [TypeORM's built-in BaseEntity](https://typeorm.io/active-record-data-mapper#what-is-the-active-record-pattern) which provides Active Record pattern methods (`save()`, `remove()`, etc.). Our class only provides column inheritance.

### timestamped.entity.ts

```typescript
import {
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Abstract base entity providing common columns for all entities.
 *
 * @remarks
 * All entities must extend this class to ensure consistent:
 * - UUID primary keys
 * - Automatic timestamp management
 * - Standardized column naming via SnakeNamingStrategy
 *
 * IMPORTANT: This class does NOT have an @Entity() decorator.
 * Only concrete child entities should have @Entity().
 */
export abstract class TimestampedEntity {
  /**
   * Unique identifier for the entity.
   */
  @PrimaryGeneratedColumn("uuid", { comment: "Unique identifier (UUID v4)" })
  id: string;

  /**
   * Timestamp when the entity was created.
   */
  @CreateDateColumn({ comment: "Timestamp when record was created" })
  createdAt: Date;

  /**
   * Timestamp when the entity was last updated.
   */
  @UpdateDateColumn({ comment: "Timestamp when record was last updated" })
  updatedAt: Date;
}
```

### When NOT to Use TimestampedEntity

Per [The Hidden Costs of Using BaseEntity with TypeORM](https://medium.com/@dmitriykhirniy/the-hidden-costs-of-using-baseentity-with-typeorm-108a9cf40a7f), consider whether all entities need these columns:

| Entity Type | Recommendation |
|-------------|----------------|
| **Domain entities** (User, Organization) | Extend `TimestampedEntity` |
| **High-volume metrics/logs** | Consider minimal columns to reduce storage |
| **Junction tables** | May only need foreign keys, no timestamps |

For high-volume tables, create a minimal entity without inheritance:

```typescript
@Entity({ comment: "High-volume sensor readings - minimal columns for performance" })
export class SensorReading {
  @PrimaryGeneratedColumn("uuid", { comment: "Unique identifier" })
  id: string;

  @Column({ comment: "Sensor value", type: "decimal" })
  value: number;

  @Column({ comment: "Reading timestamp", type: "timestamptz" })
  timestamp: Date;
}
```

## Column Comments

All columns must have comments for database documentation.

### Required Comment Pattern

```typescript
@Entity({ comment: "Description of what this entity represents" })
export class User extends TimestampedEntity {
  // Simple column with comment
  @Column({ comment: "User's email address for authentication" })
  email: string;

  // Nullable column with comment
  @Column({ comment: "User's display name", nullable: true })
  displayName: string | null;

  // Typed column with comment
  @Column({ type: "uuid", comment: "Foreign key to organization" })
  @Index()
  organizationId: string;

  // Enum column with comment
  @Column({
    type: "enum",
    enum: UserRole,
    default: UserRole.MEMBER,
    comment: "User's role within the system",
  })
  role: UserRole;
}
```

### Comment Guidelines

| Guideline | Example |
|-----------|---------|
| Describe purpose, not type | "User's email for authentication" not "String email" |
| Include constraints | "Must be unique across all organizations" |
| Document relationships | "Foreign key to organization table" |
| Note special behavior | "Set to null when organization is deleted" |

## Foreign Key Indexing

All foreign keys must be indexed for query performance.

### Correct Pattern

```typescript
@Entity({ comment: "User entity with organization membership" })
export class User extends TimestampedEntity {
  // Foreign key column - MUST be indexed
  @Column({ type: "uuid", comment: "Foreign key to organization" })
  @Index()
  organizationId: string;

  // Relationship definition
  @ManyToOne(() => Organization, { onDelete: "SET NULL", nullable: true })
  @JoinColumn()
  organization: Organization;
}
```

### Composite Indexes

```typescript
@Entity({ comment: "Player statistics by season" })
@Index(["playerId", "seasonId"], { unique: true })
export class PlayerSeasonStat extends TimestampedEntity {
  @Column({ type: "uuid", comment: "Foreign key to player" })
  @Index()
  playerId: string;

  @Column({ type: "uuid", comment: "Foreign key to season" })
  @Index()
  seasonId: string;
}
```

## Relationship Patterns

### OneToMany with Cascade Delete

```typescript
@Entity({ comment: "Organization containing multiple users" })
export class Organization extends TimestampedEntity {
  @Column({ comment: "Organization name" })
  name: string;

  // Cascade delete orphaned rows when relationship is broken
  @OneToMany(() => User, user => user.organization, {
    orphanedRowAction: "delete",
  })
  users: User[];
}
```

### ManyToOne with Delete Strategy

```typescript
@Entity({ comment: "User with organization membership" })
export class User extends TimestampedEntity {
  @Column({ type: "uuid", comment: "Foreign key to organization", nullable: true })
  @Index()
  organizationId: string | null;

  // SET NULL: User survives when organization deleted
  @ManyToOne(() => Organization, { onDelete: "SET NULL", nullable: true })
  @JoinColumn()
  organization: Organization | null;
}
```

### Delete Strategy Reference

| Strategy | Use When |
|----------|----------|
| `CASCADE` | Child cannot exist without parent |
| `SET NULL` | Child should survive parent deletion |
| `NO ACTION` | Prevent deletion if children exist |
| `RESTRICT` | Same as NO ACTION (checked immediately) |

### ManyToMany Relationship

```typescript
@Entity({ comment: "User entity" })
export class User extends TimestampedEntity {
  @ManyToMany(() => Role)
  @JoinTable({
    name: "user_roles",
    joinColumn: { name: "user_id" },
    inverseJoinColumn: { name: "role_id" },
  })
  roles: Role[];
}
```

## Enum Columns

### Define Enum Type

```typescript
/**
 * Supported user roles in the system.
 */
export enum UserRole {
  ADMIN = "admin",
  MEMBER = "member",
  VIEWER = "viewer",
}
```

### Use in Entity

```typescript
@Entity({ comment: "User with role-based access" })
export class User extends TimestampedEntity {
  @Column({
    type: "enum",
    enum: UserRole,
    default: UserRole.MEMBER,
    comment: "User's role determining permissions",
  })
  role: UserRole;
}
```

## JSONB Columns

For flexible schema storage:

```typescript
/**
 * Custom settings interface.
 */
interface UserSettings {
  readonly theme: "light" | "dark";
  readonly notifications: boolean;
  readonly timezone: string;
}

@Entity({ comment: "User with customizable settings" })
export class User extends TimestampedEntity {
  @Column({
    type: "jsonb",
    default: {},
    comment: "User preferences stored as JSON",
  })
  settings: UserSettings;
}
```

## Database Views

For complex analytics queries, use ViewEntity:

```typescript
import { ViewColumn, ViewEntity } from "typeorm";

/**
 * Aggregated user statistics view.
 *
 * @remarks
 * This is a read-only view - synchronize: false ensures
 * TypeORM won't try to create/modify the view automatically.
 * The view must be created via migration.
 */
@ViewEntity({
  name: "user_stats_view",
  synchronize: false,
  expression: `
    SELECT
      u.id as user_id,
      u.organization_id,
      COUNT(DISTINCT w.id) as watchlist_count,
      MAX(u.updated_at) as last_activity
    FROM users u
    LEFT JOIN watchlists w ON w.user_id = u.id
    GROUP BY u.id, u.organization_id
  `,
})
export class UserStatsView {
  @ViewColumn({ name: "user_id" })
  userId: string;

  @ViewColumn({ name: "organization_id" })
  organizationId: string;

  @ViewColumn({ name: "watchlist_count" })
  watchlistCount: number;

  @ViewColumn({ name: "last_activity" })
  lastActivity: Date;
}
```

## Multi-Schema Support

For organizing entities into separate schemas:

```typescript
@Entity({
  schema: "analytics",
  comment: "Event tracking for user analytics",
})
export class AnalyticsEvent extends TimestampedEntity {
  @Column({ comment: "Event type identifier" })
  eventType: string;

  @Column({ type: "jsonb", comment: "Event payload data" })
  payload: Record<string, unknown>;
}
```

## Entity Export Pattern

All entities must be explicitly exported from `src/database/entities/index.ts`:

### entities/index.ts

```typescript
/**
 * Centralized entity exports for TypeORM configuration.
 *
 * @remarks
 * All entities must be exported here for esbuild compatibility.
 * Glob patterns don't work with esbuild bundling.
 */

// Abstract base entity (not exported to TypeORM, but available for extension)
export { TimestampedEntity } from "./timestamped.entity";

// Domain entities
export { User } from "./user.entity";
export { Organization } from "./organization.entity";
export { Watchlist } from "./watchlist.entity";

// View entities
export { UserStatsView } from "./user-stats.view";
```

### Adding New Entities Checklist

1. Create entity file: `src/database/entities/{name}.entity.ts`
2. Extend `TimestampedEntity` (or create minimal entity for high-volume tables)
3. Add `@Entity({ comment: "..." })` decorator (NOT on abstract base class)
4. Add column comments to all columns
5. Index all foreign key columns
6. Export from `src/database/entities/index.ts`
7. Generate migration: `bun migration:generate --name=Add{Name}Entity`

## Complete Entity Example

```typescript
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from "typeorm";
import { TimestampedEntity } from "./timestamped.entity";
import { Organization } from "./organization.entity";
import { Watchlist } from "./watchlist.entity";

/**
 * Supported user roles in the system.
 */
export enum UserRole {
  ADMIN = "admin",
  MEMBER = "member",
  VIEWER = "viewer",
}

/**
 * User settings interface for JSONB column.
 */
interface UserSettings {
  readonly theme?: "light" | "dark";
  readonly notifications?: boolean;
}

/**
 * Represents a user in the system.
 *
 * @remarks
 * Users belong to organizations and can create watchlists.
 * When an organization is deleted, the user's organizationId is set to null.
 */
@Entity({ comment: "Application users with organization membership" })
export class User extends TimestampedEntity {
  @Column({ comment: "User email address for authentication" })
  @Index({ unique: true })
  email: string;

  @Column({ comment: "User display name", nullable: true })
  displayName: string | null;

  @Column({
    type: "uuid",
    comment: "Foreign key to organization",
    nullable: true,
  })
  @Index()
  organizationId: string | null;

  @Column({
    type: "enum",
    enum: UserRole,
    default: UserRole.MEMBER,
    comment: "User role determining permissions",
  })
  role: UserRole;

  @Column({
    type: "jsonb",
    default: {},
    comment: "User preferences and settings",
  })
  settings: UserSettings;

  @ManyToOne(() => Organization, { onDelete: "SET NULL", nullable: true })
  @JoinColumn()
  organization: Organization | null;

  @OneToMany(() => Watchlist, watchlist => watchlist.user, {
    orphanedRowAction: "delete",
  })
  watchlists: Watchlist[];
}
```

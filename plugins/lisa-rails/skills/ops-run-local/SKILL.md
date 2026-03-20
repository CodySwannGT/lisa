---
name: ops-run-local
description: Manage the local Docker Compose development environment for Rails applications. Supports start, stop, restart, and status for the full stack or individual services.
allowed-tools:
  - Bash
  - Read
---

# Ops: Run Local

Manage the local Docker Compose development environment.

**Argument**: `$ARGUMENTS` — `start`, `stop`, `restart`, `status`, `start-app`, `start-services` (default: `start`)

## Prerequisites (run before any operation)

1. Verify Docker is running:
   ```bash
   docker info > /dev/null 2>&1 && echo "Docker OK" || echo "ERROR: Docker is not running — start Docker Desktop"
   ```

2. Check port availability:
   ```bash
   lsof -i :3000 2>/dev/null | grep LISTEN
   lsof -i :5432 2>/dev/null | grep LISTEN
   ```

3. Verify Ruby and Bundler are available:
   ```bash
   ruby --version && bundle --version
   ```

## Discovery

Read the project's `docker-compose.yml` (or `compose.yaml`) to identify available services. Common services include:

- `web` or `app` — the Rails application
- `postgres` or `db` — PostgreSQL database
- `worker` — Solid Queue background worker
- `css` — Tailwind CSS watch process

Read `Procfile.dev` if it exists — it defines the local development process manager configuration (typically run via `bin/dev`).

Read `config/database.yml` to understand which databases need to exist locally.

## Operations

### start (full stack)

Start all Docker Compose services and the Rails application.

1. **Start infrastructure services** (PostgreSQL, etc.):
   ```bash
   docker compose up -d postgres
   ```

2. **Wait for PostgreSQL** (up to 30 seconds):
   ```bash
   for i in $(seq 1 30); do
     docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1 && echo "PostgreSQL ready" && break
     sleep 1
   done
   ```

3. **Create and migrate databases** (if needed):
   ```bash
   bin/rails db:prepare
   ```

4. **Start the full stack** via `bin/dev` (Procfile.dev) or Docker Compose:
   ```bash
   # Option A: Procfile.dev (preferred — starts web, worker, CSS watcher)
   bin/dev
   ```
   Run this in the background using the Bash tool with `run_in_background: true`.

   ```bash
   # Option B: Docker Compose (if all services are containerized)
   docker compose up -d
   ```

5. **Wait for Rails** (up to 60 seconds):
   ```bash
   for i in $(seq 1 60); do
     curl -sf http://localhost:3000/up > /dev/null 2>&1 && echo "Rails ready" && break
     sleep 1
   done
   ```

6. Report status table.

### start-services (infrastructure only)

Start only infrastructure services (database, cache) without the Rails app.

```bash
docker compose up -d postgres
```

Wait for readiness:
```bash
for i in $(seq 1 30); do
  docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1 && echo "PostgreSQL ready" && break
  sleep 1
done
```

### start-app (Rails app only, assumes services are running)

```bash
bin/dev
```

Run in background. Verify:
```bash
for i in $(seq 1 60); do
  curl -sf http://localhost:3000/up > /dev/null 2>&1 && echo "Rails ready" && break
  sleep 1
done
```

### stop

Stop all local services.

```bash
# Stop Rails processes (bin/dev uses foreman which spawns child processes)
lsof -ti :3000 | xargs kill -9 2>/dev/null || echo "No Rails process on :3000"

# Stop Docker Compose services
docker compose down
```

### restart

1. Run **stop** (above).
2. Wait 2 seconds: `sleep 2`
3. Run **start** (above).
4. Verify all services respond.

### status

Check what is currently running and responsive.

```bash
echo "=== Port Check ==="
echo -n "Rails    :3000 — "; lsof -i :3000 2>/dev/null | grep LISTEN > /dev/null && echo "LISTENING" || echo "NOT LISTENING"
echo -n "Postgres :5432 — "; lsof -i :5432 2>/dev/null | grep LISTEN > /dev/null && echo "LISTENING" || echo "NOT LISTENING"

echo ""
echo "=== Health Check ==="
echo -n "Rails /up — "; curl -sf -o /dev/null -w "HTTP %{http_code} in %{time_total}s" http://localhost:3000/up 2>/dev/null || echo "UNREACHABLE"

echo ""
echo "=== Docker Compose ==="
docker compose ps 2>/dev/null || echo "No Docker Compose services running"

echo ""
echo "=== Solid Queue Worker ==="
bin/rails runner "puts SolidQueue::Process.where('last_heartbeat_at > ?', 5.minutes.ago).count.to_s + ' active workers'" 2>/dev/null || echo "Cannot query Solid Queue (app may not be running)"
```

Report results as a table:

| Service | Port | Listening | Responsive |
|---------|------|-----------|------------|
| Rails (web) | 3000 | YES/NO | YES/NO |
| PostgreSQL | 5432 | YES/NO | N/A |
| Solid Queue worker | N/A | N/A | YES/NO (heartbeat) |

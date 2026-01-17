# Prisma Lambda Layer Rebuild Guide

This guide explains how to rebuild the Prisma Lambda Layer when encountering schema sync issues.

## When to Rebuild

Rebuild the Lambda Layer when you see errors like:

```
PrismaClientValidationError: Unknown argument `userId`. Did you mean `user`?
```

This indicates the deployed Lambda Layer was built from a stale Prisma schema that doesn't match the current `@friggframework/core` schema.

## Prerequisites

- Node.js 18+
- `@friggframework/core` and `@friggframework/devtools` installed in `node_modules/`

## Quick Fix

```bash
cd /Users/danielklotz/projects/lefthook/quo--frigg/backend

# Remove old layer (if permission issues)
rm -rf layers/prisma

# Rebuild the Lambda Layer
node node_modules/@friggframework/devtools/infrastructure/scripts/build-prisma-layer.js

# Deploy to AWS
npx frigg deploy --stage <your-stage>
```

## What the Build Script Does

1. **Cleans** existing `layers/prisma/` directory
2. **Installs** `@prisma/client` runtime (excludes CLI to save ~82MB)
3. **Copies** generated Prisma clients from `@friggframework/core/generated/`
4. **Copies** migrations from `@friggframework/core/prisma-postgresql/migrations/`
5. **Removes** unnecessary files (source maps, docs, non-Linux binaries)
6. **Verifies** rhel-openssl-3.0.x binary is present for AWS Lambda

## Verifying the Fix

After rebuilding, verify the schema includes expected fields:

```bash
grep -A 15 "model Entity" layers/prisma/nodejs/node_modules/generated/prisma-postgresql/schema.prisma
```

Expected output should include all fields like `userId`, `data`, etc.

## Architecture

```
Source of Truth (tracked in git):
  @friggframework/core/prisma-postgresql/schema.prisma

Build Artifacts (gitignored, regenerated):
  @friggframework/core/generated/prisma-postgresql/
  layers/prisma/nodejs/node_modules/
```

The Lambda Layer is a **build artifact** - it gets regenerated from the source schema in `@friggframework/core` during the build process.

## Troubleshooting

### Permission Denied

If you get `EPERM: operation not permitted`:

```bash
rm -rf layers/prisma
# Then run the build script again
```

### Missing @friggframework/core

If the script can't find the core package:

```bash
npm install
```

### Wrong Prisma Version

The build script uses Prisma 6.x. If you have Prisma 7.x globally installed, the script handles this by using the local version from `node_modules`.

## Running Migrations in Hosted Environments

Frigg provides HTTP API endpoints for triggering and monitoring database migrations in deployed environments.

### Prerequisites

- `ADMIN_API_KEY` environment variable set
- `S3_BUCKET_NAME` or `MIGRATION_STATUS_BUCKET` for status tracking

### API Endpoints

All endpoints require the `x-frigg-admin-api-key` header.

#### Check Migration Status

```bash
curl -X GET "https://your-api.com/db-migrate/status" \
  -H "x-frigg-admin-api-key: your-admin-key"
```

Response:
```json
{
  "upToDate": false,
  "pendingMigrations": 2,
  "dbType": "postgresql",
  "stage": "production",
  "recommendation": "Run migrations to apply pending changes"
}
```

#### Trigger Migration (Async)

```bash
curl -X POST "https://your-api.com/db-migrate" \
  -H "x-frigg-admin-api-key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"dbType": "postgresql", "stage": "production"}'
```

Response (202 Accepted):
```json
{
  "success": true,
  "processId": "migration-abc123",
  "state": "INITIALIZING",
  "statusUrl": "/db-migrate/migration-abc123",
  "message": "Migration queued"
}
```

#### Check Migration Progress

```bash
curl -X GET "https://your-api.com/db-migrate/migration-abc123" \
  -H "x-frigg-admin-api-key: your-admin-key"
```

Response:
```json
{
  "processId": "migration-abc123",
  "type": "DATABASE_MIGRATION",
  "state": "COMPLETED",
  "context": {
    "dbType": "postgresql",
    "stage": "production"
  },
  "results": {
    "success": true,
    "duration": "2.5s"
  }
}
```

#### Resolve Failed Migration

If a migration fails and needs manual resolution:

```bash
curl -X POST "https://your-api.com/db-migrate/resolve" \
  -H "x-frigg-admin-api-key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"migrationName": "20251112195422_update_user_unique_constraints", "action": "applied"}'
```

### Migration States

| State | Description |
|-------|-------------|
| `INITIALIZING` | Migration job queued |
| `RUNNING` | Migration in progress |
| `COMPLETED` | Migration succeeded |
| `FAILED` | Migration failed (check results.error) |

## Related Files

- Build script: `node_modules/@friggframework/devtools/infrastructure/scripts/build-prisma-layer.js`
- Source schema: `node_modules/@friggframework/core/prisma-postgresql/schema.prisma`
- Generated client: `layers/prisma/nodejs/node_modules/generated/prisma-postgresql/`
- Migration router: `node_modules/@friggframework/core/handlers/routers/db-migration.js`

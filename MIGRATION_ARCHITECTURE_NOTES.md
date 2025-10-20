# Database Migration Architecture - Known Issues & Fixes Needed

## Current Status (QA Environment)

**Database:** Aurora PostgreSQL cluster `quo-aurora-cluster` is running and accessible  
**Credentials:** Manually set with URL-safe password: `FriggQA2025SecurePassword`  
**Issue:** Database `frigg` does not exist - migrations cannot create it  
**Workaround:** Database needs to be manually created via AWS RDS Query Editor or psql

## Migration Architecture Evolution

### Legacy (Removed)
- **dbMigrate** function - Synchronous Lambda that ran Prisma CLI directly
- **Problem:** 89MB package size, hardcoded schema paths, no async support

### Current (Partially Working)
- **dbMigrationRouter** - HTTP API (POST /db-migrate, GET /db-migrate/{processId})
- **dbMigrationWorker** - SQS worker that processes migration jobs
- **Queue:** DbMigrationQueue for async processing

## Critical Issue: Circular Dependency

**The Problem:**
```
migration-router.js 
  → requires process-repository-factory
    → loads database config
      → loads app definition (index.js)
        → requires ./src/integrations/ScalingTestIntegration
          → src/** is excluded from package for size optimization!
```

**Error:** `Cannot find module './src/integrations/ScalingTestIntegration'`

## Fixes Needed

### Option 1: Decouple Migration Infrastructure (RECOMMENDED)
Migration functions should NOT need the full app definition with integration classes.

**Changes Required:**
1. **Update process-repository-factory.js** to accept DB_TYPE from environment directly
   - Remove `getDatabaseType()` call that loads app definition
   - Use `process.env.DB_TYPE` or detect from `DATABASE_URL` protocol
   
2. **Update migration handlers** to not load integrations
   - Migration router only needs Process repository
   - Doesn't need Integration classes or Module factory

**Benefits:**
- ✅ Smaller package sizes (no src/** needed)
- ✅ Cleaner separation of concerns
- ✅ Migrations work independently of integration code

### Option 2: Include src/** in Migration Packages
- Add `src/**` to migration function packages
- **Downside:** Increases package size by ~50MB+
- **Not Recommended:** Violates separation of concerns

### Option 3: Use Secrets Manager Layer (Future)
- Implement Lambda extension for runtime secret resolution
- Allows DATABASE_URL to be fetched at runtime vs deployment time
- **Branch exists:** Check for Secrets Manager layer implementation

## Immediate Workaround for QA Testing

**Manual Database Creation:**
```sql
-- Connect to Aurora cluster via RDS Query Editor or psql
-- Endpoint: quo-aurora-cluster.cluster-cqh60qwqw0p8.us-east-1.rds.amazonaws.com:5432
-- User: postgres
-- Password: FriggQA2025SecurePassword

CREATE DATABASE frigg;
```

**Then run migrations via Frigg CLI locally:**
```bash
cd /Users/sean/Documents/GitHub/quo--frigg/backend
export DATABASE_URL="postgresql://postgres:FriggQA2025SecurePassword@quo-aurora-cluster.cluster-cqh60qwqw0p8.us-east-1.rds.amazonaws.com:5432/frigg"
frigg db:setup
```

## autoCreateCredentials Feature - Complete ✅

Successfully implemented and tested:
- ✅ Automatically creates Secrets Manager secret with auto-generated password
- ✅ CloudFormation Custom Resource rotates Aurora master password
- ✅ DATABASE_URL properly constructed with nested Fn::Sub for Ref objects
- ✅ URL-safe password generation (excludes `"@:/?#[]%\\`)
- ✅ Comprehensive test coverage (9 tests)

**Known Limitation:**
- CloudFormation `{{resolve:secretsmanager:...}}` is resolved at **deployment time**, not runtime
- If Custom Resource rotates password, Lambda env vars become stale
- **Solution:** Use Lambda layer for runtime secret fetching (future work)

## Package Size Optimizations - Complete ✅

All functions under 250MB limit:
- Core functions: 31 MB
- Migration worker/router: 72 MB each  
- Prisma layer: 17 MB

**Key Optimizations Applied:**
- Exclude nested node_modules, build tools, test files
- Exclude wrong OS binaries (darwin on Lambda)
- Include only required Prisma engines
- WASM files: Exclude runtime/*.wasm, but keep build/*.wasm for Prisma CLI

## Recommended Next Steps

1. **Fix process-repository-factory circular dependency** (Frigg Core)
2. **Test autoCreateCredentials with Secrets Manager layer** (future branch)
3. **For QA:** Manually create database and run migrations locally
4. **Proceed with integration testing** once database is initialized


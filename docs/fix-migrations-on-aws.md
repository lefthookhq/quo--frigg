# Fixing Database Migrations on AWS

This guide covers how to debug and fix Prisma migration issues in the Frigg/Quo AWS environments.

## Quick Reference

| Environment | API Base URL                                             | Bastion Host     |
| ----------- | -------------------------------------------------------- | ---------------- |
| dev         | `https://qj27h2g6i1.execute-api.us-east-1.amazonaws.com` | `54.166.108.144` |
| prod        | `https://oe4xqic7q9.execute-api.us-east-1.amazonaws.com` | `54.144.229.67`  |

## Get Environment Variables

### Admin API Keys

```bash
# Dev
AWS_PROFILE=quo-deploy aws lambda get-function-configuration \
  --function-name quo-integrations-dev-auth --region us-east-1 \
  --query 'Environment.Variables.ADMIN_API_KEY' --output text

# Prod
AWS_PROFILE=quo-deploy aws lambda get-function-configuration \
  --function-name quo-integrations-prod-auth --region us-east-1 \
  --query 'Environment.Variables.ADMIN_API_KEY' --output text
```

### Database Credentials

```bash
# Dev - get username and password
AWS_PROFILE=quo-deploy aws secretsmanager get-secret-value \
  --secret-id quo-integrations-dev-db-credentials --region us-east-1 \
  --query 'SecretString' --output text | jq .

# Prod - get username and password
AWS_PROFILE=quo-deploy aws secretsmanager get-secret-value \
  --secret-id quo-integrations-prod-db-credentials --region us-east-1 \
  --query 'SecretString' --output text | jq .

# Save password to file (avoids shell escaping issues)
AWS_PROFILE=quo-deploy aws secretsmanager get-secret-value \
  --secret-id quo-integrations-dev-db-credentials --region us-east-1 \
  --query 'SecretString' --output text | jq -r '.password' > /tmp/.pgpass_dev

AWS_PROFILE=quo-deploy aws secretsmanager get-secret-value \
  --secret-id quo-integrations-prod-db-credentials --region us-east-1 \
  --query 'SecretString' --output text | jq -r '.password' > /tmp/.pgpass_prod
```

### Database Cluster Endpoints

```bash
# List all cluster endpoints
AWS_PROFILE=quo-deploy aws rds describe-db-clusters --region us-east-1 \
  --query "DBClusters[?contains(DBClusterIdentifier, 'quo-integrations')].{ID:DBClusterIdentifier,Endpoint:Endpoint}" \
  --output table
```

### Bastion Host IPs

```bash
# Find all bastion instances
AWS_PROFILE=quo-deploy aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*bastion*" "Name=instance-state-name,Values=running" \
  --region us-east-1 \
  --query "Reservations[*].Instances[*].{Name:Tags[?Key=='Name'].Value|[0],IP:PublicIpAddress}" \
  --output table
```

### All Lambda Environment Variables

```bash
# Dev - all env vars
AWS_PROFILE=quo-deploy aws lambda get-function-configuration \
  --function-name quo-integrations-dev-auth --region us-east-1 \
  --query 'Environment.Variables' | jq .

# Prod - all env vars
AWS_PROFILE=quo-deploy aws lambda get-function-configuration \
  --function-name quo-integrations-prod-auth --region us-east-1 \
  --query 'Environment.Variables' | jq .
```

## Step 1: Identify the Problem

### Check Lambda Logs

```bash
# Dev auth lambda
AWS_PROFILE=quo-deploy aws logs tail /aws/lambda/quo-integrations-dev-auth --since 30m --format short --region us-east-1 | head -100

# Prod auth lambda
AWS_PROFILE=quo-deploy aws logs tail /aws/lambda/quo-integrations-prod-auth --since 30m --format short --region us-east-1 | head -100

# Migration worker logs (after triggering migration)
AWS_PROFILE=quo-deploy aws logs tail /aws/lambda/quo-integrations-dev-dbMigrationWorker --since 10m --format short --region us-east-1
AWS_PROFILE=quo-deploy aws logs tail /aws/lambda/quo-integrations-prod-dbMigrationWorker --since 10m --format short --region us-east-1
```

### Common Error Messages

1. **"The column `Entity.data` does not exist in the current database"**
   - Database is missing a migration
   - Solution: Run pending migrations

2. **"P3009 - migrate found failed migrations in the target database"**
   - A previous migration failed and is blocking new migrations
   - Solution: Clear the failed migration record from `_prisma_migrations` table

3. **"relation X already exists" (P2022, 42P07)**
   - Migration trying to create something that already exists (e.g., orphaned migration applied outside of Prisma history)
   - Solution: Edit migration SQL or mark orphaned migration as applied

## Step 2: Check Migration Status via API

### Get Admin API Key

```bash
# Dev
AWS_PROFILE=quo-deploy aws lambda get-function-configuration \
  --function-name quo-integrations-dev-auth --region us-east-1 \
  --query 'Environment.Variables.ADMIN_API_KEY' --output text

# Prod
AWS_PROFILE=quo-deploy aws lambda get-function-configuration \
  --function-name quo-integrations-prod-auth --region us-east-1 \
  --query 'Environment.Variables.ADMIN_API_KEY' --output text
```

### Check Migration Status

```bash
# Dev (replace API key)
curl -s -X GET "https://qj27h2g6i1.execute-api.us-east-1.amazonaws.com/db-migrate/status" \
  -H "x-frigg-admin-api-key: YOUR_DEV_API_KEY" | jq .

# Prod (use single quotes to avoid shell expansion of special characters)
curl -s -X GET "https://oe4xqic7q9.execute-api.us-east-1.amazonaws.com/db-migrate/status" \
  -H 'x-frigg-admin-api-key: YOUR_PROD_API_KEY' | jq .
```

### Trigger Migration

```bash
# Dev
curl -s -X POST "https://qj27h2g6i1.execute-api.us-east-1.amazonaws.com/db-migrate" \
  -H "x-frigg-admin-api-key: YOUR_DEV_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dbType": "postgresql", "stage": "dev"}' | jq .

# Prod
curl -s -X POST "https://oe4xqic7q9.execute-api.us-east-1.amazonaws.com/db-migrate" \
  -H 'x-frigg-admin-api-key: YOUR_PROD_API_KEY' \
  -H "Content-Type: application/json" \
  -d '{"dbType": "postgresql", "stage": "prod"}' | jq .
```

### Check Migration Progress

```bash
# Replace MIGRATION_ID with the ID returned from the trigger
curl -s "https://API_BASE_URL/db-migrate/MIGRATION_ID" \
  -H "x-frigg-admin-api-key: YOUR_API_KEY" | jq .
```

## Step 3: Connect to Database (If Manual Fix Required)

### Verify Tunnel Script is Up to Date

The tunnel script at `scripts/postgres-tunnel.sh` contains hardcoded cluster endpoints and bastion host IPs. If Aurora clusters or bastions have been recreated, the script may have stale values.

**Verify cluster endpoints match AWS:**

```bash
# Get current cluster endpoints from AWS
AWS_PROFILE=quo-deploy aws rds describe-db-clusters --region us-east-1 \
  --query "DBClusters[?contains(DBClusterIdentifier, 'quo-integrations')].{ID:DBClusterIdentifier,Endpoint:Endpoint}" \
  --output table

# Compare with what's in the script
grep -A1 "ENDPOINT=" scripts/postgres-tunnel.sh
```

**Verify bastion hosts match AWS:**

```bash
# Get current bastion IPs from AWS
AWS_PROFILE=quo-deploy aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*bastion*" "Name=instance-state-name,Values=running" \
  --region us-east-1 \
  --query "Reservations[*].Instances[*].{Name:Tags[?Key=='Name'].Value|[0],IP:PublicIpAddress}" \
  --output table

# Compare with what's in the script
grep "BASTION_HOST=" scripts/postgres-tunnel.sh
```

**If endpoints or bastions don't match**, update the script:

- Dev and local-dev use the dev bastion
- Prod uses the prod bastion
- Use **cluster** endpoints (contain `.cluster-`), not instance endpoints

### Start SSH Tunnel

```bash
# From project root
./scripts/postgres-tunnel.sh dev    # Connects on localhost:5433
./scripts/postgres-tunnel.sh prod   # Connects on localhost:5433

# If you need both environments simultaneously
./scripts/postgres-tunnel.sh dev 5433
./scripts/postgres-tunnel.sh prod 5434  # Different port
```

**Troubleshooting tunnel issues:**

| Symptom                         | Cause                           | Fix                                                       |
| ------------------------------- | ------------------------------- | --------------------------------------------------------- |
| `Name or service not known`     | Stale endpoint in script        | Update ENDPOINT in script with current AWS value          |
| Connection timeout              | Wrong bastion or security group | Verify BASTION_HOST matches environment                   |
| `Permission denied (publickey)` | Wrong SSH key                   | Ensure `backend/security/quo-postgres-bastion.pem` exists |

### Get Database Password

```bash
# Dev
AWS_PROFILE=quo-deploy aws secretsmanager get-secret-value \
  --secret-id quo-integrations-dev-db-credentials --region us-east-1 \
  --query 'SecretString' --output text | jq -r '.password'

# Prod
AWS_PROFILE=quo-deploy aws secretsmanager get-secret-value \
  --secret-id quo-integrations-prod-db-credentials --region us-east-1 \
  --query 'SecretString' --output text | jq -r '.password'
```

### Connect to Database

```bash
# Save password to avoid shell escaping issues
AWS_PROFILE=quo-deploy aws secretsmanager get-secret-value \
  --secret-id quo-integrations-dev-db-credentials --region us-east-1 \
  --query 'SecretString' --output text | jq -r '.password' > /tmp/.pgpass

# Connect
PGPASSWORD=$(cat /tmp/.pgpass) psql -h localhost -p 5433 -U postgres -d postgres
```

## Step 4: Diagnose Migration State

### View Migration History

```sql
SELECT migration_name, finished_at, applied_steps_count, rolled_back_at
FROM "_prisma_migrations"
ORDER BY started_at DESC
LIMIT 10;
```

### Identify Issues

- **`finished_at = NULL` and `applied_steps_count = 0`**: Migration failed
- **Migration exists in DB but not in code**: Orphaned migration
- **Migration exists in code but not in DB**: Pending migration

## Step 5: Fix Migration Issues

### Option A: Clear Failed Migration (Most Common)

If a migration failed and is blocking new migrations:

```sql
-- Find the failed migration
SELECT migration_name FROM "_prisma_migrations"
WHERE finished_at IS NULL AND applied_steps_count = 0;

-- Delete the failed record
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20251112195422_update_user_unique_constraints';
```

Then re-trigger the migration via API (see Step 2).

### Option B: Mark Orphaned Migration as Applied

If the database has changes that were applied manually or by a missing migration:

```sql
-- If the migration already ran successfully but isn't tracked
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (
  gen_random_uuid()::text,
  'manual',
  NOW(),
  '20251107003337_add_process_table',
  NULL,
  NULL,
  NOW(),
  1
);
```

### Option C: Edit Migration SQL (For Conflicts)

If a migration tries to create something that already exists:

1. Find the migration file in the Prisma layer:

   ```
   backend/node_modules/@friggframework/core/prisma-postgresql/migrations/MIGRATION_NAME/migration.sql
   ```

2. Edit the SQL to remove the conflicting statements

3. Rebuild and deploy the Prisma layer:

   ```bash
   cd backend
   npm run build:prisma-layer
   AWS_PROFILE=quo-deploy npx frigg deploy --stage=dev
   ```

4. Trigger the migration again

## Step 6: Verify Fix

### Check Entity Table Structure

```sql
\d "Entity"
```

### Verify Migration History

```sql
SELECT migration_name, finished_at, applied_steps_count
FROM "_prisma_migrations"
ORDER BY started_at DESC
LIMIT 5;
```

### Test the Lambda

Check the auth lambda logs again to confirm no more Prisma errors.

## Troubleshooting

### Tunnel Connection Times Out

1. **Verify bastion host is running:**

   ```bash
   AWS_PROFILE=quo-deploy aws ec2 describe-instances \
     --filters "Name=tag:Name,Values=*bastion*" "Name=instance-state-name,Values=running" \
     --region us-east-1 \
     --query "Reservations[*].Instances[*].{Name:Tags[?Key=='Name'].Value|[0],IP:PublicIpAddress}" \
     --output table
   ```

2. **Verify RDS cluster endpoint:**

   ```bash
   AWS_PROFILE=quo-deploy aws rds describe-db-clusters --region us-east-1 \
     --query "DBClusters[?contains(DBClusterIdentifier, 'dev') || contains(DBClusterIdentifier, 'prod')].{ID:DBClusterIdentifier,Endpoint:Endpoint}" \
     --output table
   ```

3. **Check security group allows bastion access:**
   - Each environment has its own bastion with specific security group access
   - Dev bastion: `54.166.108.144`
   - Prod bastion: `54.144.229.67`

### Password Contains Special Characters

Use single quotes or save to file:

```bash
# Save to file (recommended)
aws secretsmanager get-secret-value ... | jq -r '.password' > /tmp/.pgpass
PGPASSWORD=$(cat /tmp/.pgpass) psql ...

# Or use single quotes
PGPASSWORD='complex!password$here' psql ...
```

### API Returns 404 for /db-migrate/resolve

The resolve endpoint may not be deployed. Use direct SQL to fix:

```sql
DELETE FROM "_prisma_migrations" WHERE migration_name = 'MIGRATION_NAME';
```

## Prevention

1. **Always test migrations locally first** against a copy of the production schema
2. **Use `prisma migrate dev` locally** to generate migrations
3. **Review migration SQL** before deploying to catch potential conflicts
4. **Keep migration history in sync** between Frigg framework and deployed layer

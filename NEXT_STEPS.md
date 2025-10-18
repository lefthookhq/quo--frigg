# Next Steps for Integration Testing

## Current Status ✅

Phase 1 (Frigg Core Multi-Mode Auth) is **COMPLETE**:
- ✅ Created GetUserFromXFriggHeaders use case with conflict validation  
- ✅ Created GetUserFromAdopterJwt stub use case
- ✅ Created AuthenticateUser orchestrator
- ✅ Modified integration router for multi-mode auth
- ✅ Updated app definition schema
- ✅ Created comprehensive unit tests (30+ test cases)
- ✅ Updated quo--frigg app definition with authModes
- ✅ Created integration test helpers
- ✅ Created integration tests for all three integrations

## Immediate Next Steps 🚀

### Step 1: Commit Frigg Core Changes

```bash
cd /Users/sean/Documents/GitHub/frigg

# Review changes
git status
git diff packages/core packages/schemas

# Commit Frigg Core changes
git add packages/core/user/use-cases/get-user-from-x-frigg-headers.js
git add packages/core/user/use-cases/get-user-from-adopter-jwt.js
git add packages/core/user/use-cases/authenticate-user.js
git add packages/core/user/tests/use-cases/get-user-from-x-frigg-headers.test.js
git add packages/core/user/tests/use-cases/get-user-from-adopter-jwt.test.js
git add packages/core/integrations/integration-router.js
git add packages/core/integrations/tests/integration-router-multi-auth.test.js
git add packages/core/index.js

git add packages/schemas/schemas/app-definition.schema.json
git add packages/schemas/tests/schemas.test.js

git commit -m "feat: add multi-mode authentication (native token, x-frigg headers, JWT stub)

- Add GetUserFromXFriggHeaders for backend-to-backend auth
- Add GetUserFromAdopterJwt stub for future custom JWT support
- Add AuthenticateUser orchestrator with priority-based auth
- Update integration router to use multi-mode auth
- Add app definition schema for authModes and jwtConfig
- Add comprehensive unit tests (30+ test cases)
- Support auto-user creation from x-frigg headers
- Add user ID conflict detection and validation"
```

### Step 2: Run Frigg Tests

```bash
cd /Users/sean/Documents/GitHub/frigg

# Run all tests to ensure nothing broke
npm test

# Or run specific test suites
npm test -- --testPathPattern=get-user-from-x-frigg-headers
npm test -- --testPathPattern=get-user-from-adopter-jwt
npm test -- --testPathPattern=integration-router-multi-auth
npm test -- --testPathPattern=schemas.test
```

### Step 3: Publish Frigg Canary Version

**⚠️ USER ACTION REQUIRED**

```bash
cd /Users/sean/Documents/GitHub/frigg

# Publish new canary version
npm run publish:canary

# OR if using lerna:
npx lerna publish --canary --yes

# Note the version number that gets published
# Example output: "Published @friggframework/core@2.0.0--canary.462.abc1234.0"
```

**Record the new canary version number**: `________________`

### Step 4: Update quo--frigg Dependencies

```bash
cd /Users/sean/Documents/GitHub/quo--frigg/backend

# Replace XXX with the actual canary version from Step 3
npm install @friggframework/core@2.0.0--canary.XXX.XXXXXX.0
npm install @friggframework/devtools@2.0.0--canary.XXX.XXXXXX.0
npm install @friggframework/serverless-plugin@2.0.0--canary.XXX.XXXXXX.0
```

### Step 5: Test Locally

```bash
cd /Users/sean/Documents/GitHub/quo--frigg/backend

# Start local Frigg instance
npm run docker:start
npm run frigg:start

# In another terminal, run integration tests
cd /Users/sean/Documents/GitHub/quo--frigg/backend
export FRIGG_APP_API_KEY=test-api-key-local
export TEST_BASE_URL=http://localhost:3001
npm test -- --testPathPattern=integration.test
```

### Step 6: Commit quo--frigg Changes

```bash
cd /Users/sean/Documents/GitHub/quo--frigg

# Commit all changes
git add backend/index.js
git add backend/package.json backend/package-lock.json
git add backend/test/
git add MULTI_AUTH_IMPLEMENTATION_SUMMARY.md
git add NEXT_STEPS.md

git commit -m "feat: implement multi-auth support and integration tests

- Update app definition with authModes configuration
- Add integration test helpers for x-frigg header auth
- Add comprehensive integration tests for all integrations
- Update dependencies to Frigg canary vX.X.X
- Document multi-auth implementation and usage"
```

### Step 7: Branch Sync

```bash
cd /Users/sean/Documents/GitHub/quo--frigg

# Ensure we're on main
git checkout main

# Merge main into feature branches
git checkout feat/attio-integration
git merge main --no-edit
# Resolve any conflicts if needed

git checkout feat/sync-axisCare-clients-to-quo  
git merge main --no-edit
# Resolve any conflicts if needed

git checkout main
```

### Step 8: Deploy to QA

**⚠️ USER ACTION REQUIRED**

```bash
cd /Users/sean/Documents/GitHub/quo--frigg/backend

# Deploy main branch
AWS_PROFILE=lefthook-nagaris frigg deploy --stage qa

# Note the API Gateway URL from deployment output
```

### Step 9: Configure QA Environment

Set these environment variables in QA (via AWS Systems Manager Parameter Store or Lambda environment):

```bash
FRIGG_APP_API_KEY=<generate-secure-key>
QUO_API_KEY=<your-quo-qa-key>
SCALE_TEST_API_KEY=<your-scale-test-key>
AXISCARE_API_KEY=<your-axiscare-qa-key>
ATTIO_CLIENT_ID=<your-attio-client-id>
ATTIO_CLIENT_SECRET=<your-attio-client-secret>
```

### Step 10: Test on QA

```bash
cd /Users/sean/Documents/GitHub/quo--frigg/backend

# Configure test environment
export TEST_BASE_URL=<qa-api-gateway-url>
export FRIGG_APP_API_KEY=<qa-api-key>

# Run integration tests against QA
npm test -- --testPathPattern=ScalingTestIntegration.integration

# Check QA logs
aws logs tail /aws/lambda/quo-integrations-qa-auth --follow
```

### Step 11: Test Attio Branch on QA

```bash
cd /Users/sean/Documents/GitHub/quo--frigg

# Checkout Attio branch
git checkout feat/attio-integration

# Uncomment AttioIntegration in backend/index.js
# Then deploy
cd backend
AWS_PROFILE=lefthook-nagaris frigg deploy --stage qa

# Run Attio tests
npm test -- --testPathPattern=AttioIntegration.integration
```

### Step 12: Test AxisCare Branch on QA

```bash
cd /Users/sean/Documents/GitHub/quo--frigg

# Checkout AxisCare branch
git checkout feat/sync-axisCare-clients-to-quo

# Uncomment AxisCareIntegration in backend/index.js
# Then deploy
cd backend
AWS_PROFILE=lefthook-nagaris frigg deploy --stage qa

# Run AxisCare tests  
npm test -- --testPathPattern=AxisCareIntegration.integration
```

---

## Verification Checklist

Before considering this complete, verify:

- [ ] Frigg Core tests pass locally
- [ ] Frigg canary published successfully
- [ ] quo--frigg dependencies updated
- [ ] quo--frigg tests pass locally
- [ ] Main branch deployed to QA
- [ ] ScalingTest integration works on QA
- [ ] Attio branch merged with main
- [ ] Attio integration works on QA
- [ ] AxisCare branch merged with main
- [ ] AxisCare integration works on QA
- [ ] Auto-user creation works with x-frigg headers
- [ ] User ID conflict detection works (400 error)
- [ ] No breaking changes for existing functionality

---

## Troubleshooting

### Issue: Tests fail locally

**Check**:
- Are all dependencies installed? `npm install`
- Is Docker running? `npm run docker:start`
- Are environment variables set? Check `.env` file

### Issue: Canary publish fails

**Check**:
- Are you on the correct branch?
- Are all tests passing?
- Do you have npm publish permissions?
- Is lerna configured correctly?

### Issue: QA deployment fails

**Check**:
- Is AWS_PROFILE set correctly?
- Do you have AWS deployment permissions?
- Is the VPC properly configured?
- Are environment variables set?

### Issue: Integration tests fail on QA

**Check**:
- Is TEST_BASE_URL pointing to QA?
- Are API keys configured in QA environment?
- Are Lambda functions deployed successfully?
- Check CloudWatch logs for errors

---

## Support

For assistance:
1. Check MULTI_AUTH_IMPLEMENTATION_SUMMARY.md
2. Review integration test examples
3. Check CloudWatch logs
4. Review Frigg Core unit tests for usage patterns


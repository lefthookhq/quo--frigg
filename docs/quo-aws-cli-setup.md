# Quo AWS CLI Setup Guide

This guide explains how to configure AWS CLI access to the Quo AWS account (973314620327) from your local machine.

## Prerequisites

- Access to the Lefthook AWS SSO portal: `https://lefthook.awsapps.com/start`
- AWS CLI installed on your local machine (version 2.x recommended)

## Recommended Setup: AWS SSO (One-Time Configuration)

This is the **easiest and most secure** method. Configure once, then just login when needed.

### Step 1: Configure AWS SSO for Lefthook Account

Run the SSO configuration wizard:

```bash
aws configure sso
```

When prompted, enter:

- **SSO session name**: `lefthook` (or any name you prefer)
- **SSO start URL**: `https://lefthook.awsapps.com/start`
- **SSO region**: `us-east-1`
- **SSO registration scopes**: (press Enter to use default)

Your browser will open. Log in with your credentials and authorize the CLI.

Then select:

- **Account**: `757210591029` (Lefthook account)
- **Role**: Choose the appropriate role (e.g., `PowerUserAccess`)
- **CLI default region**: `us-east-1`
- **CLI profile name**: `lefthook-sso` (or your preferred name)

### Step 2: Login to AWS SSO

Whenever your session expires, simply run:

```bash
aws sso login --profile lefthook-sso
```

This will open your browser for re-authentication and refresh your credentials automatically.

### Step 3: Access Quo Account via Role Assumption

Once logged into the Lefthook account via SSO, you can assume the role to access the Quo account.

First, add this profile to your `~/.aws/config`:

```ini
[profile quo]
role_arn = arn:aws:iam::973314620327:role/LefthookAssumedRole
external_id = the-external-id-from-1password
source_profile = lefthook-sso
region = us-east-1
```

Now you can access the Quo account:

```bash
aws sts get-caller-identity --profile quo
```

**That's it!** No more manual credential management or CloudShell scripts.

### Benefits of SSO Approach

✅ **No manual token refresh** - SSO handles it automatically  
✅ **Secure** - No long-lived credentials stored  
✅ **Simple** - Just `aws sso login` when needed  
✅ **Multi-account** - Easy to switch between accounts

---

## Alternative: Manual CloudShell Method (Legacy)

⚠️ **Only use this if SSO is not available.** This method requires manual credential refresh every hour.

### Step 1: Log into Lefthook AWS Console

1. Go to the AWS Console
2. Log into account **757210591029** (Lefthook account)

### Step 2: Open CloudShell

1. In the AWS Console, click on the CloudShell icon (terminal icon in the top navigation bar)
2. Wait for CloudShell to initialize

### Step 3: Run the Credentials Script in CloudShell

Copy and paste the following script into CloudShell:

```bash
#!/bin/bash

# Configuration
ROLE_ARN="arn:aws:iam::973314620327:role/LefthookAssumedRole"
EXTERNAL_ID="the-external-id-from-1password"
SESSION_NAME="quo-session"

# Assume the role
echo "Assuming role..."
CREDS=$(aws sts assume-role \
  --role-arn "$ROLE_ARN" \
  --role-session-name "$SESSION_NAME" \
  --external-id "$EXTERNAL_ID" \
  --output json)

if [ $? -ne 0 ]; then
    echo "Failed to assume role"
    exit 1
fi

# Extract credentials
ACCESS_KEY=$(echo "$CREDS" | jq -r '.Credentials.AccessKeyId')
SECRET_KEY=$(echo "$CREDS" | jq -r '.Credentials.SecretAccessKey')
SESSION_TOKEN=$(echo "$CREDS" | jq -r '.Credentials.SessionToken')

# Output commands for local machine
echo ""
echo "=== Copy these commands to run on your local machine ==="
echo ""
echo "aws configure set aws_access_key_id $ACCESS_KEY --profile lefthook-quo"
echo "aws configure set aws_secret_access_key $SECRET_KEY --profile lefthook-quo"
echo "aws configure set aws_session_token $SESSION_TOKEN --profile lefthook-quo"
echo ""
echo "These credentials will expire in 1 hour."
```

### Step 4: Copy the Output Commands

The script will output three `aws configure set` commands with the actual credentials filled in. They will look like:

```bash
aws configure set aws_access_key_id ASIA... --profile lefthook-quo
aws configure set aws_secret_access_key ... --profile lefthook-quo
aws configure set aws_session_token ... --profile lefthook-quo
```

### Step 5: Configure Your Local AWS CLI

1. Open your local terminal
2. Paste and run the three commands from Step 4
3. Set the region (first time only):
   ```bash
   aws configure set region us-east-1 --profile lefthook-quo
   ```

### Step 4: Verify the Setup (Manual Method)

Test that the profile works:

```bash
aws sts get-caller-identity --profile lefthook-quo
```

You should see output showing:

- **Account**: `973314620327` (Quo account)
- **Arn**: `arn:aws:sts::973314620327:assumed-role/LefthookAssumedRole/quo-session`

---

## Using the Profiles

### With SSO (Recommended)

```bash
# First, login if needed
aws sso login --profile lefthook-sso

# Then use the quo profile (automatically assumes the role)
aws s3 ls --profile quo
aws rds describe-db-instances --profile quo
aws ec2 describe-instances --profile quo
```

### With Manual Credentials (Legacy)

```bash
# Use the manually configured profile
aws s3 ls --profile lefthook-quo
aws rds describe-db-instances --profile lefthook-quo
aws ec2 describe-instances --profile lefthook-quo
```

---

## Troubleshooting

### SSO Login Issues

**Error: "SSO session has expired"**

```bash
# Simply re-login
aws sso login --profile lefthook-sso
```

**Error: "The SSO session associated with this profile has expired"**

```bash
# Re-login to refresh
aws sso login --profile lefthook-sso
```

**Browser doesn't open**

- Copy the URL and code shown in the terminal
- Open it manually in your browser
- Enter the code when prompted

### Manual Credential Issues

**"Failed to assume role"**

- Verify you're logged into the correct Lefthook AWS account
- Check that the ROLE_ARN and EXTERNAL_ID are correct
- Ensure your user has permission to assume the role

**"The security token is expired"** (Manual method only)

- Run the CloudShell script again to get fresh credentials
- Credentials expire after 1 hour and must be refreshed

**"command not found: jq"** (Manual method only)

- CloudShell should have `jq` pre-installed
- If missing, you can install it or parse the JSON manually

---

## Quick Reference

### SSO Method (Recommended)

```bash
# Initial setup (one-time)
aws configure sso

# Daily usage
aws sso login --profile lefthook-sso
aws s3 ls --profile quo

# Profile config in ~/.aws/config
[profile quo]
role_arn = arn:aws:iam::973314620327:role/LefthookAssumedRole
external_id = the-external-id-from-1password
source_profile = lefthook-sso
region = us-east-1
```

### Manual Method (Legacy)

```bash
# Login to AWS Console → CloudShell → Run script
# Copy and run the three aws configure set commands
# Use the profile
aws s3 ls --profile lefthook-quo
```

---

## Bonus: Generate Console URL for Quo Account

If you need to access the Quo AWS Console (not just CLI), you can use this script in CloudShell:

```bash
#!/bin/bash

ROLE_ARN="arn:aws:iam::973314620327:role/LefthookAssumedRole"
EXTERNAL_ID="the-external-id-from-1password"
SESSION_NAME="quo-session"

echo "Assuming role..."
CREDS=$(aws sts assume-role \
  --role-arn "$ROLE_ARN" \
  --role-session-name "$SESSION_NAME" \
  --external-id "$EXTERNAL_ID" \
  --output json)

if [ $? -ne 0 ]; then
    echo "Failed to assume role"
    exit 1
fi

ACCESS_KEY=$(echo "$CREDS" | jq -r '.Credentials.AccessKeyId')
SECRET_KEY=$(echo "$CREDS" | jq -r '.Credentials.SecretAccessKey')
SESSION_TOKEN=$(echo "$CREDS" | jq -r '.Credentials.SessionToken')

echo "Getting signin token..."
SESSION_JSON="{\"sessionId\":\"$ACCESS_KEY\",\"sessionKey\":\"$SECRET_KEY\",\"sessionToken\":\"$SESSION_TOKEN\"}"

SIGNIN_RESPONSE=$(curl -s "https://signin.aws.amazon.com/federation" \
  --data-urlencode "Action=getSigninToken" \
  --data-urlencode "Session=$SESSION_JSON")

SIGNIN_TOKEN=$(echo "$SIGNIN_RESPONSE" | jq -r '.SigninToken')

if [ "$SIGNIN_TOKEN" = "null" ] || [ -z "$SIGNIN_TOKEN" ]; then
    echo "Failed to get signin token"
    exit 1
fi

CONSOLE_URL="https://signin.aws.amazon.com/federation?Action=login&Issuer=CloudShell&Destination=https://console.aws.amazon.com/&SigninToken=$SIGNIN_TOKEN"

echo ""
echo "🎉 Console URL generated successfully!"
echo ""
echo "Click this URL to open the AWS Console:"
echo "$CONSOLE_URL"
echo ""
```

This will generate a clickable URL to access the Quo AWS Console directly.

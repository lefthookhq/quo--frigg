# Quo AWS CLI Setup Guide

This guide explains how to configure AWS CLI access to the Quo AWS account (973314620327) from your local machine.

## Overview

To access the Quo AWS account via CLI, you need to:

1. Log into the Lefthook AWS account console
2. Use CloudShell to assume a role in the Quo account
3. Configure your local AWS CLI with the temporary credentials

## Prerequisites

- Access to the Lefthook AWS account (757210591029) console
- AWS CLI installed on your local machine
- `jq` installed (for JSON parsing in CloudShell)

## Step-by-Step Setup

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

### Step 6: Verify the Setup

Test that the profile works:

```bash
aws sts get-caller-identity --profile lefthook-quo
```

You should see output showing:

- **Account**: `973314620327` (Quo account)
- **Arn**: `arn:aws:sts::973314620327:assumed-role/LefthookAssumedRole/quo-session`

## Using the Profile

Once configured, you can use the `lefthook-quo` profile with any AWS CLI command:

```bash
# List S3 buckets
aws s3 ls --profile lefthook-quo

# Describe RDS instances
aws rds describe-db-instances --profile lefthook-quo

# List EC2 instances
aws ec2 describe-instances --profile lefthook-quo
```

## Important Notes

### Credential Expiration

⚠️ **The credentials expire after 1 hour**

When your credentials expire, you'll see an error like:

```
An error occurred (ExpiredToken) when calling the ... operation
```

To refresh:

1. Go back to Step 2 (CloudShell)
2. Run the script again (Step 3)
3. Run the three new `aws configure set` commands (Step 5)

### Security Considerations

- These are temporary credentials with limited permissions
- The `external_id` acts as a security measure to prevent unauthorized access
- Never commit the credentials to version control
- The credentials automatically expire, reducing security risk

## Troubleshooting

### "Failed to assume role"

- Verify you're logged into the correct Lefthook AWS account
- Check that the ROLE_ARN and EXTERNAL_ID are correct
- Ensure your user has permission to assume the role

### "The security token is expired"

- Run the CloudShell script again to get fresh credentials
- Credentials expire after 1 hour and must be refreshed

### "command not found: jq"

- CloudShell should have `jq` pre-installed
- If missing, you can install it or parse the JSON manually

## Alternative: Generate Console URL

If you need to access the AWS Console (not just CLI), you can use this extended script in CloudShell:

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

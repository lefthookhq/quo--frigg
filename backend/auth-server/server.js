require('dotenv').config();

const express = require('express');
const app = express();
const PORT = process.env.PORT || 5173;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const FRIGG_API_KEY = process.env.FRIGG_API_KEY || '';
const FRIGG_APP_USER_ID = process.env.FRIGG_APP_USER_ID || 'test-user-oauth';
const FRIGG_APP_ORG_ID = process.env.FRIGG_APP_ORG_ID || 'test-org-oauth';

// Handle OAuth redirect callback
app.get('/redirect/:appId', async (req, res) => {
    const { appId } = req.params;
    const { error, error_description, ...authParams } = req.query;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔐 OAuth Redirect Received`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`App ID: ${appId}`);
    console.log(`Params:`, Object.keys(authParams));

    // Handle OAuth errors
    if (error) {
        console.error(`\n❌ OAuth Error: ${error}`);
        console.error(`Description: ${error_description}`);
        return res.status(400).json({ error, error_description });
    }

    if (!authParams.code) {
        console.error(`\n❌ No authorization code received`);
        return res.status(400).json({ error: 'missing_code' });
    }

    try {
        console.log(`\n📡 Calling Backend...`);
        console.log(`POST ${BACKEND_URL}/api/authorize`);
        console.log(`Body:`, {
            entityType: appId,
            data: {
                ...authParams,
                code: authParams.code.substring(0, 20) + '...',
            },
        });

        // Exchange code for tokens via backend using x-frigg-api-key authentication
        const headers = {
            'Content-Type': 'application/json',
        };

        if (FRIGG_API_KEY) {
            console.log(`Using x-frigg-api-key header for authentication`);
            headers['x-frigg-api-key'] = FRIGG_API_KEY;
            headers['x-frigg-appuserid'] = FRIGG_APP_USER_ID;
            headers['x-frigg-apporgid'] = FRIGG_APP_ORG_ID;
        }

        const response = await fetch(`${BACKEND_URL}/api/authorize`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                entityType: appId,
                data: authParams,
            }),
        });

        const result = await response.json();

        if (!response.ok) {
            console.error(`\n❌ Backend Error (${response.status}):`, result);
            return res.status(response.status).json(result);
        }

        console.log(`\n✅ Success!`);
        console.log(`Credential ID: ${result.credential_id}`);
        console.log(`Entity ID: ${result.entity_id}`);
        console.log(`Type: ${result.type}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

        res.json(result);
    } catch (error) {
        console.error(`\n❌ Error:`, error.message);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 OAuth Test Server`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ Listening on: http://localhost:${PORT}`);
    console.log(`📍 Redirect URL: http://localhost:${PORT}/redirect/attio`);
    console.log(`🔗 Backend URL: ${BACKEND_URL}`);
    console.log(
        `🔑 FRIGG API Key: ${FRIGG_API_KEY ? 'Configured ✓' : 'Not set ✗'}`,
    );
    console.log(`👤 App User ID: ${FRIGG_APP_USER_ID}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});

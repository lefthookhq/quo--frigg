require('dotenv').config();

const express = require('express');
const app = express();
const PORT = process.env.PORT || 5173;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const FRIGG_JWT_TOKEN = process.env.FRIGG_JWT_TOKEN || '';

// Handle OAuth redirect callback
app.get('/redirect/:appId', async (req, res) => {
    const { appId } = req.params;
    const { code, state, error, error_description } = req.query;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔐 OAuth Redirect Received`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`App ID: ${appId}`);
    console.log(`Code: ${code?.substring(0, 20)}...`);
    console.log(`State: ${state}`);

    // Handle OAuth errors
    if (error) {
        console.error(`\n❌ OAuth Error: ${error}`);
        console.error(`Description: ${error_description}`);
        return res.status(400).json({ error, error_description });
    }

    if (!code) {
        console.error(`\n❌ No authorization code received`);
        return res.status(400).json({ error: 'missing_code' });
    }

    try {
        console.log(`\n📡 Calling Backend...`);
        console.log(`POST ${BACKEND_URL}/api/authorize`);
        console.log(`Body:`, {
            entityType: appId,
            data: { code: code.substring(0, 20) + '...' },
        });

        // Exchange code for tokens via backend
        const headers = {
            'Content-Type': 'application/json',
        };

        if (FRIGG_JWT_TOKEN) {
            headers['Authorization'] = `Bearer ${FRIGG_JWT_TOKEN}`;
        }

        const response = await fetch(`${BACKEND_URL}/api/authorize`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                entityType: appId,
                data: { code },
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
        `🔑 FRIGG JWT Token: ${FRIGG_JWT_TOKEN ? 'Configured ✓' : 'Not set ✗'}`,
    );
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});

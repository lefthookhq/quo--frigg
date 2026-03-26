require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const http = require('http');
const { URL } = require('url');
const { Definition } = require(require('path').join(__dirname, '../backend/node_modules/@friggframework/api-module-pipedrive'));

const Api = Definition.API;

const api = new Api({
    client_id: process.env.PIPEDRIVE_CLIENT_ID,
    client_secret: process.env.PIPEDRIVE_CLIENT_SECRET,
    scope: 'base activities:full contacts:full webhooks:full users:read',
    redirect_uri: process.env.REDIRECT_URI + '/pipedrive'
});

const authUrl = api.getAuthorizationUri();
console.log('\n🔗 Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for OAuth callback on port 3333...\n');

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost:3333');

    if (url.pathname.includes('pipedrive') && url.searchParams.get('code')) {
        const code = url.searchParams.get('code');
        console.log('✓ Received authorization code');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization received! Check your terminal.</h1>');

        try {
            const tokenResponse = await api.getTokenFromCode(code);
            console.log('\n✓ Token exchange successful');
            console.log('  api_domain:', tokenResponse.api_domain || api.companyDomain);

            console.log('\n--- Full /v1/users/me response ---');
            const me = await api.getUser();
            console.log(JSON.stringify(me.data, null, 2));

            // Also try direct fetch with bearer token
            console.log('\n--- Direct fetch /v1/users with bearer token ---');
            try {
                const domain = api.companyDomain || tokenResponse.api_domain;
                const resp = await fetch(`${domain}/api/v1/users`, {
                    headers: { 'Authorization': `Bearer ${api.access_token}` }
                });
                const data = await resp.json();
                if (data.success && data.data) {
                    console.log(`Found ${data.data.length} users:\n`);
                    console.log(JSON.stringify(data.data, null, 2));
                } else {
                    console.log('Response:', JSON.stringify(data));
                }
            } catch (directErr) {
                console.log('Direct fetch failed:', directErr.message);
            }

            console.log('\n--- Attempting via api.listUsers() ---');
            try {
                const users = await api.listUsers();
                if (users.data) {
                    console.log(`Found ${users.data.length} users:\n`);
                    for (const u of users.data) {
                        console.log(`  - id: ${u.id}, name: "${u.name}", email: "${u.email}", active: ${u.active_flag}`);
                    }
                } else {
                    console.log('Response:', JSON.stringify(users, null, 2));
                }
            } catch (listErr) {
                console.log('listUsers failed:', listErr.message?.substring(0, 500));

                // Try with API token from /users/me response if available
                const apiToken = tokenResponse.api_token;
                if (apiToken) {
                    const fetch = require('node-fetch');
                    const domain = api.companyDomain || tokenResponse.api_domain;
                    const resp = await fetch(`${domain}/api/v1/users?api_token=${apiToken}`);
                    const data = await resp.json();
                    if (data.data) {
                        console.log(`Found ${data.data.length} users (via API token):\n`);
                        for (const u of data.data) {
                            console.log(`  - id: ${u.id}, name: "${u.name}", email: "${u.email}", active: ${u.active_flag}`);
                        }
                    }
                } else {
                    console.log('No API token available. 403 error: app needs users:read scope in Developer Hub.');
                }
            }
        } catch (err) {
            console.error('\n✗ Error:', err.message);
        }

        server.close();
        process.exit(0);
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(3333, () => {
    const open = require('child_process').exec;
    open(`open "${authUrl}"`);
});

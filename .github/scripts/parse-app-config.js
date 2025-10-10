#!/usr/bin/env node

/**
 * Parse app definition from backend/index.js to determine deployment configuration
 */

const fs = require('fs');
const path = require('path');

function parseAppDefinition() {
    try {
        // Read the app definition file
        // When running from GitHub Actions in backend directory, we need to find index.js
        const appDefPath = process.cwd().endsWith('backend') 
            ? path.join(process.cwd(), 'index.js')
            : path.join(__dirname, '../../backend/index.js');
        
        console.log(`Reading app definition from: ${appDefPath}`);
        
        if (!fs.existsSync(appDefPath)) {
            throw new Error(`App definition file not found at: ${appDefPath}`);
        }
        
        const appDefContent = fs.readFileSync(appDefPath, 'utf8');
        
        // Extract configuration using regex patterns instead of eval
        // This avoids issues with undefined variables like AsanaIntegration
        const config = {
            // Check for KMS configuration using the new format
            hasKMSEncryption: /fieldLevelEncryptionMethod:\s*['"]kms['"]/.test(appDefContent),
            hasVPC: /vpc:\s*{\s*enable:\s*true/.test(appDefContent),
            hasSSM: /ssm:\s*{\s*enable:\s*true/.test(appDefContent),
            useUserConfig: /user:\s*{\s*usePassword:\s*true/.test(appDefContent),
            usesDocumentDB: /documentDB:\s*{\s*enable:\s*true/.test(appDefContent),
        };

        // Extract app name
        const nameMatch = appDefContent.match(/name:\s*['"]([^'"]+)['"]/);
        if (nameMatch) {
            config.appName = nameMatch[1];
        }
        
        // Extract environment variables
        const envMatch = appDefContent.match(/environment:\s*{([^}]+)}/s);
        if (envMatch) {
            const envSection = envMatch[1];
            // Match all keys that are set to true
            const envVarMatches = envSection.matchAll(/(\w+):\s*true/g);
            config.environmentVars = [];
            for (const match of envVarMatches) {
                config.environmentVars.push(match[1]);
            }
        }
        
        return config;
    } catch (error) {
        console.error('Error parsing app definition:', error.message);
        console.error('Current working directory:', process.cwd());
        console.error('Script directory:', __dirname);
        process.exit(1);
    }
}

function main() {
    const config = parseAppDefinition();
    
    // Output configuration for GitHub Actions
    console.log('App Definition Configuration:');
    console.log(`App Name: ${config.appName || 'unknown'}`);
    console.log(`KMS Encryption: ${config.hasKMSEncryption}`);
    console.log(`VPC Enabled: ${config.hasVPC}`);
    console.log(`SSM Enabled: ${config.hasSSM}`);
    console.log(`User Config: ${config.useUserConfig}`);
    console.log(`Uses DocumentDB: ${config.usesDocumentDB}`);

    if (config.environmentVars && config.environmentVars.length > 0) {
        console.log(`Environment Variables: ${config.environmentVars.join(', ')}`);
    }

    // Set GitHub Actions outputs
    if (process.env.GITHUB_OUTPUT) {
        const outputs = [
            `app_name=${config.appName || 'unknown'}`,
            `has_kms=${config.hasKMSEncryption}`,
            `has_vpc=${config.hasVPC}`,
            `has_ssm=${config.hasSSM}`,
            `use_user_config=${config.useUserConfig}`,
            `uses_documentdb=${config.usesDocumentDB}`,
            `deployment_type=${config.hasSSM ? 'ssm' : 'direct'}`,
            `environment_vars=${(config.environmentVars || []).join(',')}`
        ];

        fs.appendFileSync(process.env.GITHUB_OUTPUT, outputs.join('\n') + '\n');
    }
    
    // Also output as JSON for potential other uses
    console.log('\nJSON Config:');
    console.log(JSON.stringify(config, null, 2));
}

if (require.main === module) {
    main();
}

module.exports = { parseAppDefinition };
const { createFriggInfrastructure } = require('@friggframework/devtools');
const { Definition: appDef } = require('./index');

// Apply queueConfig.maxConcurrency from integration CRMConfig to the generated
// serverless definition. The framework hardcodes reservedConcurrency: 20 for all
// queue workers — this override lets each integration specify its own limit.
async function buildInfrastructure() {
    const definition = await createFriggInfrastructure();

    for (const integration of appDef.integrations || []) {
        const name = integration.Definition?.name;
        const maxConcurrency = integration.CRMConfig?.queueConfig?.maxConcurrency;
        if (!name || !maxConcurrency) continue;

        const workerKey = `${name}QueueWorker`;
        if (definition.functions?.[workerKey]) {
            definition.functions[workerKey].reservedConcurrency = maxConcurrency;
        }
    }

    return definition;
}

module.exports = buildInfrastructure();

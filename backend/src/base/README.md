# BaseCRMIntegration Framework

Base class and services for building CRM integrations with Quo (OpenPhone).

## Overview

The `BaseCRMIntegration` framework provides a composable, well-tested foundation for syncing contact data from any CRM to Quo. It implements:

- **Initial Mass Sync** (reverse chronological, newest first)
- **Ongoing Sync** (webhooks + polling fallback)
- **Outbound Activity Logging** (SMS & Call records to CRM)
- **Process State Management** (track long-running operations)
- **Queue-Based Concurrency** (fan-out pattern for fast syncs)

## Architecture

### Design Philosophy

- **DDD/Hexagonal Architecture**: Clear separation between domain logic, services, and data access
- **Dependency Injection**: Services composed via constructor injection for testability
- **Lazy Initialization**: Factory methods enable test doubles without complex mocking
- **Service Composition**: BaseCRMIntegration delegates to specialized services

### Components

```
BaseCRMIntegration (Base Class)
├── ProcessManager (Service)
│   ├── CreateProcess (Use Case - Frigg Core)
│   ├── UpdateProcessState (Use Case - Frigg Core)
│   ├── UpdateProcessMetrics (Use Case - Frigg Core)
│   └── GetProcess (Use Case - Frigg Core)
├── QueueManager (Service)
│   └── QueuerUtil (Frigg Core)
└── SyncOrchestrator (Service)
    ├── ProcessManager
    └── QueueManager
```

## Creating a New CRM Integration

### Step 1: Define CRM Configuration

```javascript
const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');

class MyCRMIntegration extends BaseCRMIntegration {
    static CRMConfig = {
        personObjectTypes: [
            { crmObjectName: 'Contact', quoContactType: 'contact' },
            { crmObjectName: 'Lead', quoContactType: 'contact' }
        ],
        syncConfig: {
            reverseChronological: true,
            initialBatchSize: 100,
            ongoingBatchSize: 50,
            supportsWebhooks: true,
            pollIntervalMinutes: 60
        },
        queueConfig: {
            maxWorkers: 25,
            provisioned: 10
        }
    };
    
    // ... implement 5 required methods
}
```

### Step 2: Implement 5 Required Methods

#### 1. fetchPersonPage

Fetch a page of persons from the CRM API.

```javascript
async fetchPersonPage({ objectType, page, limit, modifiedSince, sortDesc }) {
    const response = await this.mycrm.api.getPersons({
        type: objectType,
        page,
        limit,
        sort: sortDesc ? 'desc' : 'asc',
        modifiedSince
    });

    return {
        data: response.records,
        total: response.total,
        hasMore: response.hasMore
    };
}
```

#### 2. transformPersonToQuo

Transform CRM person format to Quo contact format.

```javascript
async transformPersonToQuo(person) {
    return {
        externalId: person.id,
        source: 'mycrm-person',
        defaultFields: {
            firstName: person.first_name,
            lastName: person.last_name,
            emails: person.emails.map(e => ({ value: e.address })),
            phoneNumbers: person.phones.map(p => ({ value: p.number }))
        },
        customFields: {
            crmId: person.id,
            crmType: 'mycrm',
            lastModified: person.updated_at
        }
    };
}
```

#### 3. logSMSToActivity

Log an SMS activity to the CRM.

```javascript
async logSMSToActivity(activity) {
    await this.mycrm.api.createActivity({
        type: 'sms',
        contactId: activity.contactExternalId,
        direction: activity.direction,
        body: activity.content,
        timestamp: activity.timestamp
    });
}
```

#### 4. logCallToActivity

Log a call activity to the CRM.

```javascript
async logCallToActivity(activity) {
    await this.mycrm.api.createActivity({
        type: 'call',
        contactId: activity.contactExternalId,
        direction: activity.direction,
        duration: activity.duration,
        summary: activity.summary,
        timestamp: activity.timestamp
    });
}
```

#### 5. setupWebhooks

Configure webhooks with the CRM (if supported).

```javascript
async setupWebhooks() {
    const webhookUrl = `${process.env.API_URL}/api/mycrm/webhooks`;
    
    await this.mycrm.api.createWebhook({
        url: webhookUrl,
        events: ['person.created', 'person.updated'],
        active: true
    });
}
```

### Step 3: Optional Optimizations

#### Bulk Fetch (Recommended)

Override `fetchPersonsByIds` if your CRM supports bulk fetch:

```javascript
async fetchPersonsByIds(ids) {
    const response = await this.mycrm.api.bulkGetPersons({ ids });
    return response.records;
}
```

#### Custom Configuration

Override lifecycle methods for custom configuration:

```javascript
async checkIfNeedsConfig() {
    // Check if field mappings are configured
    return !this.config.fieldMappings;
}

async getConfigOptions() {
    return {
        jsonSchema: {
            type: 'object',
            properties: {
                fieldMappings: {
                    type: 'object',
                    title: 'Custom Field Mappings'
                }
            }
        },
        uiSchema: { /* ... */ }
    };
}
```

## Testing

### Unit Testing Services

Use the test helpers to create mocks:

```javascript
const ProcessManager = require('./services/ProcessManager');
const {
    createMockProcessRepository,
    buildProcessRecord
} = require('./__tests__/helpers');

describe('ProcessManager', () => {
    let processManager;
    let mockCreateProcessUseCase;
    
    beforeEach(() => {
        mockCreateProcessUseCase = {
            execute: jest.fn()
        };
        
        processManager = new ProcessManager({
            createProcessUseCase: mockCreateProcessUseCase,
            // ... other use cases
        });
    });
    
    it('should create a sync process', async () => {
        const mockProcess = buildProcessRecord();
        mockCreateProcessUseCase.execute.mockResolvedValue(mockProcess);
        
        const result = await processManager.createSyncProcess({
            integrationId: 'int-123',
            userId: 'user-456',
            syncType: 'INITIAL',
            personObjectType: 'Contact'
        });
        
        expect(mockCreateProcessUseCase.execute).toHaveBeenCalledTimes(1);
        expect(result).toEqual(mockProcess);
    });
});
```

### Testing Integrations

Override factory methods to inject mocks:

```javascript
const MyCRMIntegration = require('./MyCRMIntegration');
const { createMockProcessManager } = require('../base/__tests__/helpers');

describe('MyCRMIntegration', () => {
    let integration;
    let mockProcessManager;
    
    beforeEach(() => {
        integration = new MyCRMIntegration({
            id: 'int-123',
            userId: 'user-456'
        });
        
        // Inject mock ProcessManager
        mockProcessManager = createMockProcessManager();
        integration._processManager = mockProcessManager;
    });
    
    it('should transform person to Quo format', async () => {
        const person = {
            id: 'person-123',
            first_name: 'John',
            last_name: 'Doe'
        };
        
        const quoContact = await integration.transformPersonToQuo(person);
        
        expect(quoContact.externalId).toBe('person-123');
        expect(quoContact.defaultFields.firstName).toBe('John');
    });
});
```

## Sync Flow

### Initial Sync

1. User triggers `INITIAL_SYNC` event
2. `SyncOrchestrator.startInitialSync()` creates process for each person type
3. First page queued (page 0) → `fetchPersonPageHandler()`
4. Handler fetches page, determines total, **fans out all remaining pages** (queues 1-N concurrently)
5. Each page handler queues `PROCESS_PERSON_BATCH` with person IDs
6. Batch handlers:
   - Fetch full person data (`fetchPersonsByIds`)
   - Transform to Quo format (`transformPersonToQuo`)
   - Bulk upsert to Quo
   - Update metrics
7. When all batches complete, `completeSyncHandler()` marks process as COMPLETED

### Ongoing Sync (Webhooks)

1. CRM sends webhook → `WEBHOOK_RECEIVED` event
2. `SyncOrchestrator.handleWebhook()` creates mini-process
3. Queues batch with person IDs from webhook
4. Batch handler processes records
5. Process marked complete

## Services

### ProcessManager

Manages process lifecycle and state transitions.

**Methods:**
- `createSyncProcess()` - Create new CRM sync process
- `updateState()` - Update process state
- `updateMetrics()` - Update aggregate metrics
- `handleError()` - Handle process errors

### QueueManager

Manages SQS queue operations.

**Methods:**
- `queueFetchPersonPage()` - Queue page fetch
- `queueProcessPersonBatch()` - Queue batch processing
- `fanOutPages()` - Queue all pages at once (key optimization)

### SyncOrchestrator

Orchestrates sync workflows.

**Methods:**
- `startInitialSync()` - Start full sync
- `startOngoingSync()` - Start delta sync
- `handleWebhook()` - Handle real-time updates

## Process Model

Processes are tracked in the `Process` collection (Frigg Core):

```javascript
{
  id: 'process-123',
  userId: 'user-456',
  integrationId: 'int-789',
  name: 'mycrm-Contact-sync',
  type: 'CRM_SYNC',
  state: 'PROCESSING_BATCHES',
  context: {
    syncType: 'INITIAL',
    personObjectType: 'Contact',
    totalRecords: 1500,
    processedRecords: 450,
    currentPage: 5,
    pagination: { pageSize: 100, hasMore: true }
  },
  results: {
    aggregateData: {
      totalSynced: 440,
      totalFailed: 10,
      duration: 45000,
      recordsPerSecond: 9.78,
      errors: [/* last 100 errors */]
    }
  }
}
```

## Best Practices

1. **Always implement bulk fetch** if your CRM supports it (massive performance gain)
2. **Test transformation logic** thoroughly with real CRM data structures
3. **Handle API rate limits** in your `fetchPersonPage` implementation
4. **Use pagination efficiently** - CRMs often have different pagination styles (offset, cursor, page number)
5. **Log errors but don't fail the sync** - record errors in process metrics, complete sync anyway
6. **Setup webhooks in onCreate** before any sync starts (prevents missing updates during initial sync)

## Extending the Framework

### Adding Custom Events

```javascript
constructor(params) {
    super(params);
    
    this.events = {
        ...this.events,
        CUSTOM_SYNC_EVENT: {
            type: 'USER_ACTION',
            handler: this.customSyncHandler.bind(this),
            title: 'Custom Sync',
            userActionType: 'DATA'
        }
    };
}
```

### Custom Queue Handlers

Add queue configuration to `CRMConfig.queueConfig`:

```javascript
queueConfig: {
    maxWorkers: 50,      // Reserved concurrency
    provisioned: 20,     // Provisioned concurrency
    maxConcurrency: 100, // Per-function limit
    timeout: 900         // 15 minute timeout
}
```

## Troubleshooting

### Process stuck in PROCESSING_BATCHES

- Check SQS queue metrics for DLQ messages
- Verify `fetchPersonsByIds` isn't throwing errors
- Check Quo API availability

### Slow initial sync

- Implement `fetchPersonsByIds` with bulk API
- Increase `queueConfig.maxWorkers` (test CRM rate limits)
- Check `initialBatchSize` - larger = fewer queue messages

### Missing records after sync

- Verify webhook setup completes before sync
- Check `transformPersonToQuo` maps all required fields
- Review error details in process.results.aggregateData.errors

## Support

See the main [CRM Integration Architecture](../../../../docs/CRM_INTEGRATION_ARCHITECTURE.md) document for detailed design decisions and examples.


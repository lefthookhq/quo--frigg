# Quo CRM Integration Framework Architecture

> **Version:** 1.0.0
> **Last Updated:** 2025-10-03
> **Status:** Design Phase
> **Repositories:**
> - 🏗️ **Frigg Core**: Framework changes
> - 📦 **Quo Integrations**: CRM-specific implementations

---

## Table of Contents

1. [Overview](#overview)
2. [Repository Structure](#repository-structure)
3. [Architecture Patterns](#architecture-patterns)
4. [Core Components](#core-components)
5. [Process Model & State Machine](#process-model--state-machine)
6. [BaseCRMIntegration Class](#basecrmintegration-class)
7. [Lifecycle & Initialization](#lifecycle--initialization)
8. [Sync Flow Architecture](#sync-flow-architecture)
9. [Queue Configuration](#queue-configuration)
10. [Use Cases & DDD Patterns](#use-cases--ddd-patterns)
11. [Implementation Guide](#implementation-guide)
12. [Examples](#examples)

---

## Overview

The Quo CRM Integration Framework provides a unified architecture for syncing contact/people-type records from any CRM to Quo (formerly OpenPhone), with support for:

- **Initial Mass Sync** (reverse chronological - newest first)
- **Ongoing Sync** (webhooks + polling fallback)
- **Outbound Activity Logging** (SMS & Call records to CRM)
- **Aggregate Metrics Tracking**
- **Real-time Progress Updates** (via WebSockets)

### Design Goals

1. **Easy CRM Onboarding** - New CRMs require implementing only 3-5 methods
2. **Auto-Generated Infrastructure** - Events, handlers, queues, routes created automatically
3. **Configurable Performance** - Per-integration queue worker tuning
4. **DDD/Hexagonal Architecture** - Clean separation of concerns with Prisma-backed repositories
5. **Production-Ready** - Process state management, error handling, retry logic

---

## Repository Structure

This architecture spans two repositories with clear separation of concerns:

### 🏗️ Frigg Core (`frigg/packages/core`)

**Generic framework components - reusable across all integrations**

```
packages/core/
├── integrations/
│   ├── integration-base.js                    [EXISTS]
│   ├── repositories/
│   │   ├── integration-repository-factory.js [EXISTS]
│   │   └── process-repository-factory.js     [NEW] Process data access
│   └── use-cases/
│       ├── get-integration-instance.js       [EXISTS]
│       ├── create-process.js                 [NEW] Create process records
│       ├── update-process-state.js           [NEW] State transitions
│       └── update-process-metrics.js         [NEW] Aggregate metrics
├── prisma-mongo/
│   └── schema.prisma                         [MODIFY] Add Process model
├── queues/
│   └── queuer-util.js                        [EXISTS]
└── handlers/
    └── routers/
        └── integration-defined-routers.js    [EXISTS]
```

**Changes Required:**
- ✅ Add generic `Process` model to Prisma schema
- ✅ Implement process management use cases
- ✅ Create process repository and factory
- ✅ Update serverless template for custom queue config

### 📦 Quo Integrations (`quo--frigg`)

**CRM-specific implementations for Quo**

```
quo--frigg/
├── backend/
│   └── src/
│       ├── base/
│       │   └── BaseCRMIntegration.js         [NEW] Base class for Quo CRM integrations
│       ├── integrations/
│       │   ├── ZohoCRMIntegration.js         [PORT/REFACTOR]
│       │   ├── PipedriveIntegration.js       [PORT/REFACTOR]
│       │   ├── AttioIntegration.js           [NEW]
│       │   ├── AxisCareIntegration.js        [NEW]
│       │   └── ScalingTestIntegration.js     [NEW] (Mock CRM for testing)
│       ├── api-modules/
│       │   ├── zoho-crm/
│       │   │   ├── index.js
│       │   │   ├── api.js
│       │   │   └── definition.js
│       │   ├── pipedrive/
│       │   ├── attio/                        [NEW]
│       │   ├── axiscare/                     [NEW]
│       │   ├── scaling-test/                 [NEW]
│       │   └── quo/                          [NEW] Quo API module
│       │       ├── index.js
│       │       ├── api.js
│       │       └── definition.js
│       └── utils/
│           └── crm-transforms.js             [NEW] Shared transform utilities
└── docs/
    └── CRM_INTEGRATION_ARCHITECTURE.md       [THIS FILE]
```

**Changes Required:**
- ✅ Create BaseCRMIntegration base class (Quo-specific)
- ✅ Refactor existing integrations (Zoho, Pipedrive) to extend BaseCRMIntegration
- ✅ Create new integrations (Attio, AxisCare, ScalingTest)
- ✅ Create Quo API module for contact upsert and activity logging
- ✅ Implement CRM-specific transformations
- ✅ Define integration configurations

---


---

## Architecture Patterns

### Identified from Existing Codebase

| Pattern | Source | Purpose |
|---------|--------|---------|
| **Process Model** | crossbeam--integration-service | State machine tracking for long-running operations |
| **Use Case Pattern** | frigg/core/integrations | DDD use-case with `.execute()` method |
| **Repository Factory** | frigg/core/integrations | Abstract data access with Prisma |
| **Page/Cursor in Context** | Multiple repos | Store pagination state in Process.context |
| **Fan-Out Queuing** | docusign--frigg (Quo integrations) | Queue multiple pages concurrently |
| **QueuerUtil.batchSend** | frigg/core/queues | SQS batch operations |
| **Lifecycle Events** | IntegrationBase | onCreate, onUpdate, onDelete hooks |

---

## Core Components

### 1. Process Model (Prisma Schema)

> 🏗️ **FRIGG CORE** - Add to `/packages/core/prisma-mongo/schema.prisma`

The Process model is **generic** and reusable for any long-running operation. CRM-specific details are stored in `context` and `results` JSON fields.

```prisma
/// Generic Process Model - tracks any long-running operation
/// Used for: CRM syncs, data migrations, bulk operations, etc.
model Process {
  id            String   @id @default(auto()) @map("_id") @db.ObjectId

  // Core references
  userId        String   @db.ObjectId
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  integrationId String   @db.ObjectId
  integration   Integration @relation(fields: [integrationId], references: [id], onDelete: Cascade)

  // Process identification
  name          String   // e.g., "zoho-crm-contact-sync", "pipedrive-lead-sync"
  type          String   // e.g., "CRM_SYNC", "DATA_MIGRATION", "BULK_OPERATION"

  // State machine
  state         String   // Current state (integration-defined states)

  // Flexible storage
  context       Json     @default("{}")  // Process-specific data (pagination, metadata, etc.)
  results       Json     @default("{}")  // Process results and metrics

  // Hierarchy support
  childProcesses  String[] @db.ObjectId
  parentProcessId String?  @db.ObjectId

  // Timestamps
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@index([integrationId])
  @@index([type])
  @@index([state])
  @@index([name])
  @@map("Process")
}
```

**Key Design Principles:**
- ✅ **Generic** - Reusable for any integration or process type
- ✅ **Flexible** - `context` and `results` are JSON (no fixed schema)
- ✅ **Identifiable** - `name` and `type` tell us what we're looking at
- ✅ **Hierarchical** - Support parent/child process relationships

### 2. Process Context Structure (CRM Sync Example)

> 📦 **QUO INTEGRATIONS** - Defined by BaseCRMIntegration

Stored in `context` JSON field - **CRM-specific details**:

```javascript
{
  // Sync metadata
  syncType: 'INITIAL',              // or 'ONGOING', 'WEBHOOK'
  personObjectType: 'Contact',      // CRM object being synced

  // Progress tracking
  totalRecords: 1500,               // Total to sync
  processedRecords: 450,            // Processed so far
  currentPage: 5,                   // Current page number

  // Pagination state
  pagination: {
    pageSize: 100,
    currentCursor: 'cursor_abc123', // For cursor-based APIs
    nextPage: 6,
    hasMore: true
  },

  // Timing
  startTime: '2025-10-03T12:00:00Z',
  endTime: null,
  estimatedCompletion: '2025-10-03T12:15:00Z',
  lastSyncedTimestamp: '2025-10-02T10:30:00Z', // For ongoing sync

  // CRM-specific metadata
  metadata: {
    crmApiVersion: 'v3',
    customFieldsVersion: '2025-01-01',
    webhookId: 'webhook_123',
    // Any CRM-specific temp data
  }
}
```

### 3. Process Results Structure (CRM Sync Example)

> 📦 **QUO INTEGRATIONS** - Defined by BaseCRMIntegration

Stored in `results` JSON field - **CRM sync metrics**:

```javascript
{
  aggregateData: {
    totalSynced: 150,              // Count of successfully synced contacts
    totalFailed: 5,                // Count of failed contacts
    duration: 45000,               // milliseconds
    recordsPerSecond: 3.33,
    errors: [                      // Error summaries (limited to last 100)
      {
        contactId: 'abc123',
        error: 'Missing required field: email',
        timestamp: '2025-10-03T12:00:00Z'
      }
    ]
  },
  pages: {
    totalPages: 15,
    processedPages: 15,
    failedPages: 0
  }
}
```

**Note:** The `state` field uses integration-defined states. For CRM syncs, BaseCRMIntegration defines:
- `INITIALIZING`, `FETCHING_TOTAL`, `QUEUING_PAGES`, `PROCESSING_BATCHES`, `COMPLETING`, `COMPLETED`, `ERROR`

---

## Process Model & State Machine

### State Transitions

```
INITIALIZING
    ↓
FETCHING_TOTAL (Get first page, determine total records)
    ↓
QUEUING_PAGES (Fan-out: Queue all pages at once)
    ↓
PROCESSING_BATCHES (Handlers process batches concurrently)
    ↓
COMPLETING (Final metrics aggregation)
    ↓
COMPLETED

Any State → ERROR (on unrecoverable failure)
```

### State Management Use Cases

> 🏗️ **FRIGG CORE** - Create in `/packages/core/integrations/use-cases/`

These are generic use cases that work with the Process model:

```javascript
// update-process-state.js
class UpdateProcessState {
  constructor({ processRepository }) {
    this.processRepository = processRepository;
  }

  async execute(processId, newState, contextUpdates = {}) {
    const process = await this.processRepository.findById(processId);

    if (!process) {
      throw new Error(`Process ${processId} not found`);
    }

    process.state = newState;

    // Merge context updates (preserve existing context)
    process.context = { ...process.context, ...contextUpdates };

    return await this.processRepository.update(processId, process);
  }
}

module.exports = { UpdateProcessState };
```

```javascript
// update-process-metrics.js
class UpdateProcessMetrics {
  constructor({ processRepository, websocketService }) {
    this.processRepository = processRepository;
    this.websocketService = websocketService;
  }

  async execute(processId, metricsUpdate) {
    const process = await this.processRepository.findById(processId);

    // Get current context and results
    const context = process.context || {};
    const results = process.results || { aggregateData: {} };

    // Update context counters
    context.processedRecords = (context.processedRecords || 0) + (metricsUpdate.processed || 0);

    // Update results aggregates
    results.aggregateData.totalSynced = (results.aggregateData.totalSynced || 0) + (metricsUpdate.success || 0);
    results.aggregateData.totalFailed = (results.aggregateData.totalFailed || 0) + (metricsUpdate.errors || 0);

    if (metricsUpdate.errorDetails && metricsUpdate.errorDetails.length > 0) {
      results.aggregateData.errors = [
        ...(results.aggregateData.errors || []),
        ...metricsUpdate.errorDetails
      ].slice(-100); // Keep only last 100 errors
    }

    // Calculate performance metrics
    const startTime = new Date(context.startTime || process.createdAt);
    const elapsed = Date.now() - startTime.getTime();
    results.aggregateData.duration = elapsed;
    results.aggregateData.recordsPerSecond =
      context.processedRecords / (elapsed / 1000);

    // Calculate ETA if we know total
    if (context.totalRecords > 0) {
      const remaining = context.totalRecords - context.processedRecords;
      const eta = new Date(
        Date.now() + (remaining / results.aggregateData.recordsPerSecond * 1000)
      );
      context.estimatedCompletion = eta.toISOString();
    }

    // Update process
    process.context = context;
    process.results = results;

    await this.processRepository.update(processId, process);

    // Broadcast progress via WebSocket (if service provided)
    if (this.websocketService) {
      await this.websocketService.broadcast({
        type: 'PROCESS_PROGRESS',
        data: {
          processId,
          processName: process.name,
          processType: process.type,
          state: process.state,
          processed: context.processedRecords,
          total: context.totalRecords,
          successCount: results.aggregateData.totalSynced,
          errorCount: results.aggregateData.totalFailed,
          recordsPerSecond: results.aggregateData.recordsPerSecond,
          estimatedCompletion: context.estimatedCompletion
        }
      });
    }

    return process;
  }
}

module.exports = { UpdateProcessMetrics };
```

---

## BaseCRMIntegration Class

> 📦 **QUO INTEGRATIONS** - Create in `quo--frigg/backend/src/base/BaseCRMIntegration.js`

**Note:** This base class is Quo-specific and lives in the quo--frigg repo. It may be generalized and moved to Frigg Core in the future once we have broader CRM integration patterns across multiple products.

```javascript
const { IntegrationBase } = require('./integration-base');
const { QueuerUtil } = require('../queues/queuer-util');

/**
 * Base class for all CRM integrations targeting Quo (OpenPhone)
 * Provides automatic:
 * - Initial sync (reverse chronological)
 * - Ongoing sync (webhooks + polling)
 * - Outbound activity logging (SMS, Calls)
 * - Process state management
 * - Aggregate metrics tracking
 */
class BaseCRMIntegration extends IntegrationBase {
  /**
   * Child classes MUST define this configuration
   */
  static CRMConfig = {
    // Person object types to sync
    personObjectTypes: [
      // {
      //   crmObjectName: 'Contact',     // CRM's object name
      //   quoContactType: 'contact',    // All map to 'contact' in Quo
      //   customFields: []              // Optional custom field mappings
      // }
    ],

    // Sync configuration
    syncConfig: {
      reverseChronological: true,     // Newest first
      initialBatchSize: 100,          // Records per page (initial sync)
      ongoingBatchSize: 50,           // Records per page (ongoing)
      supportsWebhooks: false,        // Does CRM support webhooks?
      pollIntervalMinutes: 60,        // Polling interval if no webhooks
    },

    // Queue worker configuration (override default 5 workers)
    queueConfig: {
      maxWorkers: 25,                 // Reserved concurrency
      provisioned: 10,                // Provisioned concurrency
      maxConcurrency: 100,            // Per-function limit
      batchSize: 1,                   // SQS batch size
      timeout: 600                    // Function timeout (seconds)
    }
  };

  constructor(params = {}) {
    super(params);

    // Auto-generate CRM-specific events
    this.events = {
      ...this.events,

      // User-triggered initial sync
      INITIAL_SYNC: {
        type: 'USER_ACTION',
        handler: this.startInitialSync.bind(this),
        title: 'Start Initial Sync',
        description: 'Sync all contacts from CRM to Quo',
        userActionType: 'SYNC_ACTION',
      },

      // Cron-triggered ongoing sync
      ONGOING_SYNC: {
        type: 'CRON',
        handler: this.startOngoingSync.bind(this),
      },

      // Webhook from CRM
      WEBHOOK_RECEIVED: {
        handler: this.handleWebhook.bind(this),
      },

      // Process orchestration events
      FETCH_PERSON_PAGE: {
        handler: this.fetchPersonPageHandler.bind(this),
      },

      PROCESS_PERSON_BATCH: {
        handler: this.processPersonBatchHandler.bind(this),
      },

      COMPLETE_SYNC: {
        handler: this.completeSyncHandler.bind(this),
      },

      // Outbound activity logging (from Quo webhooks)
      LOG_SMS: {
        handler: this.logSMS.bind(this),
      },

      LOG_CALL: {
        handler: this.logCall.bind(this),
      },
    };
  }

  // ===================================================================
  // LIFECYCLE METHODS - Override onCreate to setup webhooks & sync
  // ===================================================================

  /**
   * Called when integration is created.
   * Override to customize behavior:
   * - Option 1: Set status to NEEDS_CONFIG and collect user input
   * - Option 2: Trigger initial sync immediately
   */
  async onCreate({ integrationId }) {
    // Setup webhooks immediately (before any sync)
    // This prevents missing data changes during initial sync
    if (this.constructor.CRMConfig.syncConfig.supportsWebhooks) {
      try {
        await this.setupWebhooks();
      } catch (error) {
        console.error('Failed to setup webhooks:', error);
        // Non-fatal, continue with polling fallback
      }
    }

    // Check if we need user configuration
    const needsConfig = await this.checkIfNeedsConfig();

    if (needsConfig) {
      // Request config from user via jsonSchema/uiSchema
      await this.updateIntegrationStatus.execute(integrationId, 'NEEDS_CONFIG');
    } else {
      // Start initial sync automatically
      await this.updateIntegrationStatus.execute(integrationId, 'ENABLED');

      // Optionally trigger sync immediately
      // await this.startInitialSync({ integrationId });
    }
  }

  /**
   * Override to check if integration needs additional configuration
   */
  async checkIfNeedsConfig() {
    // Example: Check if field mappings are configured
    return false;
  }

  /**
   * Override to return configuration options
   * Can include: field mappings, sync triggers, etc.
   */
  async getConfigOptions() {
    return {
      jsonSchema: {
        type: 'object',
        properties: {
          triggerInitialSync: {
            type: 'boolean',
            title: 'Trigger Initial Sync Now?',
            default: false
          },
          fieldMappings: {
            type: 'object',
            title: 'Custom Field Mappings',
            properties: {}
          }
        }
      },
      uiSchema: {
        type: 'VerticalLayout',
        elements: [
          { type: 'Control', scope: '#/properties/triggerInitialSync' },
          { type: 'Control', scope: '#/properties/fieldMappings' }
        ]
      }
    };
  }

  /**
   * Called when user updates config
   * Check if they triggered initial sync
   */
  async onUpdate({ integrationId, config }) {
    if (config && config.triggerInitialSync) {
      await this.startInitialSync({ integrationId });
    }
  }

  // ===================================================================
  // ABSTRACT METHODS - Child classes MUST implement (5 core methods)
  // ===================================================================

  /**
   * 1. Fetch a page of persons from the CRM
   * @param {Object} params
   * @param {string} params.objectType - CRM object type (Contact, Lead, etc.)
   * @param {number} params.page - Page number (0-indexed)
   * @param {number} params.limit - Records per page
   * @param {Date} params.modifiedSince - Filter by modification date (ongoing sync)
   * @param {boolean} params.sortDesc - Sort descending (newest first)
   * @returns {Promise<PersonPage>} { data: [], total: number, hasMore: boolean }
   */
  async fetchPersonPage(params) {
    throw new Error('fetchPersonPage must be implemented by child class');
  }

  /**
   * 2. Transform CRM person object to Quo contact format
   * @param {Object} person - CRM person object
   * @returns {Promise<QuoContact>}
   */
  async transformPersonToQuo(person) {
    throw new Error('transformPersonToQuo must be implemented by child class');
  }

  /**
   * 3. Log SMS message to CRM as an activity
   * @param {Object} activity - Transformed SMS activity
   * @param {string} activity.type - 'sms'
   * @param {string} activity.direction - 'inbound' or 'outbound'
   * @param {string} activity.content - SMS content
   * @param {string} activity.contactExternalId - CRM contact ID
   * @param {string} activity.timestamp - ISO timestamp
   * @returns {Promise<void>}
   */
  async logSMSToActivity(activity) {
    throw new Error('logSMSToActivity must be implemented by child class');
  }

  /**
   * 4. Log phone call to CRM as an activity
   * @param {Object} activity - Transformed call activity
   * @param {string} activity.type - 'call'
   * @param {string} activity.direction - 'inbound' or 'outbound'
   * @param {number} activity.duration - Call duration in seconds
   * @param {string} activity.summary - AI-generated call summary
   * @param {string} activity.contactExternalId - CRM contact ID
   * @param {string} activity.timestamp - ISO timestamp
   * @returns {Promise<void>}
   */
  async logCallToActivity(activity) {
    throw new Error('logCallToActivity must be implemented by child class');
  }

  /**
   * 5. Setup webhooks with the CRM (if supported)
   * Called during onCreate
   * @returns {Promise<void>}
   */
  async setupWebhooks() {
    throw new Error('setupWebhooks must be implemented by child class');
  }

  // ===================================================================
  // OPTIONAL HELPER METHODS - Override for optimization
  // ===================================================================

  /**
   * Fetch a single person by ID (override if CRM has bulk API)
   * @param {string} id - Person ID
   * @returns {Promise<Object>}
   */
  async fetchPersonById(id) {
    // Default implementation: call fetchPersonPage with filter
    throw new Error('fetchPersonById must be implemented (or override fetchPersonsByIds)');
  }

  /**
   * Fetch multiple persons by IDs (override if CRM has bulk fetch API)
   * @param {string[]} ids - Array of person IDs
   * @returns {Promise<Object[]>}
   */
  async fetchPersonsByIds(ids) {
    // Default: fetch one-by-one (inefficient, override recommended)
    const persons = await Promise.all(
      ids.map(id => this.fetchPersonById(id))
    );
    return persons;
  }

  // ===================================================================
  // SYNC ORCHESTRATION - Auto-implemented
  // ===================================================================

  /**
   * Start initial sync for all person object types
   * Loops through each personObjectType and spawns sync process
   */
  async startInitialSync({ integrationId }) {
    const personObjectTypes = this.constructor.CRMConfig.personObjectTypes;

    if (!personObjectTypes || personObjectTypes.length === 0) {
      throw new Error('No personObjectTypes configured');
    }

    const processIds = [];

    // Loop through each person type (Contact, Lead, etc.)
    for (const personType of personObjectTypes) {
      const process = await this.createSyncProcess({
        integrationId,
        syncType: 'INITIAL',
        personObjectType: personType.crmObjectName,
        state: 'INITIALIZING'
      });

      processIds.push(process.id);

      // Queue first page fetch to determine total
      await this.queueFetchPersonPage({
        processId: process.id,
        personObjectType: personType.crmObjectName,
        page: 0,
        limit: this.constructor.CRMConfig.syncConfig.initialBatchSize,
        sortDesc: this.constructor.CRMConfig.syncConfig.reverseChronological
      });
    }

    return {
      message: `Initial sync started for ${personObjectTypes.length} person types`,
      processIds,
      estimatedCompletion: new Date(Date.now() + 10 * 60 * 1000) // 10 min estimate
    };
  }

  /**
   * Start ongoing sync (delta sync)
   * Fetches only records modified since last sync
   */
  async startOngoingSync({ integrationId }) {
    const personObjectTypes = this.constructor.CRMConfig.personObjectTypes;
    const lastSyncTime = await this.getLastSyncTime(integrationId);

    for (const personType of personObjectTypes) {
      const process = await this.createSyncProcess({
        integrationId,
        syncType: 'ONGOING',
        personObjectType: personType.crmObjectName,
        state: 'FETCHING_TOTAL',
        lastSyncedTimestamp: lastSyncTime
      });

      await this.queueFetchPersonPage({
        processId: process.id,
        personObjectType: personType.crmObjectName,
        page: 0,
        limit: this.constructor.CRMConfig.syncConfig.ongoingBatchSize,
        modifiedSince: lastSyncTime,
        sortDesc: false // Ongoing can be asc
      });
    }

    return { message: 'Ongoing sync started' };
  }

  /**
   * Handle webhook from CRM
   */
  async handleWebhook({ data }) {
    const webhookData = Array.isArray(data) ? data : [data];

    // Create mini-process for webhook
    const process = await this.createSyncProcess({
      integrationId: this.id,
      syncType: 'WEBHOOK',
      personObjectType: 'webhook',
      state: 'PROCESSING_BATCHES',
      totalRecords: webhookData.length
    });

    // Queue for processing
    await this.queueProcessPersonBatch({
      processId: process.id,
      crmPersonIds: webhookData.map(p => p.id),
      batchNumber: 1,
      isWebhook: true
    });

    return { status: 'queued', count: webhookData.length };
  }

  // ===================================================================
  // QUEUE HANDLERS - Auto-implemented
  // ===================================================================

  /**
   * Handler: Fetch a page of persons
   * 1. Fetch page from CRM
   * 2. If first page (page=0): Determine total, queue all remaining pages
   * 3. Queue batch for processing
   */
  async fetchPersonPageHandler({ data }) {
    const { processId, personObjectType, page, limit, modifiedSince, sortDesc } = data;

    try {
      // Update state
      await this.updateProcessState(processId, 'FETCHING_TOTAL');

      // Fetch page
      const personPage = await this.fetchPersonPage({
        objectType: personObjectType,
        page,
        limit,
        modifiedSince,
        sortDesc
      });

      const persons = personPage.data || [];

      // If first page, determine total and fan-out queue all pages
      if (page === 0 && personPage.total) {
        const totalPages = Math.ceil(personPage.total / limit);

        // Update process with total
        await this.updateProcessTotal(processId, personPage.total, totalPages);
        await this.updateProcessState(processId, 'QUEUING_PAGES');

        // Queue all remaining pages at once (fan-out)
        const pageQueues = [];
        for (let i = 1; i < totalPages; i++) {
          pageQueues.push({
            event: 'FETCH_PERSON_PAGE',
            data: {
              processId,
              personObjectType,
              page: i,
              limit,
              modifiedSince,
              sortDesc
            }
          });
        }

        if (pageQueues.length > 0) {
          await QueuerUtil.batchSend(pageQueues, this.getQueueUrl());
        }

        await this.updateProcessState(processId, 'PROCESSING_BATCHES');
      }

      // Queue this page's persons for processing
      if (persons.length > 0) {
        await this.queueProcessPersonBatch({
          processId,
          crmPersonIds: persons.map(p => p.id), // Send IDs only
          page,
          totalInPage: persons.length
        });
      }

      // If no more pages and no total was provided, complete
      if (page > 0 && persons.length < limit) {
        await this.queueCompletSync(processId);
      }

    } catch (error) {
      console.error(`Error fetching page ${page}:`, error);
      await this.handleProcessError(processId, error);
    }
  }

  /**
   * Handler: Process a batch of persons
   * 1. Retrieve full person data using IDs
   * 2. Transform to Quo format
   * 3. Bulk upsert to Quo
   * 4. Update metrics
   */
  async processPersonBatchHandler({ data }) {
    const { processId, crmPersonIds, page, isWebhook } = data;

    try {
      // Retrieve full person data from CRM
      const persons = await this.fetchPersonsByIds(crmPersonIds);

      // Transform to Quo format
      const quoContacts = await Promise.all(
        persons.map(p => this.transformPersonToQuo(p))
      );

      // Bulk upsert to Quo
      const results = await this.bulkUpsertToQuo(quoContacts);

      // Update metrics
      await this.updateProcessMetrics(processId, {
        processed: crmPersonIds.length,
        success: results.successCount,
        errors: results.errorCount,
        errorDetails: results.errors
      });

    } catch (error) {
      console.error(`Error processing batch:`, error);
      await this.updateProcessMetrics(processId, {
        processed: 0,
        success: 0,
        errors: crmPersonIds.length,
        errorDetails: [{ error: error.message, batch: page }]
      });
    }
  }

  /**
   * Handler: Complete sync process
   */
  async completeSyncHandler({ data }) {
    const { processId } = data;

    const process = await this.getProcess(processId);

    // Mark complete
    await this.updateProcessState(processId, 'COMPLETED', {
      endTime: new Date()
    });

    // Final metrics broadcast
    await this.broadcastProgress(processId, {
      status: 'completed',
      ...process.results.aggregateData
    });
  }

  // ===================================================================
  // HELPER METHODS
  // ===================================================================

  async bulkUpsertToQuo(contacts) {
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // TODO: Use Quo bulk API when available
    for (const contact of contacts) {
      try {
        await this.quo.api.upsertContact(contact);
        successCount++;
      } catch (error) {
        errorCount++;
        errors.push({
          contactId: contact.externalId,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    return { successCount, errorCount, errors };
  }

  async getLastSyncTime(integrationId) {
    // Query for last completed sync process
    // Return lastSyncedTimestamp or null
    return null;
  }

  getQueueUrl() {
    const integrationName = this.constructor.Definition.name;
    return process.env[`${integrationName.toUpperCase()}_QUEUE_URL`];
  }

  // ===================================================================
  // PROCESS MANAGEMENT (via use cases)
  // ===================================================================

  async createSyncProcess({ integrationId, syncType, personObjectType, state }) {
    // Create process with CRM sync context
    const process = {
      userId: this.userId,
      integrationId,
      name: `${this.constructor.Definition.name}-${personObjectType}-sync`,
      type: 'CRM_SYNC',
      state: state || 'INITIALIZING',
      context: {
        syncType,
        personObjectType,
        totalRecords: 0,
        processedRecords: 0,
        currentPage: 0,
        startTime: new Date().toISOString(),
        pagination: {
          pageSize: this.constructor.CRMConfig.syncConfig.initialBatchSize
        }
      },
      results: {
        aggregateData: {
          totalSynced: 0,
          totalFailed: 0,
          duration: 0,
          recordsPerSecond: 0,
          errors: []
        }
      }
    };

    return await this.createProcessUseCase.execute(process);
  }

  async updateProcessState(processId, state, contextUpdates = {}) {
    return await this.updateProcessStateUseCase.execute(processId, state, contextUpdates);
  }

  async updateProcessTotal(processId, totalRecords, totalPages) {
    return await this.updateProcessState(processId, null, {
      totalRecords,
      pages: { totalPages }
    });
  }

  async updateProcessMetrics(processId, metrics) {
    return await this.updateProcessMetricsUseCase.execute(processId, metrics);
  }

  async getProcess(processId) {
    return await this.getProcessUseCase.execute(processId);
  }

  async handleProcessError(processId, error) {
    await this.updateProcessState(processId, 'ERROR', {
      error: error.message,
      errorTimestamp: new Date().toISOString()
    });
  }

  async broadcastProgress(processId, data) {
    // WebSocket broadcast via use case/service
    console.log('Progress:', processId, data);
  }

  // ===================================================================
  // QUEUE OPERATIONS
  // ===================================================================

  async queueFetchPersonPage(params) {
    await QueuerUtil.batchSend([{
      event: 'FETCH_PERSON_PAGE',
      data: params
    }], this.getQueueUrl());
  }

  async queueProcessPersonBatch(params) {
    await QueuerUtil.batchSend([{
      event: 'PROCESS_PERSON_BATCH',
      data: params
    }], this.getQueueUrl());
  }

  async queueCompletSync(processId) {
    await QueuerUtil.batchSend([{
      event: 'COMPLETE_SYNC',
      data: { processId }
    }], this.getQueueUrl());
  }

  // ===================================================================
  // OUTBOUND ACTIVITY LOGGING
  // ===================================================================

  async logSMS({ data: sms }) {
    if (!this.logSMSToActivity) {
      console.warn('SMS logging not supported');
      return;
    }

    const activity = this.transformQuoSMSToActivity(sms);
    await this.logSMSToActivity(activity);
  }

  async logCall({ data: call }) {
    if (!this.logCallToActivity) {
      console.warn('Call logging not supported');
      return;
    }

    const activity = this.transformQuoCallToActivity(call);
    await this.logCallToActivity(activity);
  }

  transformQuoSMSToActivity(sms) {
    // Transform Quo SMS to CRM activity format
    return {
      type: 'sms',
      direction: sms.direction,
      content: sms.body,
      timestamp: sms.createdAt,
      contactExternalId: sms.contactId
    };
  }

  transformQuoCallToActivity(call) {
    // Transform Quo call to CRM activity format
    return {
      type: 'call',
      direction: call.direction,
      duration: call.duration,
      summary: call.aiSummary,
      timestamp: call.createdAt,
      contactExternalId: call.contactId
    };
  }
}

module.exports = { BaseCRMIntegration };
```

---

## Lifecycle & Initialization

### onCreate Flow

```
1. Integration Created
   ↓
2. onCreate({ integrationId }) called
   ↓
3. Setup Webhooks (if supported)
   ↓
4. Check if needs config
   ↓
5a. NEEDS_CONFIG → User provides config → onUpdate
5b. ENABLED → Optionally trigger initial sync
```

### Configuration Pattern

```javascript
// Example: Requesting field mappings
async getConfigOptions() {
  return {
    jsonSchema: {
      type: 'object',
      properties: {
        triggerInitialSync: {
          type: 'boolean',
          title: 'Start Initial Sync Now?'
        },
        phoneField: {
          type: 'string',
          title: 'Primary Phone Field',
          enum: ['work', 'mobile', 'home']
        }
      }
    },
    uiSchema: {
      type: 'VerticalLayout',
      elements: [
        { type: 'Control', scope: '#/properties/triggerInitialSync' },
        { type: 'Control', scope: '#/properties/phoneField' }
      ]
    }
  };
}

async onUpdate({ integrationId, config }) {
  if (config.triggerInitialSync) {
    await this.startInitialSync({ integrationId });
  }

  // Save field mapping config
  this.config.phoneField = config.phoneField;
}
```

---

## Sync Flow Architecture

### Initial Sync (Reverse Chronological)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User Action: START_INITIAL_SYNC                         │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Loop Person Types: [Contact, Lead, ...]                 │
│    - Create Process(syncType=INITIAL, state=INITIALIZING)  │
│    - Queue: FETCH_PERSON_PAGE_0                            │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Handler: fetchPersonPageHandler (page=0)                │
│    - Fetch page 0 (sorted desc, newest first)              │
│    - Extract total: 1,500 records                          │
│    - Calculate pages: 15 pages @ 100 per page              │
│    - Update Process: totalRecords=1500                     │
│    - State: INITIALIZING → QUEUING_PAGES                   │
│    - Fan-out: Queue pages 1-14 ALL AT ONCE                 │
│    - State: QUEUING_PAGES → PROCESSING_BATCHES             │
│    - Queue: PROCESS_PERSON_BATCH (page 0 IDs)             │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Handlers: fetchPersonPageHandler (pages 1-14)           │
│    - Run concurrently (up to maxWorkers)                   │
│    - Each queues: PROCESS_PERSON_BATCH                     │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Handlers: processPersonBatchHandler                     │
│    - Retrieve persons by IDs                               │
│    - Transform to Quo format                               │
│    - Bulk upsert to Quo                                    │
│    - Update metrics: processedRecords, successCount, etc.  │
│    - WebSocket: Broadcast progress                         │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Handler: completeSyncHandler                            │
│    - State: PROCESSING_BATCHES → COMPLETED                 │
│    - Set endTime                                           │
│    - WebSocket: Final completion notification              │
└─────────────────────────────────────────────────────────────┘
```

### Ongoing Sync (Webhooks)

```
┌─────────────────────────────────────────────────────────────┐
│ CRM Webhook: person.updated                                │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ Handler: handleWebhook                                     │
│    - Create mini-process (syncType=WEBHOOK)                │
│    - Queue: PROCESS_PERSON_BATCH (single ID)               │
└────────────────┬────────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────────┐
│ Handler: processPersonBatchHandler                         │
│    - Fetch person, transform, upsert to Quo                │
└─────────────────────────────────────────────────────────────┘
```

---

## Queue Configuration

### Integration Definition Enhancement

```javascript
// Example: Zoho CRM Integration Definition
static Definition = {
  name: 'zoho-crm',
  version: '1.0.0',

  // Custom queue configuration
  queueConfig: {
    'zoho-crm': {
      maxWorkers: 50,        // Override default 5
      provisioned: 10,       // Keep 10 warm
      maxConcurrency: 100,   // Each handles up to 100
      batchSize: 10,         // Process 10 SQS messages at once
      timeout: 600           // 10 minute timeout
    }
  },

  modules: {
    zohoCrm: { ... },
    quo: { ... }
  }
};
```

### Serverless Template Integration

Update `/packages/devtools/infrastructure/serverless-template.js`:

```javascript
const attachIntegrations = (definition, AppDefinition) => {
  for (const integration of AppDefinition.integrations) {
    const integrationName = integration.Definition.name;
    const queueConfig = integration.Definition.queueConfig?.[integrationName] || {};

    // ... existing queue creation ...

    // Apply custom configuration to queue worker
    const queueWorkerName = `${integrationName}QueueWorker`;
    definition.functions[queueWorkerName] = {
      handler: `node_modules/@friggframework/core/handlers/workers/integration-defined-workers.handlers.${integrationName}.queueWorker`,
      reservedConcurrency: queueConfig.maxWorkers || 5,     // Custom or default
      provisionedConcurrency: queueConfig.provisioned,       // Optional
      events: [{
        sqs: {
          arn: { 'Fn::GetAtt': [queueReference, 'Arn'] },
          batchSize: queueConfig.batchSize || 1,
        }
      }],
      timeout: queueConfig.timeout || 600,
    };
  }
};
```

---

## Use Cases & DDD Patterns

### Process Management Use Cases

Create in `/packages/core/integrations/use-cases/`:

#### create-process.js

> 🏗️ **FRIGG CORE**

```javascript
class CreateProcess {
  constructor({ processRepository }) {
    this.processRepository = processRepository;
  }

  /**
   * Create a new process record
   * @param {Object} processData - Process configuration
   * @param {string} processData.userId - User ID
   * @param {string} processData.integrationId - Integration ID
   * @param {string} processData.name - Process name (e.g., "zoho-crm-contact-sync")
   * @param {string} processData.type - Process type (e.g., "CRM_SYNC")
   * @param {string} processData.state - Initial state
   * @param {Object} processData.context - Process context (flexible JSON)
   * @param {Object} processData.results - Process results (flexible JSON)
   */
  async execute(processData) {
    const process = {
      userId: processData.userId,
      integrationId: processData.integrationId,
      name: processData.name,
      type: processData.type,
      state: processData.state || 'INITIALIZING',
      context: processData.context || {},
      results: processData.results || {},
      childProcesses: processData.childProcesses || [],
      parentProcessId: processData.parentProcessId || null
    };

    return await this.processRepository.create(process);
  }
}

module.exports = { CreateProcess };
```

### Repository Pattern

> 🏗️ **FRIGG CORE** - Create in `/packages/core/integrations/repositories/`

Generic process repository (works for any process type):

#### process-repository.js

```javascript
class ProcessRepository {
  constructor({ prismaClient }) {
    this.prisma = prismaClient;
  }

  async create(processData) {
    return await this.prisma.process.create({
      data: processData
    });
  }

  async findById(processId) {
    return await this.prisma.process.findUnique({
      where: { id: processId }
    });
  }

  async update(processId, updates) {
    return await this.prisma.process.update({
      where: { id: processId },
      data: updates
    });
  }

  async findByIntegrationAndType(integrationId, type) {
    return await this.prisma.process.findMany({
      where: { integrationId, type }
    });
  }

  async findActiveProcesses(integrationId, excludeStates = ['COMPLETED', 'ERROR']) {
    return await this.prisma.process.findMany({
      where: {
        integrationId,
        state: {
          notIn: excludeStates
        }
      }
    });
  }

  async findByName(name) {
    return await this.prisma.process.findFirst({
      where: { name },
      orderBy: { createdAt: 'desc' }
    });
  }
}

module.exports = { ProcessRepository };
```

#### process-repository-factory.js

```javascript
const { ProcessRepository } = require('./process-repository');

let repositoryInstance = null;

function createProcessRepository() {
  if (!repositoryInstance) {
    const database = require('../../database');
    const prismaClient = database.getPrismaClient();
    repositoryInstance = new ProcessRepository({ prismaClient });
  }
  return repositoryInstance;
}

module.exports = { createProcessRepository };
```

---

## Implementation Guide

### Overview: 5 CRM Integrations

All integrations extend `BaseCRMIntegration` and implement the **5 core methods**:

| Integration | Status | Person Types | Webhook Support |
|------------|--------|--------------|-----------------|
| **Pipedrive** | PORT/REFACTOR | Person | ✅ Yes |
| **ZohoCRM** | PORT/REFACTOR | Contact, Lead | ✅ Yes |
| **Attio** | NEW | Person | ✅ Yes |
| **AxisCare** | NEW | Contact | ❌ No (polling) |
| **ScalingTest** | NEW | MockPerson | ✅ Yes (simulated) |

### Step 1: Extend BaseCRMIntegration

> 📦 **QUO INTEGRATIONS** - Create in `quo--frigg/backend/src/integrations/`

```javascript
// Example: Pipedrive Integration
const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');

class PipedriveIntegration extends BaseCRMIntegration {
  static Definition = {
    name: 'pipedrive',
    version: '1.0.0',

    modules: {
      pipedrive: require('./modules/pipedrive'),
      quo: require('./modules/quo')
    },

    display: {
      name: 'Pipedrive',
      description: 'Sync persons from Pipedrive to Quo',
      icon: 'https://...'
    }
  };

  static CRMConfig = {
    personObjectTypes: [
      { crmObjectName: 'Person', quoContactType: 'contact' }
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

  // REQUIRED METHOD 1: Fetch page
  async fetchPersonPage({ objectType, page, limit, modifiedSince, sortDesc }) {
    const params = {
      start: page * limit,
      limit,
      sort: sortDesc ? 'update_time DESC' : 'update_time ASC'
    };

    if (modifiedSince) {
      params.filter_id = 'recent_persons';
      params.start_date = modifiedSince.toISOString();
    }

    const response = await this.pipedrive.api.getPersons(params);

    return {
      data: response.data,
      total: response.additional_data?.pagination?.total || null,
      hasMore: response.additional_data?.pagination?.more_items_in_collection
    };
  }

  // REQUIRED METHOD 2: Transform to Quo
  async transformPersonToQuo(person) {
    const phoneNumbers = (person.phone || [])
      .filter(p => p.value)
      .map(p => ({ name: p.label, value: p.value }));

    const emails = (person.email || [])
      .filter(e => e.value)
      .map(e => ({ name: e.label, value: e.value }));

    return {
      externalId: person.id,
      source: 'pipedrive-person',
      defaultFields: {
        firstName: person.first_name,
        lastName: person.last_name,
        company: person.org_id?.name,
        phoneNumbers,
        emails
      },
      customFields: {
        crmId: person.id,
        crmType: 'pipedrive',
        lastModified: person.update_time
      }
    };
  }

  // REQUIRED METHOD 3: Log SMS
  async logSMSToActivity(activity) {
    await this.pipedrive.api.createActivity({
      type: 'sms',
      subject: `SMS: ${activity.direction}`,
      note: activity.content,
      person_id: activity.contactExternalId,
      done: true
    });
  }

  // REQUIRED METHOD 4: Log Call
  async logCallToActivity(activity) {
    await this.pipedrive.api.createActivity({
      type: 'call',
      subject: `Call: ${activity.direction}`,
      note: activity.summary,
      duration: activity.duration,
      person_id: activity.contactExternalId,
      done: true
    });
  }

  // REQUIRED METHOD 5: Setup webhooks
  async setupWebhooks() {
    const webhookUrl = `${process.env.API_URL}/api/pipedrive/webhooks`;

    await this.pipedrive.api.createWebhook({
      subscription_url: webhookUrl,
      event_action: 'updated',
      event_object: 'person'
    });
  }

  // OPTIONAL: Override fetchPersonById for efficiency
  async fetchPersonById(id) {
    const response = await this.pipedrive.api.getPerson(id);
    return response.data;
  }
}

module.exports = PipedriveIntegration;
```

---

## Examples

### Example 1: Attio Integration (New)

> 📦 **QUO INTEGRATIONS** - `quo--frigg/backend/src/integrations/AttioIntegration.js`

```javascript
const { BaseCRMIntegration } = require('../base/BaseCRMIntegration');

class AttioIntegration extends BaseCRMIntegration {
  static Definition = {
    name: 'attio',
    version: '1.0.0',
    modules: {
      attio: require('../api-modules/attio'),
      quo: require('../api-modules/quo')
    },
    display: {
      name: 'Attio',
      description: 'Sync persons from Attio to Quo',
      icon: 'https://...'
    }
  };

  static CRMConfig = {
    personObjectTypes: [
      { crmObjectName: 'Person', quoContactType: 'contact' }
    ],
    syncConfig: {
      reverseChronological: true,
      initialBatchSize: 100,
      ongoingBatchSize: 50,
      supportsWebhooks: true,
    },
    queueConfig: {
      maxWorkers: 30,
      provisioned: 10
    }
  };

  async fetchPersonPage({ objectType, page, limit, modifiedSince, sortDesc }) {
    const response = await this.attio.api.listRecords('people', {
      limit,
      offset: page * limit,
      sorts: [{ field: 'updated_at', direction: sortDesc ? 'desc' : 'asc' }]
    });

    return {
      data: response.data,
      total: response.count,
      hasMore: response.has_more
    };
  }

  async transformPersonToQuo(person) {
    return {
      externalId: person.id.record_id,
      source: 'attio-person',
      defaultFields: {
        firstName: person.values.name?.[0]?.first_name,
        lastName: person.values.name?.[0]?.last_name,
        emails: person.values.email_addresses?.map(e => ({ value: e.email_address })),
        phoneNumbers: person.values.phone_numbers?.map(p => ({ value: p.phone_number }))
      }
    };
  }

  async logSMSToActivity(activity) {
    await this.attio.api.createNote(activity.contactExternalId, {
      title: `SMS: ${activity.direction}`,
      content: activity.content,
      created_at: activity.timestamp
    });
  }

  async logCallToActivity(activity) {
    await this.attio.api.createNote(activity.contactExternalId, {
      title: `Call: ${activity.direction} (${activity.duration}s)`,
      content: activity.summary,
      created_at: activity.timestamp
    });
  }

  async setupWebhooks() {
    const webhookUrl = `${process.env.API_URL}/api/attio/webhooks`;
    await this.attio.api.createWebhook({
      url: webhookUrl,
      subscriptions: ['record.updated'],
      object: 'person'
    });
  }
}

module.exports = AttioIntegration;
```

### Example 2: AxisCare Integration (No Webhooks)

> 📦 **QUO INTEGRATIONS** - `quo--frigg/backend/src/integrations/AxisCareIntegration.js`

```javascript
class AxisCareIntegration extends BaseCRMIntegration {
  static CRMConfig = {
    personObjectTypes: [
      { crmObjectName: 'Contact', quoContactType: 'contact' }
    ],
    syncConfig: {
      reverseChronological: true,
      initialBatchSize: 50,
      ongoingBatchSize: 25,
      supportsWebhooks: false,  // AxisCare doesn't support webhooks
      pollIntervalMinutes: 30    // Poll every 30 minutes
    },
    queueConfig: {
      maxWorkers: 15
    }
  };

  async fetchPersonPage({ objectType, page, limit, modifiedSince, sortDesc }) {
    const response = await this.axiscare.api.getContacts({
      page: page + 1, // AxisCare uses 1-indexed pages
      per_page: limit,
      sort_by: 'modified_date',
      sort_order: sortDesc ? 'desc' : 'asc',
      modified_since: modifiedSince?.toISOString()
    });

    return {
      data: response.contacts,
      total: response.total_count,
      hasMore: response.current_page < response.total_pages
    };
  }

  async transformPersonToQuo(person) {
    return {
      externalId: person.contact_id,
      source: 'axiscare-contact',
      defaultFields: {
        firstName: person.first_name,
        lastName: person.last_name,
        emails: person.email ? [{ value: person.email }] : [],
        phoneNumbers: person.phone ? [{ value: person.phone }] : []
      }
    };
  }

  async logSMSToActivity(activity) {
    await this.axiscare.api.createCommunication({
      contact_id: activity.contactExternalId,
      type: 'sms',
      direction: activity.direction,
      content: activity.content,
      date: activity.timestamp
    });
  }

  async logCallToActivity(activity) {
    await this.axiscare.api.createCommunication({
      contact_id: activity.contactExternalId,
      type: 'phone',
      direction: activity.direction,
      duration_seconds: activity.duration,
      notes: activity.summary,
      date: activity.timestamp
    });
  }

  async setupWebhooks() {
    // AxisCare doesn't support webhooks - will use polling
    console.log('AxisCare does not support webhooks, using polling fallback');
  }
}

module.exports = AxisCareIntegration;
```

### Example 3: ScalingTest Integration (Mock for Testing)

> 📦 **QUO INTEGRATIONS** - `quo--frigg/backend/src/integrations/ScalingTestIntegration.js`

```javascript
class ScalingTestIntegration extends BaseCRMIntegration {
  static CRMConfig = {
    personObjectTypes: [
      { crmObjectName: 'MockPerson', quoContactType: 'contact' }
    ],
    syncConfig: {
      reverseChronological: true,
      initialBatchSize: 200,  // Larger for testing
      ongoingBatchSize: 100,
      supportsWebhooks: true,
    },
    queueConfig: {
      maxWorkers: 50,  // Test high concurrency
      provisioned: 20
    }
  };

  async fetchPersonPage({ objectType, page, limit, modifiedSince, sortDesc }) {
    // Generate mock data
    const total = 10000; // Simulate 10k records
    const start = page * limit;
    const end = Math.min(start + limit, total);

    const mockPersons = [];
    for (let i = start; i < end; i++) {
      mockPersons.push({
        id: `mock_${i}`,
        first_name: `Test${i}`,
        last_name: `Person${i}`,
        email: `test${i}@example.com`,
        phone: `555-${String(i).padStart(4, '0')}`,
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        updated_at: new Date(Date.now() - i * 500).toISOString()
      });
    }

    return {
      data: mockPersons,
      total,
      hasMore: end < total
    };
  }

  async transformPersonToQuo(person) {
    return {
      externalId: person.id,
      source: 'scaling-test-person',
      defaultFields: {
        firstName: person.first_name,
        lastName: person.last_name,
        emails: [{ value: person.email }],
        phoneNumbers: [{ value: person.phone }]
      }
    };
  }

  async logSMSToActivity(activity) {
    // Mock: just log
    console.log(`[ScalingTest] SMS logged for ${activity.contactExternalId}`);
  }

  async logCallToActivity(activity) {
    // Mock: just log
    console.log(`[ScalingTest] Call logged for ${activity.contactExternalId}`);
  }

  async setupWebhooks() {
    // Mock: simulate webhook setup
    console.log('[ScalingTest] Webhooks simulated');
  }

  // Override for efficiency in testing
  async fetchPersonsByIds(ids) {
    return ids.map(id => ({
      id,
      first_name: 'Test',
      last_name: 'Bulk',
      email: `${id}@test.com`,
      phone: '555-0000'
    }));
  }
}

module.exports = ScalingTestIntegration;
```

### Example 4: Multi-Object CRM (ZohoCRM)

> 📦 **QUO INTEGRATIONS** - `quo--frigg/backend/src/integrations/SalesforceIntegration.js`

```javascript
class SalesforceIntegration extends BaseCRMIntegration {
  static CRMConfig = {
    personObjectTypes: [
      { crmObjectName: 'Contact', quoContactType: 'contact' },
      { crmObjectName: 'Lead', quoContactType: 'contact' }
    ],
    // ... rest of config
  };

  async fetchPersonPage({ objectType, page, limit, modifiedSince, sortDesc }) {
    const query = this.buildSOQLQuery(objectType, page, limit, modifiedSince, sortDesc);
    const response = await this.salesforce.api.query(query);

    return {
      data: response.records,
      total: response.totalSize,
      hasMore: !response.done
    };
  }

  buildSOQLQuery(objectType, page, limit, modifiedSince, sortDesc) {
    let query = `SELECT Id, FirstName, LastName, Email, Phone FROM ${objectType}`;

    if (modifiedSince) {
      query += ` WHERE LastModifiedDate >= ${modifiedSince.toISOString()}`;
    }

    query += ` ORDER BY LastModifiedDate ${sortDesc ? 'DESC' : 'ASC'}`;
    query += ` LIMIT ${limit} OFFSET ${page * limit}`;

    return query;
  }
}
```

### Example 5: Pipedrive (Complete Implementation)

> 📦 **QUO INTEGRATIONS** - `quo--frigg/backend/src/integrations/PipedriveIntegration.js`

See full implementation in "Implementation Guide" section above.

---

## Additional Patterns

### Pattern: Cursor-Based Pagination (if needed later)

> 📦 **QUO INTEGRATIONS** - `quo--frigg/backend/src/integrations/HubSpotIntegration.js`

```javascript
class HubSpotIntegration extends BaseCRMIntegration {
  async fetchPersonPage({ objectType, page, limit, modifiedSince, sortDesc }) {
    // Retrieve cursor from process context
    const process = await this.getCurrentProcess(); // Context needed
    const cursor = process.context?.pagination?.cursor;

    const response = await this.hubspot.api.getContacts({
      limit,
      after: cursor,
      sorts: [{ propertyName: 'lastmodifieddate', direction: sortDesc ? 'DESCENDING' : 'ASCENDING' }]
    });

    // Store next cursor in context
    if (response.paging?.next?.after) {
      await this.updateProcessContext(process.id, {
        pagination: { cursor: response.paging.next.after }
      });
    }

    return {
      data: response.results,
      total: response.total,
      hasMore: !!response.paging?.next
    };
  }
}
```

---

## Summary

This architecture provides:

### ✅ For New CRM Integrations

- Implement **3 methods**: `fetchPersonPage`, `transformPersonToQuo`, `setupWebhooks` (optional)
- Define **CRMConfig**: Object types, batch sizes, queue workers
- Auto-generated: Events, handlers, queues, routes, metrics

### ✅ For Quo Team

- **Reverse chronological sync** (newest first)
- **Fast results** via configurable queue workers (25-50 workers)
- **Real-time progress** via WebSocket updates
- **Aggregate metrics**: Total synced, failed, duration, records/sec

### ✅ For Architecture

- **DDD/Hexagonal**: Use cases, repositories, domain logic separation
- **Prisma-backed**: CRMSyncProcess model with state machine
- **Process orchestration**: State transitions, context storage
- **Fan-out pattern**: Queue all pages concurrently after knowing total
- **Lifecycle hooks**: onCreate, onUpdate with webhook setup

---

## Next Steps

### 🏗️ Frigg Core Changes

1. **Add Process Model to Prisma Schema** (`packages/core/prisma-mongo/schema.prisma`)
   - Generic `Process` model with flexible context/results
   - Supports any integration type (CRM sync, data migration, etc.)

2. **Implement Use Cases** (`packages/core/integrations/use-cases/`)
   - `CreateProcess` - Create process records
   - `UpdateProcessState` - State transitions
   - `UpdateProcessMetrics` - Aggregate metrics updates
   - `GetProcess` - Retrieve process by ID

3. **Create Repository** (`packages/core/integrations/repositories/`)
   - `ProcessRepository` - Generic process data access
   - `process-repository-factory.js` - Repository factory

4. **Update Serverless Template** (`packages/devtools/infrastructure/serverless-template.js`)
   - Support `queueConfig` override in IntegrationDefinition
   - Apply custom worker concurrency, batch size, timeout

### 📦 Quo Integrations Changes

1. **Create BaseCRMIntegration** (`quo--frigg/backend/src/base/BaseCRMIntegration.js`)
   - Extends IntegrationBase from Frigg Core
   - Auto-generated events/handlers
   - Process management helpers
   - Queue orchestration
   - **Note:** Lives in quo--frigg (not Frigg Core) since it's Quo-specific

2. **Create Quo API Module** (`quo--frigg/backend/src/api-modules/quo/`)
   - API client for Quo
   - Bulk contact upsert endpoint
   - Activity logging endpoints (SMS, Call)

3. **Port Existing Integrations**
   - Refactor `ZohoCRMIntegration.js` to extend BaseCRMIntegration
   - Refactor `PipedriveIntegration.js` to extend BaseCRMIntegration
   - Implement all 5 core methods

4. **Create New Integrations**
   - `AttioIntegration.js` - Modern CRM with webhook support
   - `AxisCareIntegration.js` - Healthcare CRM (polling only)
   - `ScalingTestIntegration.js` - Mock CRM for performance testing (10k records)
   - Follow BaseCRMIntegration pattern

5. **Testing & Validation**
   - Use ScalingTest integration for load testing
   - Test with Quo team performance requirements
   - Validate reverse chronological sync
   - Monitor queue concurrency and rate limiting
   - Verify SMS/Call activity logging

---

**Questions or feedback?** Contact the team or open an issue in the respective repo.

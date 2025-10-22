# Zoho CRM Developer API v8

## Introduction

The Zoho CRM Developer API v8 is a comprehensive RESTful API that enables developers to programmatically interact with Zoho CRM's complete suite of customer relationship management features. Built on OAuth 2.0 authentication, this API provides secure access to CRM data, automation tools, and business logic. The API supports all standard CRM operations including managing leads, contacts, accounts, deals, and custom modules, with additional capabilities for bulk data operations, advanced querying through COQL (CRM Object Query Language), and real-time integrations via webhooks.

This API is designed for enterprise-grade integrations, supporting up to 200,000 records per bulk operation, complex multi-table queries with join operations, and sophisticated automation workflows. The v8 version includes enhanced features for territory management, blueprint automation, record locking, and multi-currency support. With consistent REST patterns, comprehensive error handling, and extensive metadata APIs, developers can build robust integrations ranging from simple data synchronization to complex business process automation across web applications, mobile apps, and third-party platforms.

## API Documentation

### Authentication - OAuth 2.0 Token Generation

Generate access tokens using OAuth 2.0 authorization code flow for API authentication.

```bash
# Step 1: Get authorization code (browser)
https://accounts.zoho.com/oauth/v2/auth?scope=ZohoCRM.modules.ALL&client_id={client_id}&response_type=code&access_type=offline&redirect_uri={redirect_uri}

# Step 2: Exchange authorization code for tokens
curl "https://accounts.zoho.com/oauth/v2/token" \
  -X POST \
  -d "grant_type=authorization_code" \
  -d "client_id=1000.ABC123XYZ" \
  -d "client_secret=abc123def456ghi789" \
  -d "redirect_uri=https://www.example.com/callback" \
  -d "code=1000.xyz789abc456"

# Response
{
  "access_token": "1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1",
  "refresh_token": "1000.4b2e8dfa9c3d1a5b7e6f.8a9c7d6e5f4a3b2c1d0e",
  "api_domain": "https://www.zohoapis.com",
  "token_type": "Bearer",
  "expires_in": 3600
}

# Step 3: Refresh access token (when expired)
curl "https://accounts.zoho.com/oauth/v2/token" \
  -X POST \
  -d "grant_type=refresh_token" \
  -d "client_id=1000.ABC123XYZ" \
  -d "client_secret=abc123def456ghi789" \
  -d "refresh_token=1000.4b2e8dfa9c3d1a5b7e6f.8a9c7d6e5f4a3b2c1d0e"

# Use in API requests
curl "https://www.zohoapis.com/crm/v8/Leads" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"
```

### Get Records - Retrieve CRM Records

Retrieve records from any CRM module with pagination, field selection, filtering, and sorting capabilities.

```bash
# Get all leads with specific fields
curl "https://www.zohoapis.com/crm/v8/Leads?fields=Last_Name,Email,Company,Phone&per_page=10&page=1" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Response
{
  "data": [
    {
      "Last_Name": "Smith",
      "Email": "jsmith@example.com",
      "Company": "Acme Corp",
      "Phone": "555-0100",
      "id": "3652397000009851001"
    },
    {
      "Last_Name": "Johnson",
      "Email": "mjohnson@techstart.com",
      "Company": "TechStart Inc",
      "Phone": "555-0201",
      "id": "3652397000009851002"
    }
  ],
  "info": {
    "per_page": 10,
    "count": 2,
    "page": 1,
    "more_records": true,
    "next_page_token": "c8582e7c7"
  }
}

# Get single record by ID with all fields
curl "https://www.zohoapis.com/crm/v8/Contacts/3652397000009851001" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Get records with custom view and sorting
curl "https://www.zohoapis.com/crm/v8/Deals?cvid=3652397000000087501&sort_by=Amount&sort_order=desc&per_page=50" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Paginate beyond 2000 records using page_token
curl "https://www.zohoapis.com/crm/v8/Accounts?page_token=c8582e7c7&per_page=200" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"
```

### Insert Records - Create New CRM Records

Create one or multiple records in any CRM module with support for lookup fields, subforms, and file attachments.

```bash
# Create single lead
curl "https://www.zohoapis.com/crm/v8/Leads" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "Last_Name": "Martinez",
        "First_Name": "Carlos",
        "Company": "Global Solutions Ltd",
        "Email": "cmartinez@globalsolutions.com",
        "Phone": "555-0303",
        "Lead_Source": "Web Form",
        "Industry": "Technology",
        "Annual_Revenue": 5000000,
        "Rating": "Hot"
      }
    ],
    "trigger": ["workflow", "approval", "blueprint"]
  }'

# Response
{
  "data": [
    {
      "code": "SUCCESS",
      "details": {
        "Modified_Time": "2024-10-13T10:30:47-07:00",
        "Modified_By": {
          "name": "John Admin",
          "id": "5725767000000411001"
        },
        "Created_Time": "2024-10-13T10:30:47-07:00",
        "id": "5725767000000524157",
        "Created_By": {
          "name": "John Admin",
          "id": "5725767000000411001"
        }
      },
      "message": "record added",
      "status": "success"
    }
  ]
}

# Create multiple contacts with lookup and multi-select fields
curl "https://www.zohoapis.com/crm/v8/Contacts" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "Last_Name": "Chen",
        "First_Name": "Wei",
        "Email": "wchen@enterprise.com",
        "Account_Name": {
          "id": "3652397000000624046"
        },
        "Owner": {
          "id": "5725767000000411001"
        },
        "Lead_Source": "Partner",
        "Multi_Select_Field": [
          "Option 1",
          "Option 2"
        ]
      },
      {
        "Last_Name": "Patel",
        "First_Name": "Priya",
        "Email": "ppatel@startup.io",
        "Account_Name": {
          "id": "3652397000000624047"
        },
        "Phone": "555-0404"
      }
    ],
    "duplicate_check_fields": ["Email"]
  }'
```

### Update Records - Modify Existing Records

Update one or multiple records with support for conditional updates and field value appending.

```bash
# Update single deal
curl "https://www.zohoapis.com/crm/v8/Deals/5725767000004594012" \
  -X PUT \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "Stage": "Negotiation/Review",
        "Amount": 75000,
        "Closing_Date": "2024-12-31",
        "Probability": 75,
        "Next_Step": "Send proposal"
      }
    ]
  }'

# Bulk update multiple records
curl "https://www.zohoapis.com/crm/v8/Leads" \
  -X PUT \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "id": "3652397000009851001",
        "Lead_Status": "Qualified",
        "Rating": "Hot"
      },
      {
        "id": "3652397000009851002",
        "Lead_Status": "Contacted",
        "Rating": "Warm"
      }
    ]
  }'

# Response
{
  "data": [
    {
      "code": "SUCCESS",
      "details": {
        "Modified_Time": "2024-10-13T11:15:22-07:00",
        "Modified_By": {
          "name": "John Admin",
          "id": "5725767000000411001"
        },
        "id": "5725767000004594012"
      },
      "message": "record updated",
      "status": "success"
    }
  ]
}

# Conditional update with If-Unmodified-Since header
curl "https://www.zohoapis.com/crm/v8/Accounts/3652397000009851001" \
  -X PUT \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "If-Unmodified-Since: 2024-10-13T10:00:00-07:00" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "Account_Name": "Updated Account Name",
        "Phone": "555-9999"
      }
    ]
  }'
```

### Delete Records - Remove Records

Delete one or multiple records with support for moving to recycle bin or permanent deletion.

```bash
# Delete single record (moves to recycle bin)
curl "https://www.zohoapis.com/crm/v8/Leads/3652397000009851001" \
  -X DELETE \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Delete multiple records
curl "https://www.zohoapis.com/crm/v8/Contacts?ids=3652397000009851001,3652397000009851002,3652397000009851003" \
  -X DELETE \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Response
{
  "data": [
    {
      "code": "SUCCESS",
      "details": {
        "id": "3652397000009851001"
      },
      "message": "record deleted",
      "status": "success"
    }
  ]
}

# Permanently delete from recycle bin
curl "https://www.zohoapis.com/crm/v8/Leads/Deleted/actions/delete?ids=3652397000009851001" \
  -X DELETE \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"
```

### COQL Query - Advanced Record Search

Execute SQL-like queries with joins, aggregations, and complex filtering using CRM Object Query Language.

```bash
# Basic COQL query
curl "https://www.zohoapis.com/crm/v8/coql" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "select_query": "select Last_Name, First_Name, Email, Phone from Contacts where Last_Name = '\''Smith'\'' and Email is not null limit 10"
  }'

# Query with joins across modules
curl "https://www.zohoapis.com/crm/v8/coql" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "select_query": "select Last_Name, First_Name, Account_Name.Account_Name, Account_Name.Phone, Owner.last_name from Contacts where Account_Name.Industry = '\''Technology'\'' and Owner.status = '\''active'\'' order by Created_Time desc limit 50"
  }'

# Response
{
  "data": [
    {
      "Last_Name": "Johnson",
      "First_Name": "Sarah",
      "Account_Name.Account_Name": "TechCorp Inc",
      "Account_Name.Phone": "555-1000",
      "Owner.last_name": "Admin",
      "id": "3652397000009851001"
    }
  ],
  "info": {
    "count": 1,
    "more_records": false
  }
}

# Advanced query with aggregation and grouping
curl "https://www.zohoapis.com/crm/v8/coql" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "select_query": "select Owner.last_name, Stage, COUNT(*) as deal_count, SUM(Amount) as total_amount, AVG(Amount) as avg_amount from Deals where Closing_Date between '\''2024-01-01'\'' and '\''2024-12-31'\'' group by Owner.last_name, Stage having SUM(Amount) > 100000"
  }'

# Query with IN clause and LIKE operator
curl "https://www.zohoapis.com/crm/v8/coql" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "select_query": "select Company, Last_Name, Lead_Source from Leads where Lead_Status in ('\''Qualified'\'', '\''Contacted'\'') and Company like '\''%Tech%'\'' and Annual_Revenue > 1000000"
  }'
```

### Convert Lead - Transform Lead to Account, Contact, and Deal

Convert qualified leads into accounts, contacts, and optionally create associated deals with contact roles.

```bash
# Convert lead to new account, contact, and deal
curl "https://www.zohoapis.com/crm/v8/Leads/3652397000007566544/actions/convert" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "overwrite": false,
        "notify_lead_owner": true,
        "notify_new_entity_owner": true,
        "move_attachments_to": {
          "api_name": "Deals"
        },
        "Accounts": {
          "Account_Name": "Enterprise Solutions Corp",
          "Phone": "555-7000",
          "Website": "www.enterprisesolutions.com",
          "Industry": "Software"
        },
        "Contacts": {
          "Email": "director@enterprisesolutions.com",
          "Phone": "555-7001"
        },
        "Deals": {
          "Deal_Name": "Enterprise Software License",
          "Amount": 250000,
          "Closing_Date": "2024-12-31",
          "Stage": "Qualification",
          "Pipeline": "Standard (Standard)",
          "Contact_Role": "5545974000000006873"
        },
        "carry_over_tags": {
          "Contacts": ["hot-lead", "enterprise"],
          "Accounts": ["enterprise"],
          "Deals": ["high-value"]
        }
      }
    ]
  }'

# Response
{
  "data": [
    {
      "code": "SUCCESS",
      "Contacts": {
        "name": "John Director",
        "id": "3652397000009876543"
      },
      "Accounts": {
        "name": "Enterprise Solutions Corp",
        "id": "3652397000009876540"
      },
      "Deals": {
        "name": "Enterprise Software License",
        "id": "3652397000009876550"
      },
      "details": {},
      "message": "lead converted",
      "status": "success"
    }
  ]
}

# Convert lead to existing account and contact
curl "https://www.zohoapis.com/crm/v8/Leads/3652397000007566545/actions/convert" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "Accounts": {
          "id": "3652397000000624046"
        },
        "Contacts": {
          "id": "3652397000000624640"
        }
      }
    ]
  }'
```

### Send Email - Send Emails from CRM

Send HTML or plain text emails with attachments, CC/BCC recipients, and schedule for later delivery.

```bash
# Send immediate email with attachments
curl "https://www.zohoapis.com/crm/v8/Leads/3652397000002181001/actions/send_mail" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "from": {
          "user_name": "Sales Team",
          "email": "sales@company.com"
        },
        "to": [
          {
            "user_name": "John Smith",
            "email": "jsmith@client.com"
          }
        ],
        "cc": [
          {
            "user_name": "Manager",
            "email": "manager@company.com"
          }
        ],
        "bcc": [
          {
            "email": "archive@company.com"
          }
        ],
        "subject": "Product Proposal - Q4 2024",
        "content": "<h2>Dear John,</h2><p>Please find attached our product proposal for your review.</p><p>Best regards,<br>Sales Team</p>",
        "mail_format": "html",
        "consent_email": false,
        "attachments": [
          {
            "id": "2cceafa194d037b63f2000181dd81864b4812b1f8b0b4fe0949a982de89fa75a"
          }
        ],
        "inventory_details": {
          "inventory_template": {
            "id": "5725767000000624001"
          }
        },
        "in_reply_to": "3652397000002181050",
        "paper_type": "Letter",
        "view_type": "Landscape"
      }
    ]
  }'

# Response
{
  "data": [
    {
      "code": "SUCCESS",
      "details": {
        "message_id": "2cceafa194d037b63f2000181dd8186486f1eb0360aee76d802b6d376dea22e2"
      },
      "message": "Your mail has been sent successfully.",
      "status": "success"
    }
  ]
}

# Schedule email for future delivery
curl "https://www.zohoapis.com/crm/v8/Contacts/3652397000002181002/actions/send_mail" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "from": {
          "email": "support@company.com"
        },
        "to": [
          {
            "email": "client@business.com"
          }
        ],
        "subject": "Scheduled Follow-up",
        "content": "This is a scheduled follow-up email.",
        "mail_format": "html",
        "scheduled_time": "2024-10-15T09:00:00+00:00"
      }
    ]
  }'
```

### Create Notes - Add Notes to Records

Create notes and attach them to any CRM module record for tracking interactions and details.

```bash
# Create note for a lead
curl "https://www.zohoapis.com/crm/v8/Leads/1000000145990/Notes" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "Note_Title": "Discovery Call Summary",
        "Note_Content": "Spoke with decision maker. Key pain points: 1) Manual data entry, 2) Lack of reporting. Budget: $50K-100K. Timeline: Q1 2025. Next step: Send product demo video."
      }
    ]
  }'

# Response
{
  "data": [
    {
      "code": "SUCCESS",
      "details": {
        "Modified_Time": "2024-10-13T14:30:15-07:00",
        "Modified_By": {
          "name": "John Admin",
          "id": "5725767000000411001"
        },
        "Created_Time": "2024-10-13T14:30:15-07:00",
        "id": "3652397000009987654",
        "Created_By": {
          "name": "John Admin",
          "id": "5725767000000411001"
        }
      },
      "message": "record added",
      "status": "success"
    }
  ]
}

# Create multiple notes across different records
curl "https://www.zohoapis.com/crm/v8/Notes" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [
      {
        "Parent_Id": {
          "module": {
            "api_name": "Contacts",
            "id": "5725767000000002175"
          },
          "id": "6157809000012985001"
        },
        "Note_Title": "Meeting Notes",
        "Note_Content": "Discussed implementation timeline and resource allocation."
      },
      {
        "Parent_Id": {
          "module": {
            "api_name": "Deals",
            "id": "5725767000000002181"
          },
          "id": "6157809000012985050"
        },
        "Note_Title": "Contract Review",
        "Note_Content": "Legal team reviewing terms. Expected approval by end of week."
      }
    ]
  }'
```

### Bulk Read - Export Large Datasets

Create bulk export jobs to download up to 200,000 records with custom criteria and field selection.

```bash
# Create bulk read job with criteria
curl "https://www.zohoapis.com/crm/bulk/v8/read" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "callback": {
      "url": "https://www.example.com/webhook-callback",
      "method": "post"
    },
    "query": {
      "module": {
        "api_name": "Contacts"
      },
      "fields": [
        "Last_Name",
        "First_Name",
        "Email",
        "Phone",
        "Owner.last_name",
        "Owner.email",
        "Account_Name.Account_Name",
        "Lead_Source",
        "Created_Time",
        "Modified_Time"
      ],
      "criteria": {
        "group_operator": "and",
        "group": [
          {
            "field": {"api_name": "Lead_Source"},
            "comparator": "equal",
            "value": "Web Form"
          },
          {
            "field": {"api_name": "Created_Time"},
            "comparator": "between",
            "value": ["2024-01-01T00:00:00+00:00", "2024-12-31T23:59:59+00:00"]
          }
        ]
      },
      "page": 1
    }
  }'

# Response
{
  "data": [
    {
      "status": "success",
      "code": "ADDED_SUCCESSFULLY",
      "message": "Added successfully.",
      "details": {
        "id": "5725767000002383001",
        "operation": "read",
        "state": "ADDED",
        "created_by": {
          "id": "5725767000000411001",
          "name": "John Admin"
        },
        "created_time": "2024-10-13T10:00:00-07:00"
      }
    }
  ]
}

# Check job status
curl "https://www.zohoapis.com/crm/bulk/v8/read/5725767000002383001" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Download result when completed
curl "https://www.zohoapis.com/crm/bulk/v8/read/5725767000002383001/result" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -o contacts_export.zip
```

### Bulk Write - Import Large Datasets

Create bulk import jobs to insert, update, or upsert up to 25,000 records from CSV files.

```bash
# Step 1: Upload CSV file
curl "https://content.zohoapis.com/crm/v8/upload" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "feature: bulk-write" \
  -F "file=@/path/to/contacts.csv"

# Response
{
  "status": "success",
  "code": "FILE_UPLOAD_SUCCESS",
  "message": "File uploaded successfully.",
  "details": {
    "file_id": "2cceafa194d037b63f2000181dd81864"
  }
}

# Step 2: Create bulk write job
curl "https://www.zohoapis.com/crm/bulk/v8/write" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "insert",
    "callback": {
      "url": "https://www.example.com/bulk-write-callback",
      "method": "post"
    },
    "resource": [
      {
        "type": "data",
        "module": {
          "api_name": "Contacts"
        },
        "file_id": "2cceafa194d037b63f2000181dd81864",
        "field_mappings": [
          {
            "api_name": "Last_Name",
            "index": 0
          },
          {
            "api_name": "First_Name",
            "index": 1
          },
          {
            "api_name": "Email",
            "index": 2
          },
          {
            "api_name": "Phone",
            "index": 3
          },
          {
            "api_name": "Account_Name",
            "index": 4,
            "find_by": "Account_Name"
          }
        ],
        "find_by": ["Email"]
      }
    ]
  }'

# Response
{
  "data": [
    {
      "status": "success",
      "code": "ADDED_SUCCESSFULLY",
      "message": "Added successfully.",
      "details": {
        "id": "5725767000002398001",
        "operation": "insert",
        "state": "ADDED",
        "created_by": {
          "id": "5725767000000411001",
          "name": "John Admin"
        },
        "created_time": "2024-10-13T11:00:00-07:00"
      }
    }
  ]
}

# Check job status and download results
curl "https://www.zohoapis.com/crm/bulk/v8/write/5725767000002398001" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

curl "https://www.zohoapis.com/crm/bulk/v8/write/5725767000002398001/result" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -o import_results.csv
```

### Create Webhook - Set Up Real-time Notifications

Configure webhooks to receive real-time HTTP callbacks when CRM events occur.

```bash
# Create webhook for lead creation
curl "https://www.zohoapis.com/crm/v8/settings/automation/webhooks" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "webhooks": [
      {
        "module": "Leads",
        "name": "New Lead Notification Webhook",
        "url": "https://api.example.com/webhooks/crm/lead-created",
        "http_method": "POST",
        "description": "Triggered when new lead is created in CRM",
        "authentication": {
          "type": "general",
          "authorization_type": "bearer",
          "authorization_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
        },
        "module_params": [
          {
            "name": "lead_id",
            "value": "${Leads.Id}"
          },
          {
            "name": "lead_name",
            "value": "${Leads.Full_Name}"
          },
          {
            "name": "email",
            "value": "${Leads.Email}"
          },
          {
            "name": "company",
            "value": "${Leads.Company}"
          }
        ],
        "custom_params": [
          {
            "name": "source",
            "value": "zoho_crm"
          },
          {
            "name": "environment",
            "value": "production"
          }
        ]
      }
    ]
  }'

# Response
{
  "webhooks": [
    {
      "code": "SUCCESS",
      "details": {
        "id": "5725767000002415001"
      },
      "message": "Webhook created successfully",
      "status": "success"
    }
  ]
}

# Get all webhooks
curl "https://www.zohoapis.com/crm/v8/settings/automation/webhooks" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Update webhook
curl "https://www.zohoapis.com/crm/v8/settings/automation/webhooks/5725767000002415001" \
  -X PUT \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "webhooks": [
      {
        "url": "https://api.example.com/webhooks/crm/lead-updated",
        "description": "Updated webhook endpoint"
      }
    ]
  }'

# Delete webhook
curl "https://www.zohoapis.com/crm/v8/settings/automation/webhooks/5725767000002415001" \
  -X DELETE \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"
```

### Get Users - Retrieve User Information

Fetch user details including roles, profiles, territories, and permissions.

```bash
# Get all active users
curl "https://www.zohoapis.com/crm/v8/users?type=ActiveUsers" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Response
{
  "users": [
    {
      "country": "US",
      "role": {
        "name": "Sales Manager",
        "id": "554023000000026005"
      },
      "Currency": "USD",
      "id": "554023000000235011",
      "email": "smanager@company.com",
      "first_name": "Sarah",
      "last_name": "Manager",
      "full_name": "Sarah Manager",
      "profile": {
        "name": "Sales Profile",
        "id": "554023000000026014"
      },
      "status": "active",
      "confirm": true,
      "Mobile": "555-2000",
      "time_zone": "America/Los_Angeles",
      "date_format": "MM/dd/yyyy",
      "time_format": "hh:mm a",
      "territories": [
        {
          "name": "West Coast",
          "id": "554023000000256001"
        }
      ]
    }
  ],
  "info": {
    "per_page": 200,
    "count": 1,
    "page": 1,
    "more_records": false
  }
}

# Get specific user by ID
curl "https://www.zohoapis.com/crm/v8/users/554023000000235011" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Get current authenticated user
curl "https://www.zohoapis.com/crm/v8/users?type=CurrentUser" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Get admin users only
curl "https://www.zohoapis.com/crm/v8/users?type=AdminUsers" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"
```

### Get Modules - Retrieve Module Metadata

Get information about all CRM modules including custom modules, layouts, and field permissions.

```bash
# Get all modules
curl "https://www.zohoapis.com/crm/v8/settings/modules" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Response
{
  "modules": [
    {
      "global_search_supported": true,
      "kanban_view": true,
      "deletable": false,
      "description": "Potential customers who have shown interest",
      "creatable": true,
      "inventory_template_supported": false,
      "modified_time": "2024-08-15T10:30:00-07:00",
      "plural_label": "Leads",
      "presence_sub_menu": false,
      "triggers_supported": true,
      "id": "554023000000002175",
      "isBlueprintSupported": true,
      "visibility": 1,
      "convertable": true,
      "editable": true,
      "emailTemplate_support": true,
      "profiles": [
        {
          "name": "Administrator",
          "id": "554023000000026014"
        }
      ],
      "filter_supported": true,
      "web_link": null,
      "sequence_number": 1,
      "singular_label": "Lead",
      "viewable": true,
      "api_supported": true,
      "api_name": "Leads",
      "quick_create": true,
      "modified_by": {
        "name": "System Admin",
        "id": "554023000000235011"
      },
      "generated_type": "default",
      "feeds_required": false,
      "scoring_supported": true,
      "webform_supported": true,
      "arguments": [],
      "module_name": "Leads",
      "business_card_field_limit": 5,
      "custom_module": false
    }
  ]
}

# Get specific module metadata
curl "https://www.zohoapis.com/crm/v8/settings/modules/Deals" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Get module fields
curl "https://www.zohoapis.com/crm/v8/settings/fields?module=Contacts" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"
```

### Search Records - Full-Text Search

Perform full-text search across modules with criteria, email, phone, or word matching.

```bash
# Search contacts by email
curl "https://www.zohoapis.com/crm/v8/Contacts/search?email=john@example.com" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Search by phone number
curl "https://www.zohoapis.com/crm/v8/Leads/search?phone=5550100" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Search by criteria (field-specific)
curl "https://www.zohoapis.com/crm/v8/Deals/search?criteria=(Stage:equals:Negotiation)and(Amount:greater_than:50000)" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Response
{
  "data": [
    {
      "Owner": {
        "name": "Sarah Manager",
        "id": "554023000000235011"
      },
      "Deal_Name": "Enterprise License Deal",
      "Stage": "Negotiation",
      "Amount": 150000,
      "Closing_Date": "2024-11-30",
      "Account_Name": {
        "name": "TechCorp Inc",
        "id": "554023000000487001"
      },
      "id": "554023000000512001",
      "Created_Time": "2024-09-15T10:00:00-07:00"
    }
  ],
  "info": {
    "per_page": 200,
    "count": 1,
    "page": 1,
    "more_records": false
  }
}

# Full-text word search
curl "https://www.zohoapis.com/crm/v8/Accounts/search?word=technology" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Search with multiple criteria and field selection
curl "https://www.zohoapis.com/crm/v8/Contacts/search?criteria=((Last_Name:equals:Smith)or(Last_Name:equals:Johnson))and(Lead_Source:equals:Web)&fields=Last_Name,First_Name,Email,Account_Name&per_page=50" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"
```

### Upload and Attach Files

Upload files to CRM records including images, documents, and other attachments.

```bash
# Upload attachment to a record
curl "https://www.zohoapis.com/crm/v8/Leads/3652397000009851001/Attachments" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -F "file=@/path/to/proposal.pdf"

# Response
{
  "data": [
    {
      "code": "SUCCESS",
      "details": {
        "Modified_Time": "2024-10-13T15:45:30-07:00",
        "Modified_By": {
          "name": "John Admin",
          "id": "5725767000000411001"
        },
        "Created_Time": "2024-10-13T15:45:30-07:00",
        "id": "3652397000010987654",
        "Created_By": {
          "name": "John Admin",
          "id": "5725767000000411001"
        }
      },
      "message": "attachment uploaded successfully",
      "status": "success"
    }
  ]
}

# Upload photo to record
curl "https://www.zohoapis.com/crm/v8/Contacts/3652397000009851001/photo" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -F "file=@/path/to/profile.jpg"

# Get all attachments for a record
curl "https://www.zohoapis.com/crm/v8/Deals/3652397000009851001/Attachments" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Download specific attachment
curl "https://www.zohoapis.com/crm/v8/Leads/3652397000009851001/Attachments/3652397000010987654" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -o downloaded_file.pdf

# Delete attachment
curl "https://www.zohoapis.com/crm/v8/Leads/3652397000009851001/Attachments/3652397000010987654" \
  -X DELETE \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"
```

### Manage Tags - Organize Records with Tags

Create, assign, and manage tags to categorize and organize CRM records.

```bash
# Create new tags
curl "https://www.zohoapis.com/crm/v8/settings/tags?module=Leads" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "tags": [
      {
        "name": "Hot Lead"
      },
      {
        "name": "Enterprise"
      },
      {
        "name": "Q4-2024"
      }
    ]
  }'

# Response
{
  "tags": [
    {
      "code": "SUCCESS",
      "details": {
        "id": "3652397000011234567",
        "created_time": "2024-10-13T16:00:00-07:00",
        "created_by": {
          "id": "5725767000000411001",
          "name": "John Admin"
        }
      },
      "message": "tags created successfully",
      "status": "success"
    }
  ]
}

# Add tags to specific records
curl "https://www.zohoapis.com/crm/v8/Leads/actions/add_tags?ids=3652397000009851001,3652397000009851002&tag_names=Hot Lead,Enterprise" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Get all tags for a module
curl "https://www.zohoapis.com/crm/v8/settings/tags?module=Contacts" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Get records by tag
curl "https://www.zohoapis.com/crm/v8/Leads?tag_names=Hot Lead" \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Remove tags from records
curl "https://www.zohoapis.com/crm/v8/Leads/actions/remove_tags?ids=3652397000009851001&tag_names=Q4-2024" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"

# Update tag name
curl "https://www.zohoapis.com/crm/v8/settings/tags/3652397000011234567?module=Leads" \
  -X PUT \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "tags": [
      {
        "name": "Priority Lead"
      }
    ]
  }'

# Delete tag
curl "https://www.zohoapis.com/crm/v8/settings/tags/3652397000011234567?module=Leads" \
  -X DELETE \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1"
```

### Composite API - Batch Multiple API Calls

Execute multiple API operations in a single HTTP request to reduce network overhead and improve performance.

```bash
# Execute multiple operations in one request
curl "https://www.zohoapis.com/crm/v8/composite" \
  -X POST \
  -H "Authorization: Zoho-oauthtoken 1000.8cb99dea7ecf0c7d09be93.9b8fa7dcf6a3b2e1" \
  -H "Content-Type: application/json" \
  -d '{
    "composite_request": [
      {
        "method": "GET",
        "url": "/crm/v8/Leads?fields=Last_Name,Company&per_page=5",
        "headers": {},
        "reference_id": "get_leads"
      },
      {
        "method": "POST",
        "url": "/crm/v8/Contacts",
        "headers": {
          "Content-Type": "application/json"
        },
        "body": {
          "data": [
            {
              "Last_Name": "Anderson",
              "First_Name": "Mike",
              "Email": "manderson@newcompany.com",
              "Phone": "555-5000"
            }
          ]
        },
        "reference_id": "create_contact"
      },
      {
        "method": "PUT",
        "url": "/crm/v8/Deals/3652397000009851001",
        "headers": {
          "Content-Type": "application/json"
        },
        "body": {
          "data": [
            {
              "Stage": "Closed Won",
              "Amount": 100000
            }
          ]
        },
        "reference_id": "update_deal"
      },
      {
        "method": "POST",
        "url": "/crm/v8/coql",
        "headers": {
          "Content-Type": "application/json"
        },
        "body": {
          "select_query": "select Last_Name, Email from Contacts where Lead_Source = '\''Advertisement'\'' limit 5"
        },
        "reference_id": "query_contacts"
      }
    ]
  }'

# Response
{
  "composite_response": [
    {
      "code": "SUCCESS",
      "details": {
        "data": [
          {
            "Last_Name": "Smith",
            "Company": "Acme Corp",
            "id": "3652397000009851001"
          }
        ],
        "info": {
          "per_page": 5,
          "count": 1,
          "page": 1,
          "more_records": false
        }
      },
      "message": "success",
      "status": "200",
      "reference_id": "get_leads"
    },
    {
      "code": "SUCCESS",
      "details": {
        "data": [
          {
            "code": "SUCCESS",
            "details": {
              "id": "3652397000012345678",
              "Created_Time": "2024-10-13T16:30:00-07:00"
            },
            "message": "record added",
            "status": "success"
          }
        ]
      },
      "message": "success",
      "status": "200",
      "reference_id": "create_contact"
    },
    {
      "code": "SUCCESS",
      "details": {
        "data": [
          {
            "code": "SUCCESS",
            "details": {
              "id": "3652397000009851001",
              "Modified_Time": "2024-10-13T16:30:01-07:00"
            },
            "message": "record updated",
            "status": "success"
          }
        ]
      },
      "message": "success",
      "status": "200",
      "reference_id": "update_deal"
    },
    {
      "code": "SUCCESS",
      "details": {
        "data": [
          {
            "Last_Name": "Davis",
            "Email": "edavis@example.com",
            "id": "3652397000011111111"
          }
        ],
        "info": {
          "count": 1,
          "more_records": false
        }
      },
      "message": "success",
      "status": "200",
      "reference_id": "query_contacts"
    }
  ]
}
```

## Summary

The Zoho CRM Developer API v8 serves as a complete integration platform for building sophisticated CRM-connected applications and automating business processes. Primary use cases include bidirectional data synchronization between Zoho CRM and external systems, automated lead capture and routing from websites and marketing platforms, custom reporting dashboards pulling real-time CRM data, mobile applications for field sales teams, and integration with accounting, support desk, and marketing automation platforms. The API's bulk operations support large-scale data migrations and nightly synchronization jobs, while COQL enables complex analytical queries without compromising performance.

Integration patterns typically involve OAuth 2.0 authentication for server-to-server communication, webhook subscriptions for real-time event notifications, bulk read/write operations for scheduled data transfers, and composite API calls for transactional workflows requiring multiple operations. The API's consistent REST architecture, comprehensive error handling, and extensive metadata capabilities make it suitable for both simple integrations and enterprise-grade solutions. With support for custom modules, fields, and business logic through blueprints and workflows, developers can build integrations that adapt to any organization's unique CRM configuration while maintaining robust security through granular OAuth scopes and field-level permissions.

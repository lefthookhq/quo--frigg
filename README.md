# Quo Integrations Framework

> A comprehensive integration platform that synchronizes data between Quo CRM and various third-party services including AxisCare, Attio, PipeDrive, and Zoho CRM.

## 📋 Prerequisites

- Docker
- Node.js 18+
- Access to Quo API
- API credentials for integrated services:
  - AxisCare API
  - Attio CRM API
  - PipeDrive CRM API
  - Zoho CRM API

## 🚀 Quick Start

### Setting up the Environment

1. Clone this repository
2. Configure environment variables:
   ```bash
   cd backend
   cp .env.example .env
   ```
3. Add your API credentials to the `.env` file

### Running the Project

Start the MongoDB database and LocalStack:
```bash
npm run docker:start
```

Launch the backend service:
```bash
npm run frigg:start
```

## 🔧 Integration Capabilities

This project provides integrations for the following platforms:

### 1. **ScalingTest Integration**
- **Purpose**: Performance testing with Quo API and Frigg Scale Test API
- **Features**:
  - Concurrent request testing
  - Contact data synchronization
  - Performance metrics reporting
  - Scalability analysis

### 2. **AxisCare Integration**
- **Purpose**: Home care management platform integration
- **Features**:
  - Client synchronization
  - Appointment management
  - Service tracking
  - Healthcare analytics

### 3. **Attio Integration**
- **Purpose**: Modern CRM platform integration
- **Features**:
  - Custom object management
  - Company and person synchronization
  - Record creation and search
  - Advanced CRM workflows

### 4. **PipeDrive Integration**
- **Purpose**: Pipeline management platform integration
- **Features**:
  - Deal synchronization
  - Person and organization management
  - Activity tracking
  - Sales analytics

### 5. **Zoho CRM Integration**
- **Purpose**: Zoho CRM platform integration
- **Features**:
  - Lead management
  - Contact synchronization
  - Deal tracking
  - Module exploration

## 🛠️ Integration Workflows

### Data Synchronization

Each integration supports:
- **Bidirectional Sync**: Keep data consistent between Quo and external services
- **Selective Sync**: Choose specific record types and filters
- **Conflict Resolution**: Handle data conflicts intelligently
- **Real-time Updates**: Webhook-based updates for immediate synchronization

### Performance Testing

The ScalingTest integration allows:
- **Load Testing**: Test API performance under various loads
- **Concurrent Processing**: Simulate multiple simultaneous operations
- **Metrics Collection**: Gather performance data and statistics
- **Scalability Analysis**: Identify bottlenecks and optimization opportunities

### Healthcare Management (AxisCare)

Specialized features for healthcare workflows:
- **Patient Scheduling**: Sync appointments and scheduling data
- **Care Management**: Track care plans and service delivery
- **Compliance Reporting**: Generate healthcare compliance reports
- **Staff Coordination**: Manage caregiver assignments and schedules

## 🧪 Using the Integrations

### Setting Up Workflows

1. **Navigate to Integrations** in your Frigg dashboard
2. **Add Desired Integration** (AxisCare, Attio, PipeDrive, or Zoho CRM)
3. **Configure Authentication** for both Quo and the external service
4. **Set Sync Schedules** for automatic data synchronization
5. **Define Sync Rules** for data mapping and transformation
6. **Test Integration** with sample data

### Available Actions

Each integration provides:
- **Data Synchronization**: Sync contacts, deals, appointments
- **Search Operations**: Find records across connected systems
- **Creation Workflows**: Create new records in connected systems
- **Analytics & Reporting**: Generate insights and performance metrics
- **Testing Tools**: Validate connections and test functionality

## 🔐 Security Features

### API Key Authentication

All integrations use secure API key authentication:
- **Encrypted Storage**: API keys are encrypted at rest using KMS field-level encryption
- **Bearer Token Auth**: Uses `Authorization: Bearer <api_key>` headers
- **Secure Forms**: API keys collected through secure forms in the Frigg UI
- **No Plain Text**: Never log or expose API keys

### Field-Level Encryption with KMS

API credentials are automatically encrypted:
```javascript
encryption: {
  useDefaultKMSForFieldLevelEncryption: true
}
```

Frigg automatically handles:
- **API Key Encryption**: All API keys encrypted at rest
- **KMS Integration**: Automatic KMS key management
- **Transparent Decryption**: Seamless credential access
- **Cost Optimization**: Uses AWS default KMS keys

## 🚀 Deployment

To deploy your integrations to AWS:

```bash
cd backend
AWS_PROFILE=your-aws-profile npx serverless deploy --config infrastructure.js --stage prod --verbose
```

### Environment Variables

Ensure these environment variables are set in your deployment environment:

```bash
# Quo API
QUO_API_KEY=your_production_quo_key
QUO_BASE_URL=https://api.quo.com

# AxisCare API
AXISCARE_API_KEY=your_axiscare_key
AXISCARE_BASE_URL=https://static.axiscare.com/api

# Attio API
ATTIO_CLIENT_ID=your_attio_client_id
ATTIO_CLIENT_SECRET=your_attio_client_secret

# PipeDrive API
PIPEDRIVE_API_KEY=your_pipedrive_key

# Zoho CRM API
ZOHO_CLIENT_ID=your_zoho_client_id
ZOHO_CLIENT_SECRET=your_zoho_client_secret

# Scale Test API
SCALE_TEST_API_KEY=your_scale_test_key
```

## 📊 Monitoring and Analytics

### Performance Metrics
- API response times
- Sync success rates
- Error tracking
- Usage statistics

### Business Intelligence
- Cross-platform analytics
- Data consistency reports
- Integration health monitoring
- Cost analysis

## 📝 Development

### Project Structure

- `backend/` - Integration backend service
  - `src/integrations/` - Integration logic and workflows
  - `src/api-modules/` - API modules for external services
  - `src/services/` - Business logic and data processing
  - `test/` - Integration and unit tests

### Adding New Integrations

When creating new integrations:

1. **Create API Module**: Implement API wrapper in `src/api-modules/`
2. **Create Integration Class**: Implement integration logic in `src/integration/`
3. **Add Routes**: Define API routes in the integration definition
4. **Implement Handlers**: Create event handlers for data operations
5. **Add Tests**: Create comprehensive tests for new functionality
6. **Update Documentation**: Add integration to this README

## 🧪 Testing

Run integration tests:

```bash
# Run all tests
npm test

# Run specific integration tests
npm test -- --testPathPattern AxisCareIntegration

# Run performance tests
npm test -- --testPathPattern ScalingTest

# Run with coverage
npm run test:coverage
```

## 📄 License

This project is licensed under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📞 Support

For support with Quo integrations:
- Check the [documentation](https://github.com/your-org/quo-integrations-frigg/wiki)
- Create an issue for bugs or feature requests
- Contact the development team for enterprise support
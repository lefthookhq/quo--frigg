#!/bin/bash

# Purge all local SQS queues in LocalStack
echo "Purging local SQS queues..."

aws --endpoint-url=http://localhost:4566 sqs purge-queue --queue-url "http://localhost.localstack.cloud:4566/000000000000/quo-integrations--dev-ZohoQueue" && \
aws --endpoint-url=http://localhost:4566 sqs purge-queue --queue-url "http://localhost.localstack.cloud:4566/000000000000/quo-integrations--dev-ScalingtestQueue" && \
aws --endpoint-url=http://localhost:4566 sqs purge-queue --queue-url "http://localhost.localstack.cloud:4566/000000000000/quo-integrations--dev-AttioQueue" && \
aws --endpoint-url=http://localhost:4566 sqs purge-queue --queue-url "http://localhost.localstack.cloud:4566/000000000000/quo-integrations--dev-AxisCareQueue" && \
aws --endpoint-url=http://localhost:4566 sqs purge-queue --queue-url "http://localhost.localstack.cloud:4566/000000000000/quo-integrations--dev-PipedriveQueue" && \
aws --endpoint-url=http://localhost:4566 sqs purge-queue --queue-url "http://localhost.localstack.cloud:4566/000000000000/quo-integrations--dev-ClioQueue" && \
aws --endpoint-url=http://localhost:4566 sqs purge-queue --queue-url "http://localhost.localstack.cloud:4566/000000000000/freshbooks-frigg--dev-HubspotSyncContactQueueWorker" && \
aws --endpoint-url=http://localhost:4566 sqs purge-queue --queue-url "http://localhost.localstack.cloud:4566/000000000000/freshbooks-frigg--dev-GenericQueueWorker" && \
aws --endpoint-url=http://localhost:4566 sqs purge-queue --queue-url "http://localhost.localstack.cloud:4566/000000000000/freshbooks-frigg--dev-SquareTokenRefresherQueue"

echo "✓ All queues purged successfully"

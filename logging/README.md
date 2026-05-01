# Logging Configuration

This directory contains logging configuration files for the FheForge Reineira/Privara integration.

## Overview

Logging is configured using:

- **Loki** - Log aggregation
- **Promtail** - Log agent for collecting logs
- **Winston** - Backend logging (NestJS)
- **Pino** - Alternative backend logging
- **Console** - Frontend logging (Next.js)

## Configuration Files

### Loki Configuration

**File:** `loki-config.yml`

Loki configuration for log aggregation and storage.

### Promtail Configuration

**File:** `promtail-config.yml`

Promtail configuration for collecting logs from:

- Backend application logs
- Frontend application logs
- System logs
- Docker container logs

### Backend Logging

**Directory:** `backend/`

Backend logging configuration using Winston:

- Console transport
- File transport
- Loki transport

### Frontend Logging

**Directory:** `frontend/`

Frontend logging configuration:

- Console logging
- Error tracking (Sentry)
- Analytics

## Quick Start

### Using Docker Compose

```bash
# Start logging stack
docker-compose up -d loki promtail

# Access Loki
open http://localhost:3100

# View logs in Grafana
open http://localhost:3000
```

### Manual Setup

1. **Configure Loki**

   ```bash
   # Copy configuration
   cp loki-config.yml /etc/loki/local-config.yaml

   # Start Loki
   loki -config.file=/etc/loki/local-config.yaml
   ```

2. **Configure Promtail**

   ```bash
   # Copy configuration
   cp promtail-config.yml /etc/promtail/config.yml

   # Start Promtail
   promtail -config.file=/etc/promtail/config.yml
   ```

3. **Configure Application Logging**
   - Update backend logging configuration
   - Update frontend logging configuration
   - Restart applications

## Log Levels

### Backend Log Levels

- **error** - Error messages
- **warn** - Warning messages
- **log** - General information
- **debug** - Debug information
- **verbose** - Verbose information

### Frontend Log Levels

- **error** - Error messages
- **warn** - Warning messages
- **info** - General information
- **debug** - Debug information

## Log Formats

### Structured Logging

Logs are structured in JSON format for easy parsing:

```json
{
  "timestamp": "2025-04-24T12:00:00Z",
  "level": "info",
  "context": "PrivaraService",
  "message": "Deposit created successfully",
  "data": {
    "transactionId": "123",
    "strategyId": "456",
    "amount": "1000000000000000000"
  }
}
```

### Log Fields

- **timestamp** - Log timestamp
- **level** - Log level
- **context** - Service/component
- **message** - Log message
- **data** - Additional data (optional)

## Log Retention

- **Development** - 7 days
- **Staging** - 30 days
- **Production** - 90 days

## Log Queries

### Query Examples

```logql
# Query all error logs
{level="error"}

# Query backend logs
{job="backend-api"}

# Query logs from specific service
{service="privara"}

# Query logs with specific message
{message=~".*deposit.*"}

# Query logs in time range
{level="error"} | line_format "{{.timestamp}} {{.message}}"
```

## Log Analysis

### Common Queries

**Error Rate:**

```logql
sum(rate({level="error"}[5m]))
```

**Request Rate:**

```logql
sum(rate({job="backend-api"}[5m]))
```

**Slow Requests:**

```logql
{duration_ms>1000}
```

## Troubleshooting

### Logs Not Appearing in Loki

**Solution:**

- Check Promtail is running
- Verify Promtail configuration
- Check network connectivity
- Review Promtail logs

### Logs Not Structured

**Solution:**

- Verify logging configuration
- Check log format
- Ensure JSON serialization

### High Log Volume

**Solution:**

- Adjust log levels
- Implement log sampling
- Add log filters
- Review log retention

---

**Version:** 1.0.0
**Last Updated:** 2025-04-24

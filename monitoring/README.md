# Monitoring Configuration

This directory contains monitoring configuration files for the FheForge Reineira/Privara integration.

## Overview

Monitoring is configured using a combination of:

- **Prometheus** - Metrics collection
- **Grafana** - Dashboards and visualization
- **Loki** - Log aggregation
- **Alertmanager** - Alert management

## Configuration Files

### Prometheus Configuration

**File:** `prometheus.yml`

Prometheus configuration for scraping metrics from:

- Backend API (NestJS)
- Frontend (Next.js)
- Smart Contracts (via RPC)
- Database (Supabase)

### Grafana Dashboards

**Directory:** `grafana/dashboards/`

Pre-configured Grafana dashboards for:

- API Performance
- Database Performance
- Contract Interactions
- System Health

### Alertmanager Configuration

**File:** `alertmanager.yml`

Alert routing and notification configuration for:

- API errors
- Database connection failures
- Contract deployment failures
- High gas prices

## Quick Start

### Using Docker Compose

```bash
# Start monitoring stack
docker-compose up -d

# Access Grafana
open http://localhost:3000

# Access Prometheus
open http://localhost:9090
```

### Manual Setup

1. **Configure Prometheus**

   ```bash
   # Copy configuration
   cp prometheus.yml /etc/prometheus/

   # Restart Prometheus
   systemctl restart prometheus
   ```

2. **Configure Grafana**

   ```bash
   # Import dashboards
   grafana-cli dashboards import grafana/dashboards/
   ```

3. **Configure Alertmanager**

   ```bash
   # Copy configuration
   cp alertmanager.yml /etc/alertmanager/

   # Restart Alertmanager
   systemctl restart alertmanager
   ```

## Metrics

### Backend Metrics

- `http_requests_total` - Total HTTP requests
- `http_request_duration_seconds` - Request duration
- `database_query_duration_seconds` - Database query duration
- `contract_interaction_duration_seconds` - Contract interaction duration
- `active_users` - Number of active users

### Frontend Metrics

- `page_views_total` - Total page views
- `user_sessions_total` - Total user sessions
- `wallet_connection_duration_seconds` - Wallet connection duration
- `contract_interaction_duration_seconds` - Contract interaction duration

### Contract Metrics

- `contract_deployment_total` - Total contract deployments
- `contract_interaction_total` - Total contract interactions
- `gas_used_total` - Total gas used
- `transaction_duration_seconds` - Transaction duration

### Database Metrics

- `database_connections_active` - Active database connections
- `database_query_duration_seconds` - Query duration
- `database_errors_total` - Total database errors

## Alerts

### Critical Alerts

- **API Error Rate > 5%** - API experiencing high error rate
- **Database Connection Failed** - Cannot connect to database
- **Contract Deployment Failed** - Contract deployment failed
- **Gas Price > 100 gwei** - Gas price too high

### Warning Alerts

- **API Response Time > 1s** - API response time is slow
- **Database Query Time > 500ms** - Database query is slow
- **Disk Usage > 80%** - Disk space is low
- **Memory Usage > 80%** - Memory usage is high

### Info Alerts

- **New User Sign-up** - New user registered
- **Contract Deployed** - Contract deployed successfully
- **High Transaction Volume** - High transaction volume detected

## Dashboards

### API Performance Dashboard

Metrics:

- Request rate
- Error rate
- Response time (p50, p95, p99)
- Active connections

### Database Performance Dashboard

Metrics:

- Query duration
- Connection pool usage
- Slow queries
- Database size

### Contract Interactions Dashboard

Metrics:

- Transaction rate
- Gas usage
- Success rate
- Contract balance

### System Health Dashboard

Metrics:

- CPU usage
- Memory usage
- Disk usage
- Network traffic

## Maintenance

### Update Dashboards

1. Edit dashboard JSON files in `grafana/dashboards/`
2. Import updated dashboards in Grafana
3. Test dashboards

### Update Alerts

1. Edit `alertmanager.yml`
2. Reload Alertmanager configuration
3. Test alerts

### Update Metrics

1. Add new metrics to application code
2. Update Prometheus configuration
3. Reload Prometheus configuration

## Troubleshooting

### Prometheus Not Scraping

**Solution:**

- Check Prometheus configuration
- Verify targets are accessible
- Check network connectivity

### Grafana Not Showing Data

**Solution:**

- Verify Prometheus data source is configured
- Check time range
- Verify queries are correct

### Alerts Not Firing

**Solution:**

- Check Alertmanager configuration
- Verify alert rules are correct
- Check notification channels

---

**Version:** 1.0.0
**Last Updated:** 2025-04-24

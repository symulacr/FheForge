# Monitoring Infrastructure Notes

## MC-065: Railway Internal Network
Railway's deploy config supports `"internal": true` which restricts access to the
Railway internal network only. However, this is a per-service setting — it would
block ALL public traffic, including the frontend's API calls and healthchecks.

**If internal-only `/metrics` is desired**, two options:
1. Deploy a separate backend instance as internal-only for metrics scraping
2. Add Express middleware to reject non-Railway-internal requests to `/metrics`

Neither is implemented yet. The current setup leaves `/metrics` public but
unadvertised. Documented here for future security hardening.

## TLS Gap (MC-067)

The local Docker monitoring stack (Prometheus :9090, Grafana :3000, Alertmanager :9093)
uses plain HTTP with no TLS termination.

**Acceptable for:** local development, CI, internal network.

**For production (Railway or public-facing):**
- Place all monitoring services behind a reverse proxy (nginx / Caddy / Railway's built-in TLS)
- Prometheus and Alertmanager should use `--web.config-file` with TLS cert + basic auth
- Grafana has built-in TLS support via `GF_SERVER_PROTOCOL=https` and `GF_SERVER_CERT_FILE`/`GF_SERVER_KEY_FILE`
- Alternatively: use Grafana Cloud or Railway's internal networking for metrics ingestion

## Prometheus Scrape Targets

Current `prometheus.yml` hardcodes Docker service names (`backend:3001`, `frontend:3000`).
These are NOT resolvable on Railway.

**For Railway deployment:**
- Use Railway's built-in metrics (CPU/memory/disk available in dashboard)
- OR deploy a separate VPS with Prometheus scraping Railway public endpoints
- OR use Grafana Cloud with Prometheus remote-write from Railway

## Grafana Dashboards

Provisioning directory (`monitoring/grafana/`) is created by MC-060.
Dashboards require MC-024 (backend `/metrics` endpoint) to have data.

## Alert Rules

See `monitoring/alerts/alerts.yml`. MC-061 removed 11 rules that referenced
non-existent metrics. The 3 remaining system rules require `node_exporter`
running on the Docker host. MC-062 will restore API alert rules once
MC-024 is deployed and metric names are confirmed.

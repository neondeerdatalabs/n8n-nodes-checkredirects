# n8n-nodes-checkredirects

n8n community node for the [Checkredirects.io](https://checkredirects.io) API -- inspect URLs, check redirect chains, run batch audits, and monitor URLs for changes over time.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Security updates](#security-updates)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Configuration](#configuration)
- [Usage](#usage)
- [Nodes](#nodes)
- [Troubleshooting](#troubleshooting)
- [Testing](#testing)

## Prerequisites

- **n8n** running Node.js **22.23.4 or newer within 22.x**, or **24.22.1 or newer within 24.x**
- A **Checkredirects.io** account with an API key ([sign up](https://checkredirects.io) / [create API key](https://checkredirects.io/settings/api-keys))

## Security updates

The [October 2026 runtime advisory](https://render.com/docs/advisory-emudhra)
requires updating Node.js and the certificate store used by your n8n server.
Updating this community node does not update the host runtime.

- **Docker:** rebuild or pull an updated n8n image, then recreate the container.
  Restarting the old container keeps its old runtime and certificates.
- **npm-based hosting:** update the Node.js installation used by the n8n service,
  refresh system certificates, then restart the service.
- **Managed hosting:** have your provider confirm the runtime is patched.

Verify from an n8n HTTP Request node with certificate verification enabled:

- `https://dv-g3b-emudhra.we-have-a-problem.com/` must fail certificate verification.
- `https://dv-g3b-aaa-emudhra.we-have-a-problem.com/` must fail certificate verification.
- `https://example.com/` must succeed.

A timeout or DNS error does not demonstrate certificate rejection.

## Installation

### In n8n (community node)

1. Open **Settings > Community Nodes** in your n8n instance
2. Select **Install**
3. Enter `n8n-nodes-checkredirects`
4. Agree to the risks and click **Install**

### Manual install (self-hosted)

```bash
cd ~/.n8n
npm install n8n-nodes-checkredirects
```

Restart n8n after installation.

## Quick Start

1. Install the node (see above)
2. Create a new workflow in n8n
3. Add the **Checkredirects.io** node
4. Create credentials: paste your API key (starts with `httpd_`) from [Settings > API Keys](https://checkredirects.io/settings/api-keys)
5. Set Resource to **URL Inspection**, Operation to **Inspect URL**
6. Enter a URL and execute -- you'll get the full redirect chain, status codes, and timing

## Architecture Overview

This package provides three n8n nodes and one credential type:

```
n8n-nodes-checkredirects/
  credentials/
    CheckredirectsApi.credentials.ts   -- API key + base URL credential
  nodes/Checkredirects/
    Checkredirects.node.ts             -- Main action node (inspect, batch, monitor, account)
    CheckredirectsTrigger.node.ts      -- Webhook trigger (batch/monitor events)
    CheckredirectsPollTrigger.node.ts  -- Polling trigger (monitor runs)
    Checkredirects.node.json           -- Codex metadata (categories, aliases)
    checkredirects.svg                 -- Node icon
  index.ts                             -- Package entry point (re-exports all nodes)
```

All nodes communicate with the [Checkredirects.io API](https://checkredirects.io/docs) via REST. No external runtime dependencies.

## Configuration

### Credentials

| Field    | Description                                           |
| -------- | ----------------------------------------------------- |
| API Key  | Your Checkredirects.io API key (starts with `httpd_`) |
| Base URL | `https://api.checkredirects.io` (default)             |

Create an API key at [checkredirects.io/settings/api-keys](https://checkredirects.io/settings/api-keys).

UPDATE: If Checkredirects.io changes their API base URL, update the default in `credentials/CheckredirectsApi.credentials.ts` field `baseUrl`.

## Usage

### Inspect a single URL

Set Resource = **URL Inspection**, Operation = **Inspect URL**. Returns the full redirect chain with status codes, response times, and optionally SEO metadata (title, canonical, OG tags).

### Batch check many URLs

Set Resource = **Batch**, Operation = **Check and Wait**. Paste one URL per line. The node submits the batch and polls until results are ready (up to 5 minutes). For larger batches, use **Create Batch** + **Get Results** separately.

### Monitor URLs over time

Set Resource = **Monitor**, Operation = **Create**. Define a name, URLs, and check interval. The Checkredirects.io API will re-check those URLs on schedule.

Use the **Poll Trigger** or **Webhook Trigger** node to start workflows when a monitor run completes or detects changes.

### Example: Alert on redirect changes

1. **Checkredirects.io Poll Trigger** -- watches a monitor for new runs
2. **IF node** -- filter for runs where `has_changes` is true
3. **Slack node** -- post a message with the change details

## Nodes

### Checkredirects.io (Action Node)

| Resource       | Operations                                                            |
| -------------- | --------------------------------------------------------------------- |
| URL Inspection | Inspect URL, Compare Agents, Import Sitemap                          |
| Batch          | Check and Wait, Create Batch, Get Results, Get Progress, Compare      |
| Monitor        | Create, List, Get, Update, Delete, Pause, Resume, Trigger, Get Runs   |
| Account        | Get Usage                                                             |

### Checkredirects.io Trigger (Webhook)

Fires when the Checkredirects.io API sends a webhook for:
- Batch completed
- Monitor completed
- Monitor change detected

Copy the webhook URL from n8n and paste it into your batch/monitor configuration at checkredirects.io.

### Checkredirects.io Poll Trigger

Polls a specific monitor for new runs on the n8n polling schedule. No webhook configuration needed.

## Troubleshooting

| Error | Cause | Fix |
| ----- | ----- | --- |
| "Invalid API key" | Wrong or expired API key | Re-create at [Settings > API Keys](https://checkredirects.io/settings/api-keys) |
| "Monthly check limit exceeded" | Plan quota reached | Check usage at [Settings > Billing](https://checkredirects.io/settings/billing) |
| "This feature requires a paid plan" | Free tier limitation | Upgrade at [checkredirects.io/settings/billing](https://checkredirects.io/settings/billing) |
| "Service unavailable" (503) | Google Sheets not connected | Connect at [Settings > Integrations](https://checkredirects.io/settings/integrations) |
| Batch timed out after 5 min | Large batch still processing | Use "Create Batch" + "Get Results" separately |
| Missing node icon | Old build without assets | Run `npm run build` (copies SVG to dist) |

## Testing

### Build locally

```bash
git clone https://github.com/neondeerdatalabs/n8n-nodes-checkredirects.git
cd n8n-nodes-checkredirects
npm install
npm run build
```

### Lint (n8n community node scanner)

```bash
npm run lint
```

### Test in a local n8n instance

```bash
# From the node package directory
npm link

# From your n8n installation
cd ~/.n8n
npm link n8n-nodes-checkredirects

# Restart n8n -- the node should appear in the nodes panel
```

---

Built by [Neon Deer Data Labs](https://checkredirects.io). Full API documentation at [checkredirects.io/docs](https://checkredirects.io/docs).

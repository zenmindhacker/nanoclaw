---
name: xero
description: Xero accounting API integration and workflow automation
metadata: {"clawdis":{"emoji":"💰"}}
---

# Xero

Xero accounting API integration for Cognitive Technology Consulting Inc.

## Structure

- `scripts/` - API test scripts and utilities
- `src/` - Workflow automation source code

## Scripts

Located in `{baseDir}/scripts/`:

- `test-api.mjs` - Test Xero API connection
- `xero-test.cjs` - CJS API tester
- `xero-test.mjs` - ESM API tester
- `README.md` - Setup and usage documentation

## Workflows

Located in `{baseDir}/src/`:

Xero workflow automation (TypeScript)

## Setup

See `{baseDir}/scripts/README.md` for API credentials and configuration.

## Usage

```bash
# Test API connection
node {baseDir}/scripts/test-api.mjs

# Run workflows
cd {baseDir}
npm install
npm run <workflow-command>
```

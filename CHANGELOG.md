# Changelog

## 0.1.0

First release.

- **Datta CRM API** credential (API key and base URL) with a connection test.
- **Datta CRM** node with these resources:
  - Lead: Create or Update, Get, Get Many, Update, Move to Stage, Add Tags, Remove Tags, Add to Lists, Remove From Lists.
  - List: Create, Get Many.
  - Sale: Create or Update, Get, Get Many, Update.
  - Form: Create, Get, Get Many, Update, Activate, Deactivate.
  - Email Campaign: Create Draft, Get, Get Many, Update Draft.
- **Datta CRM Trigger** node: signed webhooks with event selection, filters and "Ignore Changes Made by This API Key".

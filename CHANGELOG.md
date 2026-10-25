# Changelog

## 0.2.0

Follows the new organisation of leads in Datta CRM: origin → folder → list, with no default list.

- **List → Create** has **Folder** and **Origin**. Without a folder, the CRM uses the only folder of the origin (Site by default) and returns `folder_required` when the origin has no folder or several. Workflows saved with 0.1.x keep sending only the name, with the Site origin.
- New **Folder → Get Many** resource (`GET /folders`).
- **Lead → Create or Update**: **List Names or IDs** moved out of Additional Fields and is shown next to email and phone, with the rule that a new lead needs a list unless the API key has one (`list_required`). Lists saved in Additional Fields by 0.1.x workflows are still sent. **Source** is marked as ignored by the CRM.
- List dropdowns show "folder / list". Folder dropdowns show "origin / folder".

## 0.1.1

- Published through npm trusted publishing (OIDC) from GitHub Actions, with provenance.
- The package no longer ships the TypeScript build cache (`dist/tsconfig.tsbuildinfo`).
- No changes to the nodes or the credential.

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

# Changelog

## 0.3.0

Follows the funnel per list of Datta CRM: the stage, the value and the loss reason of a lead belong to each list, and there are no more pipelines or stage probabilities. Needs the Datta CRM version with the funnel per list.

- New **Lead → Update in List** (`PATCH /leads/{id}/lists/{listId}`): stage, value and loss reason of the lead in one list.
- New **List → Get Stages**: the funnel stages of one list. List (Get Many) also returns `hasFunnel` and `stages`.
- New **Loss Reason → Get Many** resource (`GET /loss-reasons`).
- Stage dropdowns come from the lists ("folder / list / stage"); in Update in List they show only the stages of the chosen list.
- **Datta CRM Trigger**: the **Pipeline** filter is replaced by **List**. Stage filters list the stages of every list with a funnel.

Breaking changes:

- **Lead → Move to Stage** is removed: use **Update in List**. A workflow saved with it fails with a message pointing to the new operation.
- **Lead → Create or Update** no longer has Pipeline, Stage and Value, and **Lead → Update** no longer has Value and Loss Reason. Values saved in these fields by 0.2.x workflows are not sent anymore (the CRM would answer `field_moved`); add an Update in List step to set them.
- **Lead → Get Many** no longer has the Pipeline filter. The Stage filter returns leads with that stage in any list.
- **Form → Create** no longer has Funnel Stage: the CRM ignores it, since forms do not put leads in a funnel.
- Trigger filters by pipeline saved by 0.2.x workflows are not sent.
- The lead output has no `pipelineId`, `stageId` or `value`: they are inside each item of `lists`.

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

# Changelog

## 0.6.0

Creates custom fields from n8n, so a new form field does not need a trip to the CRM first. Needs the Datta CRM version with `POST /custom-fields` (`create_custom_field`): older versions return 404. The credential does not change (API Key and Base URL).

- New **Custom Field** resource: **Create** (`POST /custom-fields`: Name, Type, Options for select types and an optional Key derived from the name) and **Get Many** (`GET /custom-fields`). Create is idempotent by key: an existing field with the same key and type is returned unchanged (`result: matched`); another type returns `conflict`.
- **Lead → Create or Update** has a new **Create Missing Custom Fields** option in Additional Fields, off by default: before sending the lead, it creates as text the keys of Custom Fields that do not exist in the account yet, once per execution.

## 0.5.0

Follows the click tracking of `POST /leads` in Datta CRM. Needs the Datta CRM version with `utm.id` and `tracking` in `POST /leads`: older versions accept the request but drop these fields. The credential does not change (API Key and Base URL).

- **Lead → Create or Update** has a new **Tracking** collection in Additional Fields: **Facebook Click ID** (`fbclid`), **Google Click ID** (`gclid`), **TikTok Click ID** (`ttclid`), **Click to WhatsApp Click ID** (`ctwa_clid`), **Ad Source ID** (`source_id`), **Page URL** and **Referrer**. They go to the lead and to the capture in its journey. Only filled fields are sent, trimmed.
- The **UTM** collection has a new **ID** field (`utm_id`).

## 0.4.0

Follows the lead capture of Datta CRM: every accepted delivery of **Lead → Create or Update** records a capture in the lead's journey. Needs the Datta CRM version with `occurredAt` and `eventId` in `POST /leads`. The credential does not change (API Key and Base URL).

- **Lead → Create or Update** has two new optional fields in Additional Fields: **Captured At** (`occurredAt`: when the lead was captured in the source tool; without it the time of arrival is used, and more than 5 minutes in the future returns 400) and **Event ID** (`eventId`: ID of the delivery in the source tool, 1 to 200 characters, so a resend does not record another capture). A Captured At without a time zone is read in the workflow time zone and sent as ISO 8601.
- The lists (**List Names or IDs**) and tags always come from the node: the description no longer mentions a list set in the API key.

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

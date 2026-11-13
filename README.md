# n8n-nodes-datta-crm

n8n community nodes for [Datta CRM](https://dattacrm.com.br). They wrap the Datta CRM public REST API (`/api/v1`) so you can manage leads, sales, forms and email drafts from a workflow, and start workflows from CRM events.

The package contains:

- **Datta CRM API** credential
- **Datta CRM** node: actions for leads, lists, list folders, custom fields, sales, forms and email campaign drafts
- **Datta CRM Trigger** node: starts a workflow when events happen in the CRM (signed webhooks)

Guide: <https://ajuda.dattacrm.com.br/integracoes/api/n8n/>
API reference: <https://dattacrm.com.br/api/v1/openapi.json>

## Installation

In n8n: **Settings → Community Nodes → Install**, then enter `n8n-nodes-datta-crm`.

For a self-hosted instance you can also install it manually:

```sh
cd ~/.n8n/nodes
npm install n8n-nodes-datta-crm
```

Restart n8n afterwards. See the [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/installation/) for details.

## Credentials

1. In Datta CRM, open **Integrations → API** and create an API key. Each key belongs to one account. Keys can expire. Revoking a key (or letting it expire) also stops the webhooks that were created with it.
2. In n8n, create a **Datta CRM API** credential:

| Field    | Description                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------- |
| API Key  | The key you created.                                                                                 |
| Base URL | Defaults to `https://dattacrm.com.br`. Only change it if you were given a different address. |

The credential test calls `GET /api/v1/me`.

## Datta CRM node

| Resource       | Operations                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Lead           | Create or Update, Get, Get Many, Update, Update in List, Add Tags, Remove Tags, Add to Lists, Remove From Lists |
| List           | Create, Get Many, Get Stages                                                                                    |
| Folder         | Get Many                                                                                                        |
| Custom Field   | Create, Get Many                                                                                                |
| Loss Reason    | Get Many                                                                                                        |
| Sale           | Create or Update, Get, Get Many, Update                                                                         |
| Ad Metric      | Send                                                                                                            |
| Form           | Create, Get, Get Many, Update, Activate, Deactivate                                                             |
| Email Campaign | Create Draft, Get, Get Many, Update Draft                                                                       |

Stages (shown as "folder / list / stage", or only the stages of the chosen list), loss reasons, tags, lists (shown as "folder / list"), list folders (shown as "origin / folder"), forms, members, custom fields and webhook events are loaded from your account, so you pick them from dropdowns. You can also pass IDs with an expression.

### Behaviour notes

- **Leads are organised as origin → folder → list.** Every list lives in a folder, and the folder sets the origin of its lists (Site, WhatsApp or Instagram). There is no default list.
- **Funnel per list.** Lists of WhatsApp and Instagram have a funnel: their own stages (active, won or lost). Lists of Site have none. A lead has a stage, a value and a loss reason in each list with a funnel. List (Get Many) returns `hasFunnel` and `stages`; List (Get Stages) returns the stages of one list.
- **Update in List (Lead)** changes the stage, the value or the loss reason of a lead in one of its lists, and runs the same automations and webhooks as the board. Moving to a lost stage needs a loss reason (`loss_reason_required`). A stage of another list returns `stage_not_in_list`, a list without a funnel returns `list_has_no_funnel`, and a lead outside the list returns `not_found`.
- **Create (List)** takes a folder. The folder can be left empty only when the chosen origin (Site by default) has exactly one folder; with no folder or several, the CRM returns `folder_required`. Folder (Get Many) returns the folders of every origin.
- **Create or Update (Lead)** matches by phone, then email, and needs at least one of them. If the lead already exists, only its empty fields are filled, and tags and lists are merged. Stage and value are not set here: use Update in List. The Create Only mode returns an existing lead untouched. The result contains the lead and whether it was created or matched. A new lead needs a list: choose one in **List Names or IDs**, otherwise the CRM returns `list_required`; the list always comes from the node, never from the API key. The lead takes the origin of its first list; **Source** is ignored by the CRM. An existing lead is accepted without a list. Each accepted delivery records a capture in the lead's journey. **Captured At** (Additional Fields) sets when the lead was captured in the source tool (without it, the time of arrival is used; more than 5 minutes in the future returns 400), and **Event ID** (1 to 200 characters) is the ID of the delivery in the source tool: resending the same ID for the same lead does not record another capture. A Captured At without a time zone is read in the workflow time zone. The **Tracking** collection (Additional Fields) sends the click and page tracking of the delivery: Facebook, Google, TikTok and Click to WhatsApp click IDs, the ad source ID, the page URL and the referrer; **UTM** also has the campaign **ID** (`utm_id`). On an existing lead, a filled tracking value replaces the previous one.
- **Update (Lead)** overwrites the fields you set. You must set at least one. Add Tags, Remove Tags, Add to Lists and Remove From Lists change only that part of the lead. Tags are identified by name.
- **Custom fields** are chosen by key. Values are converted to the type the CRM defines for each field: number, yes/no (`true`/`false`, `1`/`0`, `yes`/`no`), multiple choice (comma-separated values) or text. An invalid number or yes/no value fails the item with a clear message. To use a key that is not in the dropdown yet, set **Field Name or ID** with an expression.
- **Create (Custom Field)** creates a custom field of leads: **Name**, **Type** (text, number, date, select, multi select or yes/no), **Options** for select types (comma-separated) and an optional **Key** (letters without accents, numbers and underscores, up to 40 characters, saved in lowercase; derived from the name when empty). It is idempotent by key, case-insensitively: when the key exists with the same type, the field is returned unchanged with `result: matched`; with another type, the CRM returns `conflict`. Native keys (`name`, `email`, `phone`, `company`, `address`, `notes`) are refused. Needs a read and write key.
- **Create Missing Custom Fields** (Additional Fields of Create or Update (Lead), off by default) creates as text fields, named after their keys, the keys of **Custom Fields** that do not exist in the account yet, before sending the lead. A key the CRM refuses fails the item and the lead is not sent. Rename the field or change its type later in the CRM.
- **Send (Ad Metric)** sends daily ad metrics (`POST /ad-metrics`) of one **Platform** (Meta, Google, TikTok or LinkedIn). With **Records** set to **Use Input Items**, every input item is a record already in camelCase: `date` (YYYY-MM-DD) and `adId` are required; optional are `accountId`, `accountName`, `campaignId`, `campaignName`, `adsetId`, `adsetName`, `adName`, `adStatus`, `adUrl`, `adThumbnail`, `spend`, `impressions`, `reach`, `clicks`, `pageViews`, `platformLeads`, `checkouts`, `platformPurchases`, `platformRevenue`, `messagingStarted`, `currency` and `extra` (an object). With **JSON**, write the list of records in the node. The records go in batches of up to 500 (**Batch Size**) and the node returns one item per batch with `{ "upserted": n }`. A record of the same day and ad is updated, so a resend does not duplicate. A validation error returns the API message and tells which batch failed. Needs a read and write key.
- **Get (Lead)** can search by lead ID, email or phone. When searching by email or phone it returns the first match, or no item when nothing matches.
- **Get Many** has Return All and Limit. With Return All the node follows the API cursor until there are no more results. Lists and Folders (Get Many) are not paginated by the API.
- **Get Many (Lead)** filters: email, phone, tag, list, stage, origin, **Captured Since**, **Updated Since** and **Include Hidden**. **Captured Since** (`capturedSince`) returns leads that signed up at or after the date: every sign-up counts (form, integration, import), and a lead without a sign-up record counts by its sign-up date. **Updated Since** (`updatedSince`) returns leads changed at or after the date, so any edit or bulk update brings the lead back: use Captured Since to find new sign-ups.
- **Get Many (Sale)** filters: status, gateway, transaction ID, lead ID, **Occurred Since** and **Tags**. Occurred Since uses the sale date (`occurredAt`), not when the sale entered the CRM, and leaves out sales without a date. Tags returns sales with any of the given sale tags (comma-separated).
- **Dates** without a time zone (what date pickers give) are read in the workflow time zone (Settings → Timezone). A value with an explicit zone or offset, such as `2026-10-20T10:00:00Z`, keeps it.
- **Create or Update (Sale)** matches an existing sale by gateway and transaction ID (the gateway defaults to `api`) and updates only the fields you send. **Update (Sale)** cannot change the gateway or transaction ID. Create or Update takes **Tags** (only adds) and **Ad ID**; Update takes **Add Tags**, **Remove Tags** and **Ad ID**. Sale tags are a catalog separate from lead tags.
- **Forms**: Create takes the questions as a JSON array. Update takes a JSON object with only the fields to change. Activate and Deactivate turn the form on or off.
- **Email campaigns** are drafts only. The node never sends an email: review and schedule the draft in Datta CRM. Update Draft ignores empty values, and a campaign that is no longer a draft returns a conflict error.

## Datta CRM Trigger node

The trigger registers a webhook in your CRM account when the workflow is activated (or when you listen for a test event) and removes it when the workflow is deactivated.

- **Events**: pick one or more events. The list comes from your account.
- **Filters** (optional): list, stage, from stage, to stage, tag, form, product, origin and channel. A filter only applies to the events that support it; for example Product only affects sale events.
- **Ignore Changes Made by This API Key** (on by default): skips events caused by the credential used by the trigger. Keep it on if the workflow writes back to Datta CRM with the same credential, to avoid loops.
- **HTTPS on port 443**: Datta CRM only delivers to `https://` URLs on port 443. It also refuses private and loopback addresses. A local n8n needs a public HTTPS URL, for example through a tunnel.
- **Signature**: every delivery is signed with `x-crm-signature` (HMAC-SHA256 of the raw body). The node verifies it automatically and answers `401` to deliveries with an invalid signature, which do not start the workflow.
- **Test and production**: n8n has a separate test URL and production URL for the same node. The trigger keeps one webhook for each, so the two listeners are independent. Listening for a test event again first removes the CRM webhook left by the previous listen for that same test URL.
- **Limits**: an account can have up to 50 webhooks. Webhooks created by a key stop working when that key is revoked or expires; update the credential with a new key and reactivate the workflow.

The workflow receives the delivery body: event id, event name, timestamps, organization, actor, `data` and, when available, `previous`.

## Errors and rate limits

When the API returns an error, the node shows the CRM message (which explains how to fix it) and the error code. Validation errors list the fields that failed. Enable **Continue On Fail** on the node to handle errors in the workflow: the failed item has `error` (the message) and, when available, `description` (code, request ID and validation details).

The API allows 120 calls per minute per key. Above that it answers `429` (`rate_limited`) with a `Retry-After` header. Enable **Retry On Fail** in the node settings to retry automatically, and use Get Many instead of looping over single requests where you can.

## Development

```sh
npm install
npm run dev     # starts n8n with the nodes loaded and rebuilds on change
npm test        # unit tests (vitest)
npm run lint
npm run build
```

## Releasing

Releases are published only by GitHub Actions, never from a local machine.

Pushing a tag named `X.Y.Z` (no `v` prefix, for example `0.1.0`) runs `.github/workflows/publish.yml`. The workflow runs `npm ci --ignore-scripts` and `npm test`, then `npm run release`, which runs lint, build and `npm publish` with npm provenance.

Maintainers can start a release locally with `npm run release`. release-it runs lint and build, asks for the version bump, updates `CHANGELOG.md`, commits, tags and pushes, and creates the GitHub release. It does not publish to npm; pushing the tag is what triggers the workflow above.

## License

[MIT](LICENSE)

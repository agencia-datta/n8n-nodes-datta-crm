# n8n-nodes-datta-crm

n8n community nodes for [Datta CRM](https://crm.agenciadatta.com.br). They wrap the Datta CRM public REST API (`/api/v1`) so you can manage leads, sales, forms and email drafts from a workflow, and start workflows from CRM events.

The package contains:

- **Datta CRM API** credential
- **Datta CRM** node: actions for leads, lists, sales, forms and email campaign drafts
- **Datta CRM Trigger** node: starts a workflow when events happen in the CRM (signed webhooks)

Guide: <https://help.agenciadatta.com.br/integracoes/api/n8n/>
API reference: <https://crm.agenciadatta.com.br/api/v1/openapi.json>

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

| Field | Description |
| --- | --- |
| API Key | The key you created. |
| Base URL | Defaults to `https://crm.agenciadatta.com.br`. Only change it if you were given a different address. |

The credential test calls `GET /api/v1/me`.

## Datta CRM node

| Resource | Operations |
| --- | --- |
| Lead | Create or Update, Get, Get Many, Update, Move to Stage, Add Tags, Remove Tags, Add to Lists, Remove From Lists |
| List | Create, Get Many |
| Sale | Create or Update, Get, Get Many, Update |
| Form | Create, Get, Get Many, Update, Activate, Deactivate |
| Email Campaign | Create Draft, Get, Get Many, Update Draft |

Pipelines, stages, tags, lists, forms, members, custom fields and webhook events are loaded from your account, so you pick them from dropdowns. You can also pass IDs with an expression.

### Behaviour notes

- **Create or Update (Lead)** matches by phone, then email, and needs at least one of them. If the lead already exists, only its empty fields are filled, and tags and lists are merged. A stage is only applied when the lead is outside the pipeline or in a won/lost stage; an active stage is kept (use Move to Stage). The Create Only mode returns an existing lead untouched. The result contains the lead and whether it was created or matched.
- **Update (Lead)** overwrites the fields you set. You must set at least one. Add Tags, Remove Tags, Add to Lists, Remove From Lists and Move to Stage change only that part of the lead. Tags are identified by name.
- **Custom fields** are chosen by key. Values are converted to the type the CRM defines for each field: number, yes/no (`true`/`false`, `1`/`0`, `yes`/`no`), multiple choice (comma-separated values) or text. An invalid number or yes/no value fails the item with a clear message.
- **Get (Lead)** can search by lead ID, email or phone. When searching by email or phone it returns the first match, or no item when nothing matches.
- **Get Many** has Return All and Limit. With Return All the node follows the API cursor until there are no more results. Lists (Get Many) are not paginated by the API.
- **Create or Update (Sale)** matches an existing sale by gateway and transaction ID (the gateway defaults to `api`) and updates only the fields you send. **Update (Sale)** cannot change the gateway or transaction ID.
- **Forms**: Create takes the questions as a JSON array. Update takes a JSON object with only the fields to change. Activate and Deactivate turn the form on or off.
- **Email campaigns** are drafts only. The node never sends an email: review and schedule the draft in Datta CRM. Update Draft ignores empty values, and a campaign that is no longer a draft returns a conflict error.

## Datta CRM Trigger node

The trigger registers a webhook in your CRM account when the workflow is activated (or when you listen for a test event) and removes it when the workflow is deactivated.

- **Events**: pick one or more events. The list comes from your account.
- **Filters** (optional): pipeline, stage, from stage, to stage, tag, form, product, origin and channel. A filter only applies to the events that support it; for example Product only affects sale events.
- **Ignore Changes Made by This API Key** (on by default): skips events caused by the credential used by the trigger. Keep it on if the workflow writes back to Datta CRM with the same credential, to avoid loops.
- **HTTPS on port 443**: Datta CRM only delivers to `https://` URLs on port 443. It also refuses private and loopback addresses. A local n8n needs a public HTTPS URL, for example through a tunnel.
- **Signature**: every delivery is signed with `x-crm-signature` (HMAC-SHA256 of the raw body). The node verifies it automatically and answers `401` to deliveries with an invalid signature, which do not start the workflow.
- **Test and production**: n8n has a separate test URL and production URL for the same node. The trigger keeps one webhook for each, so the two listeners are independent.
- **Limits**: an account can have up to 50 webhooks. Webhooks created by a key stop working when that key is revoked or expires; update the credential with a new key and reactivate the workflow.

The workflow receives the delivery body: event id, event name, timestamps, organization, actor, `data` and, when available, `previous`.

## Errors and rate limits

When the API returns an error, the node shows the CRM message (which explains how to fix it) and the error code. Validation errors list the fields that failed. Enable **Continue On Fail** on the node to handle errors in the workflow.

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

Releases are published only by GitHub Actions, never from a local machine. A maintainer pushes a tag named `X.Y.Z` (no `v` prefix, for example `0.1.0`) on `main`, after the version in `package.json` and `CHANGELOG.md` are updated. The `.github/workflows/publish.yml` workflow then runs the tests, lint and build and runs `npm publish` with provenance.

## License

[MIT](LICENSE)

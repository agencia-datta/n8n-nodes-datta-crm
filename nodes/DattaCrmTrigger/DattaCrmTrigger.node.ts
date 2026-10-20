import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IHookFunctions,
	type INodeProperties,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type JsonObject,
} from 'n8n-workflow';
import {
	getAllStages,
	getEvents,
	getForms,
	getPipelines,
	getTags,
} from '../DattaCrm/shared/loadOptions';
import { dattaCrmRequest } from '../DattaCrm/shared/transport';
import { toStringArray } from '../DattaCrm/shared/utils';
import { verifySignature } from './signature';

/** Filter keys the node exposes, in the order they appear in the UI. */
const FILTER_KEYS = [
	'pipelineId',
	'stageId',
	'fromStageId',
	'toStageId',
	'tag',
	'formId',
	'productId',
	'origin',
	'channel',
] as const;

type FilterKey = (typeof FILTER_KEYS)[number];

const MAX_NAME_LENGTH = 80;

interface StoredWebhook {
	id: string;
	targetUrl: string;
	status: string;
}

/**
 * Builds the per-event `filters` object of `POST /webhooks`: the same values for every selected
 * event (the server drops what an event does not accept). Returns `{}` when no filter has values.
 */
export function buildFilters(
	events: string[],
	filters: IDataObject,
): Record<string, Record<string, string[]>> {
	const values: Record<string, string[]> = {};
	for (const key of FILTER_KEYS) {
		const list = toStringArray(filters[key]);
		if (list.length > 0) values[key] = list;
	}
	if (Object.keys(values).length === 0) return {};
	return Object.fromEntries(events.map((event) => [event, { ...values }]));
}

function listFilter(
	name: FilterKey,
	displayName: string,
	loadOptionsMethod: string,
	description: string,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod },
		default: [],
		description: `${description} Choose from the list, or specify values using an <a href="https://docs.n8n.io/code/expressions/">expression</a>`,
	};
}

function textFilter(name: FilterKey, displayName: string, description: string): INodeProperties {
	return { displayName, name, type: 'string', default: '', description };
}

function workflowWebhookName(context: IHookFunctions): string {
	const workflowName = context.getWorkflow().name;
	if (typeof workflowName !== 'string' || workflowName.trim() === '') return 'n8n';
	return `n8n · ${workflowName}`.slice(0, MAX_NAME_LENGTH).trimEnd();
}

function clearStaticData(context: IHookFunctions): void {
	const staticData = context.getWorkflowStaticData('node');
	delete staticData.webhookId;
	delete staticData.webhookSecret;
}

/** DELETE /webhooks/{id}. A 404 means it is already gone, which is the goal. */
async function deleteRemoteWebhook(context: IHookFunctions, id: string): Promise<void> {
	try {
		await dattaCrmRequest.call(context, 'DELETE', `/webhooks/${encodeURIComponent(id)}`);
	} catch (error) {
		if (error instanceof NodeApiError && error.httpCode === '404') return;
		// NodeApiError returns an existing instance unchanged, so this only satisfies the lint rule.
		throw new NodeApiError(context.getNode(), error as JsonObject);
	}
}

export class DattaCrmTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Datta CRM Trigger',
		name: 'dattaCrmTrigger',
		icon: { light: 'file:../DattaCrm/dattaCrm.svg', dark: 'file:../DattaCrm/dattaCrm.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when events happen in Datta CRM',
		defaults: {
			name: 'Datta CRM Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'dattaCrmApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Datta CRM only delivers to HTTPS URLs on port 443. Your n8n instance must be publicly reachable over HTTPS.',
				name: 'httpsNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Event Names or IDs',
				name: 'events',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getEvents' },
				required: true,
				default: [],
				description:
					'Events that start the workflow. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				description:
					'Each event only uses the filters it supports (for example Product only applies to sale events)',
				options: [
					listFilter(
						'pipelineId',
						'Pipeline Names or IDs',
						'getPipelines',
						'Only events in these pipelines.',
					),
					listFilter(
						'stageId',
						'Stage Names or IDs',
						'getAllStages',
						'Only events in these stages.',
					),
					listFilter(
						'fromStageId',
						'From Stage Names or IDs',
						'getAllStages',
						'Only stage changes that start in these stages.',
					),
					listFilter(
						'toStageId',
						'To Stage Names or IDs',
						'getAllStages',
						'Only stage changes that end in these stages.',
					),
					listFilter('tag', 'Tag Names or IDs', 'getTags', 'Only events for these tags.'),
					listFilter('formId', 'Form Names or IDs', 'getForms', 'Only events from these forms.'),
					textFilter('productId', 'Product ID', 'Only sales of these products, comma-separated'),
					textFilter('origin', 'Origin', 'Only events from these origins, comma-separated'),
					textFilter('channel', 'Channel', 'Only messages from these channels, comma-separated'),
				],
			},
			{
				displayName: 'Ignore Changes Made by This API Key',
				name: 'ignoreOwnChanges',
				type: 'boolean',
				default: true,
				description:
					'Whether to skip events caused by this credential. Recommended. Prevents loops when this workflow writes back to Datta CRM with the same credential.',
			},
		],
	};

	methods = {
		loadOptions: {
			getEvents,
			getPipelines,
			getAllStages,
			getTags,
			getForms,
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookId = this.getWorkflowStaticData('node').webhookId;
				if (typeof webhookId !== 'string' || webhookId === '') {
					clearStaticData(this);
					return false;
				}

				const webhooks = (await dattaCrmRequest.call(this, 'GET', '/webhooks')) as
					| StoredWebhook[]
					| undefined;
				const found = (webhooks ?? []).find((webhook) => webhook.id === webhookId);
				if (found === undefined || found.targetUrl !== this.getNodeWebhookUrl('default')) {
					clearStaticData(this);
					return false;
				}
				if (found.status === 'active') return true;

				// Paused or disabled: remove it so activating the workflow creates a working one.
				await deleteRemoteWebhook(this, webhookId);
				clearStaticData(this);
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const events = toStringArray(this.getNodeParameter('events', []));
				if (events.length === 0) {
					throw new NodeOperationError(this.getNode(), 'Choose at least one event', {
						description: 'The trigger needs at least one event to listen to.',
					});
				}
				const filters = buildFilters(events, this.getNodeParameter('filters', {}) as IDataObject);
				const body: IDataObject = {
					targetUrl: this.getNodeWebhookUrl('default'),
					events,
					ignoreOwnChanges: this.getNodeParameter('ignoreOwnChanges', true) as boolean,
					name: workflowWebhookName(this),
				};
				if (Object.keys(filters).length > 0) body.filters = filters;

				const created = (await dattaCrmRequest.call(this, 'POST', '/webhooks', body)) as {
					webhook: { id: string };
					secret: string;
				};
				const staticData = this.getWorkflowStaticData('node');
				staticData.webhookId = created.webhook.id;
				staticData.webhookSecret = created.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookId = this.getWorkflowStaticData('node').webhookId;
				if (typeof webhookId !== 'string' || webhookId === '') return true;
				try {
					await deleteRemoteWebhook(this, webhookId);
				} catch (error) {
					// Could not remove it remotely: keep the stored id so a later attempt can retry.
					this.logger.error('Could not delete the Datta CRM webhook', {
						message: error instanceof Error ? error.message : String(error),
					});
					return false;
				}
				clearStaticData(this);
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const secret = this.getWorkflowStaticData('node').webhookSecret;
		const rawBody = (req as { rawBody?: Buffer | string }).rawBody;

		if (
			typeof secret !== 'string' ||
			secret === '' ||
			rawBody === undefined ||
			!verifySignature(rawBody, req.headers['x-crm-signature'], secret)
		) {
			this.getResponseObject().status(401).send('Invalid signature').end();
			return { noWebhookResponse: true };
		}

		return { workflowData: [this.helpers.returnJsonArray(req.body as IDataObject)] };
	}
}

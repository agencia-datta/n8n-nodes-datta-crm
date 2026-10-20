import { type IDataObject, type IExecuteFunctions, type INodeProperties } from 'n8n-workflow';
import { dattaCrmRequest } from '../shared/transport';
import {
	compact,
	fetchMany,
	idPath,
	requireNonEmptyBody,
	requireText,
	runOperation,
	toIsoDate,
	toStringArray,
	type ResourceExecutor,
} from '../shared/utils';

const CAMPAIGN = { resource: ['emailCampaign'] };

/** Draft fields that Create Draft and Update Draft have in common, in alphabetical order. */
const draftOptions: INodeProperties[] = [
	{
		displayName: 'Desired Send At',
		name: 'desiredSendAt',
		type: 'dateTime',
		default: '',
		description:
			'Suggested send time, shown when the draft is reviewed. It does not schedule the send.',
	},
	{
		displayName: 'Exclude List Names or IDs',
		name: 'excludeListIds',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getLists' },
		default: [],
		description:
			'Leads in these lists do not receive the email. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Exclude Tag Names or IDs',
		name: 'excludeTags',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getTags' },
		default: [],
		description:
			'Leads with these tags do not receive the email. Tags are identified by name. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Include List Names or IDs',
		name: 'includeListIds',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getLists' },
		default: [],
		description:
			'Leads in these lists receive the email. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Include Tag Names or IDs',
		name: 'includeTags',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getTags' },
		default: [],
		description:
			'Leads with these tags receive the email. Tags are identified by name. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Preheader',
		name: 'preheader',
		type: 'string',
		default: '',
		description: 'Preview text shown next to the subject in the inbox (up to 250 characters)',
	},
	{
		displayName: 'Subject',
		name: 'subject',
		type: 'string',
		default: '',
		description: 'Subject of the email (up to 200 characters)',
	},
	{
		displayName: 'Text Version',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 5 },
		default: '',
		description: 'Plain text version of the email',
	},
	{
		displayName: 'UTM',
		name: 'utm',
		type: 'collection',
		placeholder: 'Add UTM Parameter',
		default: {},
		description: 'UTM parameters added to the links of the email',
		options: [
			{ displayName: 'Campaign', name: 'campaign', type: 'string', default: '' },
			{ displayName: 'Content', name: 'content', type: 'string', default: '' },
			{
				displayName: 'Enabled',
				name: 'enabled',
				type: 'boolean',
				default: true,
				description: 'Whether to add the UTM parameters to the links',
			},
			{ displayName: 'Medium', name: 'medium', type: 'string', default: '' },
			{ displayName: 'Source', name: 'source', type: 'string', default: '' },
			{ displayName: 'Term', name: 'term', type: 'string', default: '' },
		],
	},
];

const nameProperty: INodeProperties = {
	displayName: 'Name',
	name: 'name',
	type: 'string',
	default: '',
	description: 'Internal name of the campaign (up to 150 characters)',
};

const htmlProperty: INodeProperties = {
	displayName: 'HTML',
	name: 'html',
	type: 'string',
	typeOptions: { rows: 10 },
	default: '',
	description: 'HTML content of the email (up to 100,000 characters)',
};

export const emailCampaignOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: CAMPAIGN },
		options: [
			{
				name: 'Create Draft',
				value: 'createDraft',
				description: 'Creates a draft only. Review and schedule it in Datta CRM.',
				action: 'Create an email campaign draft',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get an email campaign by ID',
				action: 'Get an email campaign',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many email campaigns',
				action: 'Get many email campaigns',
			},
			{
				name: 'Update Draft',
				value: 'updateDraft',
				description:
					'Update a draft campaign. A campaign that is no longer a draft returns a conflict error.',
				action: 'Update an email campaign draft',
			},
		],
		default: 'createDraft',
	},
];

export const emailCampaignFields: INodeProperties[] = [
	// Create Draft
	{
		displayName:
			'The campaign is created as a draft and is never sent from n8n. Review and schedule it in Datta CRM.',
		name: 'createNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { ...CAMPAIGN, operation: ['createDraft'] } },
	},
	{
		...nameProperty,
		required: true,
		displayOptions: { show: { ...CAMPAIGN, operation: ['createDraft'] } },
	},
	{
		...htmlProperty,
		required: true,
		displayOptions: { show: { ...CAMPAIGN, operation: ['createDraft'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...CAMPAIGN, operation: ['createDraft'] } },
		options: draftOptions,
	},

	// Get and Update Draft
	{
		displayName: 'Campaign ID',
		name: 'campaignId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { ...CAMPAIGN, operation: ['get', 'updateDraft'] } },
		description: 'ID of the email campaign',
	},

	// Update Draft
	{
		displayName:
			'Only campaigns that are still drafts can be updated. For any other campaign the API returns a conflict error.',
		name: 'updateNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { ...CAMPAIGN, operation: ['updateDraft'] } },
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...CAMPAIGN, operation: ['updateDraft'] } },
		description: 'Fields to change. Choose at least one. Empty values are ignored.',
		options: [...draftOptions, htmlProperty, nameProperty].sort((a, b) =>
			a.displayName.localeCompare(b.displayName),
		),
	},

	// Get Many
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { ...CAMPAIGN, operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...CAMPAIGN, operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { ...CAMPAIGN, operation: ['getAll'] } },
		options: [
			{
				displayName: 'State',
				name: 'state',
				type: 'options',
				options: [
					{ name: 'Cancelled', value: 'cancelled' },
					{ name: 'Completed', value: 'completed' },
					{ name: 'Draft', value: 'draft' },
					{ name: 'Paused', value: 'paused' },
					{ name: 'Running', value: 'running' },
					{ name: 'Scheduled', value: 'scheduled' },
				],
				default: 'draft',
				description: 'Only campaigns in this state',
			},
		],
	},
];

export const emailCampaignDescription: INodeProperties[] = [
	...emailCampaignOperations,
	...emailCampaignFields,
];

/** The UTM object, only when at least one key is set. */
function buildUtm(raw: unknown): IDataObject | undefined {
	const utm = compact((raw as IDataObject | undefined) ?? {});
	return Object.keys(utm).length === 0 ? undefined : utm;
}

/** Body keys that Create Draft and Update Draft have in common. */
function draftBody(
	context: IExecuteFunctions,
	fields: IDataObject,
	itemIndex: number,
): IDataObject {
	return compact({
		subject: fields.subject,
		preheader: fields.preheader,
		text: fields.text,
		includeListIds: toStringArray(fields.includeListIds),
		excludeListIds: toStringArray(fields.excludeListIds),
		includeTags: toStringArray(fields.includeTags),
		excludeTags: toStringArray(fields.excludeTags),
		utm: buildUtm(fields.utm),
		desiredSendAt: toIsoDate(context, fields.desiredSendAt, 'Desired Send At', itemIndex),
	});
}

function campaignPath(context: IExecuteFunctions, itemIndex: number): string {
	return idPath(context, itemIndex, '/email-campaigns', 'campaignId', 'Campaign ID');
}

async function createDraft(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const name = requireText(this, this.getNodeParameter('name', i, ''), 'Name', i);
	const html = requireText(this, this.getNodeParameter('html', i, ''), 'HTML', i);
	const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
	return dattaCrmRequest.call(this, 'POST', '/email-campaigns', {
		name,
		html,
		...draftBody(this, fields, i),
	});
}

async function updateDraft(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const path = campaignPath(this, i);
	const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
	const body = compact({ name: fields.name, html: fields.html, ...draftBody(this, fields, i) });
	requireNonEmptyBody(this, body, i, 'Update Fields');
	return dattaCrmRequest.call(this, 'PATCH', path, body);
}

async function getCampaign(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	return dattaCrmRequest.call(this, 'GET', campaignPath(this, i));
}

async function getManyCampaigns(this: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
	return fetchMany(this, i, '/email-campaigns', compact({ state: filters.state }));
}

const operations: Record<string, ResourceExecutor> = {
	createDraft,
	updateDraft,
	get: getCampaign,
	getAll: getManyCampaigns,
};

export async function executeEmailCampaign(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	return runOperation(this, itemIndex, 'email campaign', operations);
}

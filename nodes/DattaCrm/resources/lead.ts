import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
} from 'n8n-workflow';
import { dattaCrmRequest, dattaCrmRequestAll, dattaCrmRequestPage } from '../shared/transport';
import {
	NO_OWNER_VALUE,
	buildCustomFields,
	compact,
	requireText,
	toIsoDate,
	toStringArray,
	type CustomFieldEntry,
	type ResourceExecutor,
} from '../shared/utils';

const LEAD = { resource: ['lead'] };

const customFieldsProperty: INodeProperties = {
	displayName: 'Custom Fields',
	name: 'customFields',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	placeholder: 'Add Custom Field',
	default: {},
	description:
		'Values for the custom fields of the account. They are converted to the type of each field (number, yes/no, multiple choice).',
	options: [
		{
			displayName: 'Custom Field',
			name: 'entries',
			values: [
				{
					displayName: 'Field Name or ID',
					name: 'key',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getCustomFields' },
					default: '',
					description:
						'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
					description:
						'Value of the field. Separate the choices of a multiple choice field with commas.',
				},
			],
		},
	],
};

const ownerIdProperty: INodeProperties = {
	displayName: 'Owner Name or ID',
	name: 'ownerId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getMembers' },
	default: '',
	description:
		'Person responsible for the lead. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

export const leadOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: LEAD },
		options: [
			{
				name: 'Add Tags',
				value: 'addTags',
				description: 'Add tags to a lead',
				action: 'Add tags to a lead',
			},
			{
				name: 'Add to Lists',
				value: 'addToLists',
				description: 'Add a lead to lists',
				action: 'Add a lead to lists',
			},
			{
				name: 'Create or Update',
				value: 'upsert',
				description: 'Create a new record, or update the current one if it already exists (upsert)',
				action: 'Create or update a lead',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a lead by ID, email or phone',
				action: 'Get a lead',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many leads',
				action: 'Get many leads',
			},
			{
				name: 'Remove From Lists',
				value: 'removeFromLists',
				description: 'Remove a lead from lists',
				action: 'Remove a lead from lists',
			},
			{
				name: 'Remove Tags',
				value: 'removeTags',
				description: 'Remove tags from a lead',
				action: 'Remove tags from a lead',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update the fields of a lead, overwriting the current values',
				action: 'Update a lead',
			},
			{
				name: 'Update in List',
				value: 'updateInList',
				description: 'Change the stage, value or loss reason of a lead in one of its lists',
				action: 'Update a lead in a list',
			},
		],
		default: 'upsert',
	},
];

export const leadFields: INodeProperties[] = [
	// Create or Update
	{
		displayName:
			'If the lead already exists (matched by phone, then email), only its empty fields are filled and tags and lists are merged. Use the Update operation to overwrite fields.',
		name: 'upsertNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { ...LEAD, operation: ['upsert'] } },
	},
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		default: '',
		displayOptions: { show: { ...LEAD, operation: ['upsert'] } },
		description: 'Email of the lead. Provide an email, a phone, or both.',
	},
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		default: '',
		displayOptions: { show: { ...LEAD, operation: ['upsert'] } },
		description:
			'Phone of the lead, ideally with country code. Provide an email, a phone, or both.',
	},
	{
		displayName: 'List Names or IDs',
		name: 'listIds',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getLists' },
		default: [],
		displayOptions: { show: { ...LEAD, operation: ['upsert'] } },
		description:
			'Lists to add the lead to; a new lead takes the origin of the first one. A new lead needs a list: leave it empty only if the API key has a list set in Datta CRM, otherwise the CRM returns "list_required". An existing lead is accepted without a list. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...LEAD, operation: ['upsert'] } },
		options: [
			customFieldsProperty,
			{
				displayName: 'Mode',
				name: 'mode',
				type: 'options',
				options: [
					{
						name: 'Create or Update',
						value: 'upsert',
						description:
							'Create a new record, or update the current one if it already exists (upsert)',
					},
					{
						name: 'Create Only',
						value: 'createOnly',
						description: 'Return an existing lead untouched',
					},
				],
				default: 'upsert',
				description:
					'What to do when the lead already exists. "Create or Update" only fills its empty fields and merges tags and lists, "Create Only" returns it untouched.',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Name of the lead',
			},
			{ ...ownerIdProperty },
			{
				displayName: 'Source',
				name: 'source',
				type: 'string',
				default: '',
				description:
					'Deprecated: the CRM ignores it. The origin of a new lead is the origin of its first list.',
			},
			{
				displayName: 'Tag Names or IDs',
				name: 'tags',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getTags' },
				default: [],
				description:
					'Tags to add to the lead, identified by name. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'UTM',
				name: 'utm',
				type: 'collection',
				placeholder: 'Add UTM Parameter',
				default: {},
				options: [
					{ displayName: 'Campaign', name: 'campaign', type: 'string', default: '' },
					{ displayName: 'Content', name: 'content', type: 'string', default: '' },
					{ displayName: 'Medium', name: 'medium', type: 'string', default: '' },
					{ displayName: 'Source', name: 'source', type: 'string', default: '' },
					{ displayName: 'Term', name: 'term', type: 'string', default: '' },
				],
			},
		],
	},

	// Get
	{
		displayName: 'Search By',
		name: 'searchBy',
		type: 'options',
		displayOptions: { show: { ...LEAD, operation: ['get'] } },
		options: [
			{ name: 'Email', value: 'email' },
			{ name: 'Lead ID', value: 'id' },
			{ name: 'Phone', value: 'phone' },
		],
		default: 'id',
		description: 'With email or phone, the first match is returned, or nothing if there is none',
	},
	{
		displayName: 'Lead ID',
		name: 'leadId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { ...LEAD, operation: ['get'], searchBy: ['id'] } },
		description: 'ID of the lead',
	},
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		required: true,
		placeholder: 'name@email.com',
		default: '',
		displayOptions: { show: { ...LEAD, operation: ['get'], searchBy: ['email'] } },
		description: 'Email of the lead',
	},
	{
		displayName: 'Phone',
		name: 'phone',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { ...LEAD, operation: ['get'], searchBy: ['phone'] } },
		description: 'Phone of the lead, in the format stored in the CRM',
	},

	// Get Many
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { ...LEAD, operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...LEAD, operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { ...LEAD, operation: ['getAll'] } },
		options: [
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				description: 'Only leads with this email',
			},
			{
				displayName: 'List Name or ID',
				name: 'listId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLists' },
				default: '',
				description:
					'Only leads in this list. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				default: '',
				description: 'Only leads with this phone',
			},
			{
				displayName: 'Stage Name or ID',
				name: 'stageId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAllStages' },
				default: '',
				description:
					'Only leads in this stage of a list with a funnel. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Tag Name or ID',
				name: 'tag',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTags' },
				default: '',
				description:
					'Only leads with this tag, identified by name. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Updated Since',
				name: 'updatedSince',
				type: 'dateTime',
				default: '',
				description: 'Only leads updated at or after this date',
			},
		],
	},

	// Operations on an existing lead
	{
		displayName: 'Lead ID',
		name: 'leadId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: {
			show: {
				...LEAD,
				operation: [
					'update',
					'addTags',
					'removeTags',
					'addToLists',
					'removeFromLists',
					'updateInList',
				],
			},
		},
		description: 'ID of the lead',
	},

	// Update
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...LEAD, operation: ['update'] } },
		description: 'Fields to overwrite. Choose at least one.',
		options: [
			customFieldsProperty,
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
			},
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
			},
			{
				...ownerIdProperty,
				typeOptions: { loadOptionsMethod: 'getMembersWithNoOwner' },
				description:
					'Person responsible for the lead. Choose "No Owner" to clear it. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				default: '',
			},
		],
	},

	// Tags and lists
	{
		displayName: 'Tag Names or IDs',
		name: 'tags',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getTags' },
		required: true,
		default: [],
		displayOptions: { show: { ...LEAD, operation: ['addTags', 'removeTags'] } },
		description:
			'Tags are identified by name. A comma-separated string also works. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'List Names or IDs',
		name: 'listIds',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getLists' },
		required: true,
		default: [],
		displayOptions: { show: { ...LEAD, operation: ['addToLists', 'removeFromLists'] } },
		description:
			'A comma-separated string also works. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},

	// Update in List
	{
		displayName: 'List Name or ID',
		name: 'listId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getLists' },
		required: true,
		default: '',
		displayOptions: { show: { ...LEAD, operation: ['updateInList'] } },
		description:
			'List of the lead whose stage, value or loss reason changes. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Update Fields',
		name: 'listFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...LEAD, operation: ['updateInList'] } },
		description: 'Fields to overwrite in this list. Choose at least one.',
		options: [
			{
				displayName: 'Loss Reason Name or ID',
				name: 'lossReasonId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLossReasons' },
				default: '',
				description:
					'Required when moving to a lost stage. On a lead already lost, replaces the reason. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Stage Name or ID',
				name: 'stageId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getStages', loadOptionsDependsOn: ['listId'] },
				default: '',
				description:
					'Stage of the list to move the lead to. Only lists with a funnel (WhatsApp and Instagram) have stages. Moving runs the same automations and webhooks as the board. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Value',
				name: 'value',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 0,
				description: 'Deal value of the lead in this list, in BRL',
			},
		],
	},
];

export const leadDescription: INodeProperties[] = [...leadOperations, ...leadFields];

type FixedEntries = { entries?: CustomFieldEntry[] } | undefined;

async function customFieldsOf(
	context: IExecuteFunctions,
	fields: IDataObject,
	itemIndex: number,
): Promise<IDataObject> {
	return buildCustomFields(context, (fields.customFields as FixedEntries)?.entries, itemIndex);
}

function leadPath(context: IExecuteFunctions, itemIndex: number): string {
	const id = requireText(
		context,
		context.getNodeParameter('leadId', itemIndex, ''),
		'Lead ID',
		itemIndex,
	);
	return `/leads/${encodeURIComponent(id)}`;
}

async function upsertLead(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const email = String(this.getNodeParameter('email', i, '')).trim();
	const phone = String(this.getNodeParameter('phone', i, '')).trim();
	if (email === '' && phone === '') {
		throw new NodeOperationError(this.getNode(), 'Provide an email or a phone', {
			itemIndex: i,
			description: 'The CRM matches and creates leads by phone or email.',
		});
	}
	const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
	const body = compact({
		email,
		phone,
		name: fields.name,
		tags: toStringArray(fields.tags),
		// Up to 0.1.x the lists were an additional field: workflows saved then still carry them there.
		listIds: [
			...new Set([
				...toStringArray(this.getNodeParameter('listIds', i, [])),
				...toStringArray(fields.listIds),
			]),
		],
		ownerId: fields.ownerId,
		customFields: await customFieldsOf(this, fields, i),
		source: fields.source,
		utm: compact((fields.utm as IDataObject | undefined) ?? {}),
		mode: fields.mode,
	});
	return dattaCrmRequest.call(this, 'POST', '/leads', body);
}

async function getLead(this: IExecuteFunctions, i: number): Promise<IDataObject | IDataObject[]> {
	const searchBy = this.getNodeParameter('searchBy', i, 'id') as string;
	if (searchBy === 'id') {
		return dattaCrmRequest.call(this, 'GET', leadPath(this, i));
	}
	const label = searchBy === 'email' ? 'Email' : 'Phone';
	const value = requireText(this, this.getNodeParameter(searchBy, i, ''), label, i);
	const { items } = await dattaCrmRequestPage.call(this, '/leads', { [searchBy]: value, limit: 1 });
	return items.slice(0, 1);
}

async function getManyLeads(this: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
	const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
	const qs = compact({
		email: filters.email,
		phone: filters.phone,
		tag: filters.tag,
		listId: filters.listId,
		stageId: filters.stageId,
		updatedSince: toIsoDate(this, filters.updatedSince, 'Updated Since', i),
	});
	const max = returnAll ? undefined : (this.getNodeParameter('limit', i, 50) as number);
	return dattaCrmRequestAll.call(this, '/leads', qs, max);
}

async function updateLead(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const path = leadPath(this, i);
	const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
	const body = compact({
		name: fields.name,
		email: fields.email,
		phone: fields.phone,
		ownerId: fields.ownerId === NO_OWNER_VALUE ? null : fields.ownerId,
		customFields: await customFieldsOf(this, fields, i),
	});
	if (Object.keys(body).length === 0) {
		throw new NodeOperationError(this.getNode(), 'Choose at least one field to update', {
			itemIndex: i,
			description: 'Add a field under "Update Fields".',
		});
	}
	return dattaCrmRequest.call(this, 'PATCH', path, body);
}

function patchWithList(
	parameter: 'tags' | 'listIds',
	bodyKey: string,
	emptyMessage: string,
): (this: IExecuteFunctions, i: number) => Promise<IDataObject> {
	return async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
		const path = leadPath(this, i);
		const values = toStringArray(this.getNodeParameter(parameter, i, []));
		if (values.length === 0) {
			throw new NodeOperationError(this.getNode(), emptyMessage, { itemIndex: i });
		}
		return dattaCrmRequest.call(this, 'PATCH', path, { [bodyKey]: values });
	};
}

async function updateLeadInList(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const listId = requireText(this, this.getNodeParameter('listId', i, ''), 'List', i);
	const path = `${leadPath(this, i)}/lists/${encodeURIComponent(listId)}`;
	const fields = this.getNodeParameter('listFields', i, {}) as IDataObject;
	const body = compact({
		stageId: fields.stageId,
		value: fields.value,
		lossReasonId: fields.lossReasonId,
	});
	if (Object.keys(body).length === 0) {
		throw new NodeOperationError(this.getNode(), 'Choose at least one field to update', {
			itemIndex: i,
			description: 'Add a stage, a value or a loss reason under "Update Fields".',
		});
	}
	return dattaCrmRequest.call(this, 'PATCH', path, body);
}

const operations: Record<string, ResourceExecutor> = {
	upsert: upsertLead,
	get: getLead,
	getAll: getManyLeads,
	update: updateLead,
	addTags: patchWithList('tags', 'addTags', 'Choose at least one tag'),
	removeTags: patchWithList('tags', 'removeTags', 'Choose at least one tag'),
	addToLists: patchWithList('listIds', 'addListIds', 'Choose at least one list'),
	removeFromLists: patchWithList('listIds', 'removeListIds', 'Choose at least one list'),
	updateInList: updateLeadInList,
};

export async function executeLead(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const operation = this.getNodeParameter('operation', itemIndex) as string;
	const handler = operations[operation];
	if (handler === undefined) {
		throw new NodeOperationError(this.getNode(), `Unknown lead operation "${operation}"`, {
			itemIndex,
			description:
				operation === 'moveToStage'
					? 'Stages now belong to each list: use the "Update in List" operation.'
					: undefined,
		});
	}
	return handler.call(this, itemIndex);
}

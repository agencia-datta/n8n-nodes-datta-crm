import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
} from 'n8n-workflow';
import { dattaCrmRequest } from '../shared/transport';
import {
	compact,
	fetchMany,
	idPath,
	parseJsonArray,
	parseJsonObject,
	requireText,
	runOperation,
	toStringArray,
	type ResourceExecutor,
} from '../shared/utils';

const FORM = { resource: ['form'] };

export const formOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: FORM },
		options: [
			{
				name: 'Activate',
				value: 'activate',
				description: 'Turn a form on so it accepts submissions',
				action: 'Activate a form',
			},
			{
				name: 'Create',
				value: 'create',
				description: 'Create a form',
				action: 'Create a form',
			},
			{
				name: 'Deactivate',
				value: 'deactivate',
				description: 'Turn a form off so it stops accepting submissions',
				action: 'Deactivate a form',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a form by ID',
				action: 'Get a form',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many forms',
				action: 'Get many forms',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a form',
				action: 'Update a form',
			},
		],
		default: 'create',
	},
];

export const formFields: INodeProperties[] = [
	// Create
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { ...FORM, operation: ['create'] } },
		description: 'Name of the form (up to 100 characters)',
	},
	{
		displayName: 'Slug',
		name: 'slug',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { ...FORM, operation: ['create'] } },
		description:
			'Unique part of the public URL of the form (up to 64 characters). Use lowercase letters, numbers and hyphens.',
	},
	{
		displayName: 'Experience',
		name: 'experience',
		type: 'options',
		options: [
			{
				name: 'Classic',
				value: 'classic',
				description: 'All questions on one page',
			},
			{
				name: 'Conversational',
				value: 'conversational',
				description: 'One question at a time',
			},
		],
		default: 'classic',
		displayOptions: { show: { ...FORM, operation: ['create'] } },
		description: 'How the form is presented to the visitor',
	},
	{
		displayName: 'Fields',
		name: 'fields',
		type: 'json',
		required: true,
		default: '[]',
		displayOptions: { show: { ...FORM, operation: ['create'] } },
		description:
			'JSON array with the questions of the form (up to 50). Each item is an object, as returned by Get Form.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...FORM, operation: ['create'] } },
		options: [
			{
				displayName: 'Consent',
				name: 'consent',
				type: 'json',
				default: '{}',
				description:
					'JSON object with the consent checkbox, for example {"enabled": true, "text": "I agree"}',
			},
			{
				displayName: 'Default List Name or ID',
				name: 'defaultListId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getLists' },
				default: '',
				description:
					'List that receives the leads of the form. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Default Tag Names or IDs',
				name: 'defaultTags',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getTags' },
				default: [],
				description:
					'Tags added to the leads of the form, identified by name. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Email Marketing',
				name: 'emailMarketing',
				type: 'json',
				default: '{}',
				description:
					'JSON object with the email marketing opt-in, for example {"enabled": true, "text": "Send me news"}',
			},
			{
				displayName: 'Funnel Stage Name or ID',
				name: 'funnelStageId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAllStages' },
				default: '',
				description:
					'Stage where the leads of the form enter the funnel. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Is Active',
				name: 'isActive',
				type: 'boolean',
				default: true,
				description: 'Whether the form accepts submissions',
			},
			{
				displayName: 'Show Questions',
				name: 'showQuestions',
				type: 'boolean',
				default: false,
				description: 'Whether the conversational form shows the list of questions',
			},
			{
				displayName: 'Theme',
				name: 'theme',
				type: 'json',
				default: '{}',
				description:
					'JSON object with the colors and fonts of the form, for example {"accent": "#1d8f7a", "alignment": "center"}',
			},
		],
	},

	// Operations on an existing form
	{
		displayName: 'Form Name or ID',
		name: 'formId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getForms' },
		required: true,
		default: '',
		displayOptions: {
			show: { ...FORM, operation: ['activate', 'deactivate', 'get', 'update'] },
		},
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
	},

	// Update
	{
		displayName: 'Fields to Update (JSON)',
		name: 'updateJson',
		type: 'json',
		required: true,
		default: '{}',
		displayOptions: { show: { ...FORM, operation: ['update'] } },
		description:
			'JSON object with only the form fields to change, named as in Create (name, slug, experience, fields, defaultTags, defaultListId, funnelEntry, isActive, showQuestions, theme, consent, emailMarketing)',
	},

	// Get Many
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { ...FORM, operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...FORM, operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { ...FORM, operation: ['getAll'] } },
		options: [
			{
				displayName: 'Status',
				name: 'isActive',
				type: 'options',
				options: [
					{ name: 'Active', value: 'true' },
					{ name: 'All', value: 'all' },
					{ name: 'Inactive', value: 'false' },
				],
				default: 'all',
				description: 'Only forms that are active or inactive',
			},
		],
	},
];

export const formDescription: INodeProperties[] = [...formOperations, ...formFields];

function formPath(context: IExecuteFunctions, itemIndex: number): string {
	return idPath(context, itemIndex, '/forms', 'formId', 'Form');
}

/** An optional JSON object field: skipped when blank, validated when filled. */
function optionalObject(
	context: IExecuteFunctions,
	fields: IDataObject,
	key: string,
	label: string,
	itemIndex: number,
): IDataObject | undefined {
	const value = fields[key];
	if (value === undefined || (typeof value === 'string' && value.trim() === '')) return undefined;
	return parseJsonObject(context, value, label, itemIndex);
}

async function createForm(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const name = requireText(this, this.getNodeParameter('name', i, ''), 'Name', i);
	const slug = requireText(this, this.getNodeParameter('slug', i, ''), 'Slug', i);
	const fields = parseJsonArray(this, this.getNodeParameter('fields', i, '[]'), 'Fields', i);
	const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
	const stageId = extra.funnelStageId;
	const body = {
		name,
		slug,
		experience: this.getNodeParameter('experience', i, 'classic') as string,
		// An empty array is valid, so `fields` stays out of `compact`.
		fields,
		...compact({
			defaultTags: toStringArray(extra.defaultTags),
			defaultListId: extra.defaultListId,
			funnelEntry:
				typeof stageId === 'string' && stageId !== '' ? { enabled: true, stageId } : undefined,
			isActive: extra.isActive,
			showQuestions: extra.showQuestions,
			theme: optionalObject(this, extra, 'theme', 'Theme', i),
			consent: optionalObject(this, extra, 'consent', 'Consent', i),
			emailMarketing: optionalObject(this, extra, 'emailMarketing', 'Email Marketing', i),
		}),
	};
	return dattaCrmRequest.call(this, 'POST', '/forms', body);
}

async function updateForm(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const path = formPath(this, i);
	const label = 'Fields to Update (JSON)';
	const body = parseJsonObject(this, this.getNodeParameter('updateJson', i, '{}'), label, i);
	if (Object.keys(body).length === 0) {
		throw new NodeOperationError(this.getNode(), `"${label}" must include at least one field`, {
			itemIndex: i,
			description: 'Add the form fields to change, for example {"name": "New name"}.',
		});
	}
	return dattaCrmRequest.call(this, 'PATCH', path, body);
}

function setActive(isActive: boolean): ResourceExecutor {
	return async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
		return dattaCrmRequest.call(this, 'PATCH', formPath(this, i), { isActive });
	};
}

async function getForm(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	return dattaCrmRequest.call(this, 'GET', formPath(this, i));
}

async function getManyForms(this: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
	const isActive =
		filters.isActive === 'true' || filters.isActive === 'false' ? filters.isActive : undefined;
	return fetchMany(this, i, '/forms', compact({ isActive }));
}

const operations: Record<string, ResourceExecutor> = {
	create: createForm,
	update: updateForm,
	activate: setActive(true),
	deactivate: setActive(false),
	get: getForm,
	getAll: getManyForms,
};

export async function executeForm(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	return runOperation(this, itemIndex, 'form', operations);
}

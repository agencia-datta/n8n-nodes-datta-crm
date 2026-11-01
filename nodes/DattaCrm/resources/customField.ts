import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
} from 'n8n-workflow';
import { dattaCrmRequest } from '../shared/transport';
import { compact, getAllUnpaginated, requireText, toStringArray } from '../shared/utils';

const CUSTOM_FIELD = { resource: ['customField'] };

export const customFieldOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: CUSTOM_FIELD },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a custom field of leads, or return it when the key already exists',
				action: 'Create a custom field',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many custom fields of leads',
				action: 'Get many custom fields',
			},
		],
		default: 'create',
	},
];

export const customFieldFields: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'label',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { ...CUSTOM_FIELD, operation: ['create'] } },
		description: 'Name of the field as shown in the CRM (up to 60 characters)',
	},
	{
		displayName: 'Type',
		name: 'type',
		type: 'options',
		options: [
			{ name: 'Boolean', value: 'boolean', description: 'Yes or no' },
			{ name: 'Date', value: 'date' },
			{ name: 'Multi Select', value: 'multi_select', description: 'Several of the options' },
			{ name: 'Number', value: 'number' },
			{ name: 'Select', value: 'select', description: 'One of the options' },
			{ name: 'Text', value: 'text' },
		],
		default: 'text',
		displayOptions: { show: { ...CUSTOM_FIELD, operation: ['create'] } },
		description:
			'Type of the field. When the key already exists with another type, the CRM returns "conflict".',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'string',
		default: '',
		placeholder: 'Owner, Manager, Employee',
		displayOptions: {
			show: { ...CUSTOM_FIELD, operation: ['create'], type: ['select', 'multi_select'] },
		},
		description: 'Choices of the field, separated by commas (up to 100)',
	},
	{
		displayName: 'Key',
		name: 'key',
		type: 'string',
		default: '',
		placeholder: 'job_title',
		displayOptions: { show: { ...CUSTOM_FIELD, operation: ['create'] } },
		description:
			'Key of the field in the Custom Fields of a lead: letters without accents, numbers and underscores, up to 40 characters, saved in lowercase. Leave empty to derive it from the name. When a field with this key already exists, it is returned unchanged.',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { ...CUSTOM_FIELD, operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...CUSTOM_FIELD, operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
];

export const customFieldDescription: INodeProperties[] = [
	...customFieldOperations,
	...customFieldFields,
];

export async function executeCustomField(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const operation = this.getNodeParameter('operation', itemIndex) as string;

	if (operation === 'create') {
		const label = requireText(
			this,
			this.getNodeParameter('label', itemIndex, ''),
			'Field name',
			itemIndex,
		);
		const type = this.getNodeParameter('type', itemIndex, 'text') as string;
		const options =
			type === 'select' || type === 'multi_select'
				? toStringArray(this.getNodeParameter('options', itemIndex, ''))
				: [];
		const key = String(this.getNodeParameter('key', itemIndex, '')).trim();
		return dattaCrmRequest.call(
			this,
			'POST',
			'/custom-fields',
			compact({ label, key, type, options }),
		);
	}

	if (operation === 'getAll') {
		return getAllUnpaginated(this, '/custom-fields', 'custom fields', itemIndex);
	}

	throw new NodeOperationError(this.getNode(), `Unknown custom field operation "${operation}"`, {
		itemIndex,
	});
}

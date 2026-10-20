import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
} from 'n8n-workflow';
import { dattaCrmRequest } from '../shared/transport';
import { requireText } from '../shared/utils';

const LIST = { resource: ['list'] };

export const listOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: LIST },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a list of leads',
				action: 'Create a list',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many lists',
				action: 'Get many lists',
			},
		],
		default: 'create',
	},
];

export const listFields: INodeProperties[] = [
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { ...LIST, operation: ['create'] } },
		description: 'Name of the list (up to 80 characters)',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { ...LIST, operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...LIST, operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
];

export const listDescription: INodeProperties[] = [...listOperations, ...listFields];

export async function executeList(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const operation = this.getNodeParameter('operation', itemIndex) as string;

	if (operation === 'create') {
		const name = requireText(
			this,
			this.getNodeParameter('name', itemIndex, ''),
			'List name',
			itemIndex,
		);
		return dattaCrmRequest.call(this, 'POST', '/lists', { name });
	}

	if (operation === 'getAll') {
		const lists = (await dattaCrmRequest.call(this, 'GET', '/lists')) as IDataObject[];
		if (this.getNodeParameter('returnAll', itemIndex, false) as boolean) return lists;
		return lists.slice(0, this.getNodeParameter('limit', itemIndex, 50) as number);
	}

	throw new NodeOperationError(this.getNode(), `Unknown list operation "${operation}"`, {
		itemIndex,
	});
}

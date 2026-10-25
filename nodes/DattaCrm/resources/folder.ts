import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
} from 'n8n-workflow';
import { getAllUnpaginated } from '../shared/utils';

const FOLDER = { resource: ['folder'] };

export const folderOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: FOLDER },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many folders of lists, of every origin',
				action: 'Get many folders',
			},
		],
		default: 'getAll',
	},
];

export const folderFields: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { ...FOLDER, operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...FOLDER, operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
];

export const folderDescription: INodeProperties[] = [...folderOperations, ...folderFields];

export async function executeFolder(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const operation = this.getNodeParameter('operation', itemIndex) as string;

	if (operation === 'getAll') {
		return getAllUnpaginated(this, '/folders', 'folders', itemIndex);
	}

	throw new NodeOperationError(this.getNode(), `Unknown folder operation "${operation}"`, {
		itemIndex,
	});
}

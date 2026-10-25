import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
} from 'n8n-workflow';
import { dattaCrmRequest } from '../shared/transport';
import { compact, getAllUnpaginated, requireText } from '../shared/utils';

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
			{
				name: 'Get Stages',
				value: 'getStages',
				description: 'Get the funnel stages of a list',
				action: 'Get the stages of a list',
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
		description:
			'Name of the list (up to 80 characters). It must be unique among the lists of the same origin.',
	},
	{
		displayName: 'Folder Name or ID',
		name: 'folderId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getFolders' },
		default: '',
		displayOptions: { show: { ...LIST, operation: ['create'] } },
		description:
			'Folder of the new list; the list takes the origin of the folder. Can be left empty only when the origin below has exactly one folder, otherwise the CRM returns "folder_required". Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Origin',
		name: 'origin',
		type: 'options',
		options: [
			{ name: 'Instagram', value: 'instagram' },
			{ name: 'Site', value: 'site' },
			{ name: 'WhatsApp', value: 'whatsapp' },
		],
		default: 'site',
		displayOptions: { show: { ...LIST, operation: ['create'] } },
		description:
			'Origin whose only folder receives the list when no folder is chosen. Ignored when a folder is chosen.',
	},
	{
		displayName: 'List Name or ID',
		name: 'listId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getLists' },
		required: true,
		default: '',
		displayOptions: { show: { ...LIST, operation: ['getStages'] } },
		description:
			'List whose stages are returned, in board order. Lists of the Site origin have no funnel and return no items. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
		const folderId = String(this.getNodeParameter('folderId', itemIndex, '')).trim();
		// The API ignores the origin when a folder is given: send it only to pick the folder.
		const origin =
			folderId === '' ? (this.getNodeParameter('origin', itemIndex, 'site') as string) : undefined;
		return dattaCrmRequest.call(this, 'POST', '/lists', compact({ name, folderId, origin }));
	}

	if (operation === 'getAll') {
		return getAllUnpaginated(this, '/lists', 'lists', itemIndex);
	}

	if (operation === 'getStages') {
		const listId = requireText(
			this,
			this.getNodeParameter('listId', itemIndex, ''),
			'List',
			itemIndex,
		);
		// The API has no endpoint for one list: its stages come with GET /lists.
		const lists = await getAllUnpaginated(this, '/lists', 'lists', itemIndex, true);
		const list = lists.find((candidate) => candidate.id === listId);
		if (list === undefined) {
			throw new NodeOperationError(this.getNode(), 'List not found', {
				itemIndex,
				description: `No list with ID "${listId}" in this account.`,
			});
		}
		return (list.stages as IDataObject[] | undefined) ?? [];
	}

	throw new NodeOperationError(this.getNode(), `Unknown list operation "${operation}"`, {
		itemIndex,
	});
}

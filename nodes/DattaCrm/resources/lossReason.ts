import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
} from 'n8n-workflow';
import { getAllUnpaginated } from '../shared/utils';

const LOSS_REASON = { resource: ['lossReason'] };

export const lossReasonOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: LOSS_REASON },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many loss reasons of the account',
				action: 'Get many loss reasons',
			},
		],
		default: 'getAll',
	},
];

export const lossReasonFields: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { ...LOSS_REASON, operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...LOSS_REASON, operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
];

export const lossReasonDescription: INodeProperties[] = [
	...lossReasonOperations,
	...lossReasonFields,
];

export async function executeLossReason(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	const operation = this.getNodeParameter('operation', itemIndex) as string;

	if (operation === 'getAll') {
		return getAllUnpaginated(this, '/loss-reasons', 'loss reasons', itemIndex);
	}

	throw new NodeOperationError(this.getNode(), `Unknown loss reason operation "${operation}"`, {
		itemIndex,
	});
}

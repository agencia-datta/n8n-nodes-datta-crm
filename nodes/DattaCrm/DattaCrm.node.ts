import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';
import { executeLead, leadDescription } from './resources/lead';
import { executeList, listDescription } from './resources/list';
import {
	getAllStages,
	getCustomFields,
	getEvents,
	getForms,
	getLists,
	getMembers,
	getMembersWithNoOwner,
	getPipelines,
	getStages,
	getTags,
} from './shared/loadOptions';
import type { ResourceExecutor } from './shared/utils';

/** One executor per resource. Add a resource here and in the `resource` options below. */
const executors: Record<string, ResourceExecutor> = {
	lead: executeLead,
	list: executeList,
};

export class DattaCrm implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Datta CRM',
		name: 'dattaCrm',
		icon: { light: 'file:dattaCrm.svg', dark: 'file:dattaCrm.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create and update leads, sales, forms and email drafts in Datta CRM',
		defaults: {
			name: 'Datta CRM',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'dattaCrmApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Lead', value: 'lead' },
					{ name: 'List', value: 'list' },
				],
				default: 'lead',
			},
			...leadDescription,
			...listDescription,
		],
	};

	methods = {
		loadOptions: {
			getAllStages,
			getCustomFields,
			getEvents,
			getForms,
			getLists,
			getMembers,
			getMembersWithNoOwner,
			getPipelines,
			getStages,
			getTags,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const executor = executors[resource];
				if (executor === undefined) {
					throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`, {
						itemIndex: i,
					});
				}
				const result = await executor.call(this, i);
				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(result), {
						itemData: { item: i },
					}),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeApiError) {
					error.context.itemIndex ??= i;
					// The constructor returns an existing NodeApiError unchanged.
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
				}
				// The constructor returns an existing NodeOperationError unchanged.
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}

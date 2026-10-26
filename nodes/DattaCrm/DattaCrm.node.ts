import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';
import { emailCampaignDescription, executeEmailCampaign } from './resources/emailCampaign';
import { executeFolder, folderDescription } from './resources/folder';
import { executeForm, formDescription } from './resources/form';
import { executeLead, leadDescription } from './resources/lead';
import { executeList, listDescription } from './resources/list';
import { executeLossReason, lossReasonDescription } from './resources/lossReason';
import { executeSale, saleDescription } from './resources/sale';
import {
	getAllStages,
	getCustomFields,
	getEvents,
	getFolders,
	getForms,
	getLists,
	getLossReasons,
	getMembers,
	getMembersWithNoOwner,
	getStages,
	getTags,
} from './shared/loadOptions';
import type { ResourceExecutor } from './shared/utils';

/** One executor per resource. Add a resource here and in the `resource` options below. */
const executors: Record<string, ResourceExecutor> = {
	lead: executeLead,
	list: executeList,
	folder: executeFolder,
	lossReason: executeLossReason,
	sale: executeSale,
	form: executeForm,
	emailCampaign: executeEmailCampaign,
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
					{ name: 'Email Campaign', value: 'emailCampaign' },
					{ name: 'Folder', value: 'folder' },
					{ name: 'Form', value: 'form' },
					{ name: 'Lead', value: 'lead' },
					{ name: 'List', value: 'list' },
					{ name: 'Loss Reason', value: 'lossReason' },
					{ name: 'Sale', value: 'sale' },
				],
				default: 'lead',
			},
			...leadDescription,
			...listDescription,
			...folderDescription,
			...lossReasonDescription,
			...saleDescription,
			...formDescription,
			...emailCampaignDescription,
		],
	};

	methods = {
		loadOptions: {
			getAllStages,
			getCustomFields,
			getEvents,
			getFolders,
			getForms,
			getLists,
			getLossReasons,
			getMembers,
			getMembersWithNoOwner,
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
					const { message, description } = error as {
						message: string;
						description?: string | null;
					};
					const json: IDataObject = { error: message };
					// The API error description carries the code, request ID and validation details.
					if (typeof description === 'string' && description !== '') json.description = description;
					returnData.push({ json, pairedItem: { item: i } });
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

import {
	NodeConnectionTypes,
	type INodeType,
	type INodeTypeDescription,
	type IHookFunctions,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';

export class DattaCrmTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Datta CRM Trigger',
		name: 'dattaCrmTrigger',
		icon: { light: 'file:../DattaCrm/dattaCrm.svg', dark: 'file:../DattaCrm/dattaCrm.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: 'Real-time events',
		description: 'Starts the workflow when something happens in Datta CRM',
		defaults: {
			name: 'Datta CRM Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'dattaCrmApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [],
	};

	webhookMethods = {
		default: {
			// Stubs: the real lifecycle against POST/GET/DELETE /webhooks lands in a later task.
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return false;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		return { workflowData: [this.helpers.returnJsonArray(this.getBodyData())] };
	}
}

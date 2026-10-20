import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class DattaCrmApi implements ICredentialType {
	name = 'dattaCrmApi';

	displayName = 'Datta CRM API';

	icon: Icon = {
		light: 'file:../nodes/DattaCrm/dattaCrm.svg',
		dark: 'file:../nodes/DattaCrm/dattaCrm.dark.svg',
	};

	documentationUrl = 'https://help.agenciadatta.com.br/integracoes/api/n8n/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://crm.agenciadatta.com.br',
			required: true,
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey.trim()}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/[/]+$/, "")}}/api/v1',
			url: '/pipelines',
		},
	};
}

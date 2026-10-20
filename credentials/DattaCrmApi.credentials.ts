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
			placeholder: 'crm_live_...',
			description:
				'Create a key in Datta CRM under Integrations → API. Each key belongs to one account.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://crm.agenciadatta.com.br',
			required: true,
			description: 'Only change this if you were given a different Datta CRM address.',
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
			baseURL: '={{$credentials.baseUrl.trim().replace(/[/]+$/, "")}}/api/v1',
			url: '/me',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'Invalid, expired or revoked API key. Check it in Datta CRM under Integrations → API.',
				},
			},
		],
	};
}

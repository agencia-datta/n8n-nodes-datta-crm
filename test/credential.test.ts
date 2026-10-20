import { describe, expect, it } from 'vitest';
import { DattaCrmApi } from '../credentials/DattaCrmApi.credentials';

type Credentials = Record<string, string>;

/**
 * Evaluates the one `$credentials` expression shape the credential uses
 * (`$credentials.<field>` followed by `.trim()` and/or `.replace(/re/, "text")` calls).
 * The n8n lint rules forbid `eval` and `new Function`, so this is a tiny interpreter.
 */
function evaluateExpression(expression: string, credentials: Credentials): string {
	const source = expression.trim();
	const head = /^\$credentials\.(\w+)/.exec(source);
	if (!head) throw new Error(`Unsupported expression: ${expression}`);
	let value = credentials[head[1]];
	let rest = source.slice(head[0].length);
	while (rest !== '') {
		const trim = /^\.trim\(\)/.exec(rest);
		const replace = /^\.replace\(\/(.+?)\/, "(.*?)"\)/.exec(rest);
		if (trim) {
			value = value.trim();
			rest = rest.slice(trim[0].length);
		} else if (replace) {
			value = value.replace(new RegExp(replace[1]), replace[2]);
			rest = rest.slice(replace[0].length);
		} else {
			throw new Error(`Unsupported expression: ${expression}`);
		}
	}
	return value;
}

/** Resolves an n8n expression string such as `=Bearer {{$credentials.apiKey.trim()}}`. */
function evaluate(template: string, credentials: Credentials): string {
	return template
		.replace(/^=/, '')
		.replace(/\{\{(.+?)\}\}/g, (_match, expression: string) =>
			evaluateExpression(expression, credentials),
		);
}

describe('DattaCrmApi credential', () => {
	const credential = new DattaCrmApi();

	it('exposes the credential identity and documentation', () => {
		expect(credential.name).toBe('dattaCrmApi');
		expect(credential.displayName).toBe('Datta CRM API');
		expect(credential.documentationUrl).toBe(
			'https://help.agenciadatta.com.br/integracoes/api/n8n/',
		);
		expect(credential.icon).toEqual({
			light: 'file:../nodes/DattaCrm/dattaCrm.svg',
			dark: 'file:../nodes/DattaCrm/dattaCrm.dark.svg',
		});
	});

	it('defines the API key as a required password field', () => {
		const apiKey = credential.properties.find((property) => property.name === 'apiKey');
		expect(apiKey).toMatchObject({
			displayName: 'API Key',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'crm_live_...',
		});
		expect(apiKey?.description).toBe(
			'Create a key in Datta CRM under Integrations → API. Each key belongs to one account.',
		);
	});

	it('defaults the base URL to the hosted CRM', () => {
		const baseUrl = credential.properties.find((property) => property.name === 'baseUrl');
		expect(baseUrl).toMatchObject({
			displayName: 'Base URL',
			type: 'string',
			default: 'https://crm.agenciadatta.com.br',
		});
		expect(baseUrl?.description).toBe(
			'Only change this if you were given a different Datta CRM address.',
		);
	});

	it('sends the trimmed API key as a Bearer token', () => {
		const authenticate = credential.authenticate as {
			properties: { headers: { Authorization: string } };
		};
		const header = evaluate(authenticate.properties.headers.Authorization, {
			apiKey: '  crm_live_x  ',
		});
		expect(header).toBe('Bearer crm_live_x');
	});

	it('tests the credential against GET /me with whitespace and trailing slashes stripped', () => {
		const request = credential.test.request;
		expect(request.url).toBe('/me');
		const baseURL = request.baseURL as string;
		expect(evaluate(baseURL, { baseUrl: 'https://crm.example.com/' })).toBe(
			'https://crm.example.com/api/v1',
		);
		expect(evaluate(baseURL, { baseUrl: 'https://crm.example.com//' })).toBe(
			'https://crm.example.com/api/v1',
		);
		expect(evaluate(baseURL, { baseUrl: '  https://crm.example.com/ ' })).toBe(
			'https://crm.example.com/api/v1',
		);
	});

	it('explains a 401 in the credential test instead of showing "Unauthorized"', () => {
		expect(credential.test.rules).toEqual([
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'Invalid, expired or revoked API key. Check it in Datta CRM under Integrations → API.',
				},
			},
		]);
	});
});

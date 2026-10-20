import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import {
	apiUrl,
	dattaCrmRequest,
	dattaCrmRequestAll,
	dattaCrmRequestPage,
} from '../nodes/DattaCrm/shared/transport';
import { apiError, createExecuteContext, ok, page } from './helpers';

async function catchError(promise: Promise<unknown>): Promise<NodeApiError> {
	try {
		await promise;
	} catch (error) {
		return error as NodeApiError;
	}
	throw new Error('Expected the request to fail');
}

describe('apiUrl', () => {
	it('strips trailing slashes from the base URL', () => {
		expect(apiUrl('https://crm.example.com//', '/leads')).toBe(
			'https://crm.example.com/api/v1/leads',
		);
	});

	it('trims whitespace around the base URL', () => {
		expect(apiUrl('  https://crm.example.com/ ', '/leads')).toBe(
			'https://crm.example.com/api/v1/leads',
		);
	});
});

describe('dattaCrmRequest', () => {
	it('sends an authenticated request and returns the data', async () => {
		const { ctx, request } = createExecuteContext({
			credentials: { apiKey: 'k', baseUrl: 'https://crm.example.com//' },
			responses: [ok({ id: 'l1' })],
		});

		const data = await dattaCrmRequest.call(ctx, 'POST', '/leads', { name: 'Ana' });

		expect(data).toEqual({ id: 'l1' });
		expect(request).toHaveBeenCalledTimes(1);
		const [credentialType, options] = request.mock.calls[0];
		expect(credentialType).toBe('dattaCrmApi');
		expect(options).toEqual({
			method: 'POST',
			url: 'https://crm.example.com/api/v1/leads',
			body: { name: 'Ana' },
			qs: undefined,
			json: true,
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		});
	});

	it('omits the body when undefined and drops empty query values', async () => {
		const { ctx, request } = createExecuteContext({ responses: [ok([])] });

		await dattaCrmRequest.call(ctx, 'GET', '/leads', undefined, {
			email: 'a@b.co',
			phone: '',
			cursor: null,
			limit: undefined,
			offset: 0,
		});

		const options = request.mock.calls[0][1];
		expect(options).not.toHaveProperty('body');
		expect(options.qs).toEqual({ email: 'a@b.co', offset: 0 });
	});

	it('maps an API error body to a NodeApiError with code and request id', async () => {
		const { ctx } = createExecuteContext({
			responses: [
				apiError(409, 'conflict', 'Telefone já pertence a outro lead.', { requestId: 'req_1' }),
			],
		});

		const error = await catchError(dattaCrmRequest.call(ctx, 'POST', '/leads', {}));

		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('Telefone já pertence a outro lead.');
		expect(error.description).toContain('conflict');
		expect(error.description).toContain('req_1');
		expect(error.httpCode).toBe('409');
	});

	it('keeps the API message verbatim even when it contains an n8n error token', async () => {
		const message = 'Já existe um lead preexistente com este telefone.';
		const { ctx } = createExecuteContext({
			responses: [apiError(409, 'conflict', message, { requestId: 'req_3' })],
		});

		const error = await catchError(dattaCrmRequest.call(ctx, 'POST', '/leads', {}));

		expect(error.message).toBe(message);
		expect(error.description).toContain('req_3');
	});

	it('raises a clear error when a list response has no data array', async () => {
		const { ctx } = createExecuteContext({
			responses: [{ statusCode: 200, body: { data: { id: '1' } }, headers: {} }],
		});

		const error = await catchError(dattaCrmRequestPage.call(ctx, '/leads'));

		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('Unexpected response from Datta CRM');
	});

	it('lists validation details in the description', async () => {
		const { ctx } = createExecuteContext({
			responses: [
				apiError(400, 'validation_error', 'Corpo inválido.', {
					requestId: 'req_2',
					details: [
						{ path: 'email', message: 'E-mail inválido.' },
						{ path: '', message: 'Informe e-mail ou telefone.' },
					],
				}),
			],
		});

		const error = await catchError(dattaCrmRequest.call(ctx, 'POST', '/leads', {}));

		expect(error.message).toBe('Corpo inválido.');
		expect(error.description).toContain('code: validation_error · requestId: req_2');
		expect(error.description).toContain('email: E-mail inválido.');
		expect(error.description).toContain('\nInforme e-mail ou telefone.');
		expect(error.description).not.toContain(': Informe');
	});

	it('falls back to a generic message when the body is not an API error', async () => {
		const { ctx } = createExecuteContext({
			responses: [{ statusCode: 502, body: '<html>Bad Gateway</html>', headers: {} }],
		});

		const error = await catchError(dattaCrmRequest.call(ctx, 'GET', '/leads'));

		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('Datta CRM returned HTTP 502');
	});

	it('wraps a transport failure in a NodeApiError', async () => {
		const { ctx } = createExecuteContext({ responses: [new Error('socket closed unexpectedly')] });

		const error = await catchError(dattaCrmRequest.call(ctx, 'GET', '/leads'));

		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('socket closed unexpectedly');
	});
});

describe('dattaCrmRequestPage', () => {
	it('returns the items and the next cursor', async () => {
		const { ctx, request } = createExecuteContext({
			responses: [page([{ id: '1' }, { id: '2' }], 'next')],
		});

		const result = await dattaCrmRequestPage.call(ctx, '/leads', { limit: 2 });

		expect(result).toEqual({ items: [{ id: '1' }, { id: '2' }], nextCursor: 'next' });
		expect(request.mock.calls[0][1].qs).toEqual({ limit: 2 });
	});

	it('returns a null cursor on the last page', async () => {
		const { ctx } = createExecuteContext({ responses: [page([{ id: '1' }], null)] });

		const result = await dattaCrmRequestPage.call(ctx, '/leads');

		expect(result.nextCursor).toBeNull();
	});
});

describe('dattaCrmRequestAll', () => {
	it('follows the cursor until it is null', async () => {
		const { ctx, request } = createExecuteContext({
			responses: [
				page([{ id: '1' }, { id: '2' }], 'A'),
				page([{ id: '3' }], 'B'),
				page([{ id: '4' }], null),
			],
		});

		const all = await dattaCrmRequestAll.call(ctx, '/leads', { tag: 'x' });

		expect(all.map((item) => item.id)).toEqual(['1', '2', '3', '4']);
		expect(request).toHaveBeenCalledTimes(3);
		expect(request.mock.calls.map((call) => call[1].qs)).toEqual([
			{ tag: 'x', limit: 200 },
			{ tag: 'x', limit: 200, cursor: 'A' },
			{ tag: 'x', limit: 200, cursor: 'B' },
		]);
	});

	it('stops at max items and shrinks the last page size', async () => {
		const makeItems = (count: number) =>
			Array.from({ length: count }, (_, index) => ({ id: String(index) }));
		const { ctx, request } = createExecuteContext({
			responses: [page(makeItems(200), 'A'), page(makeItems(50), 'B')],
		});

		const all = await dattaCrmRequestAll.call(ctx, '/leads', {}, 250);

		expect(all).toHaveLength(250);
		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls[0][1].qs).toEqual({ limit: 200 });
		expect(request.mock.calls[1][1].qs).toEqual({ limit: 50, cursor: 'A' });
	});

	it('pages with a smaller pageSize and never exceeds the 200 default', async () => {
		const { ctx, request } = createExecuteContext({
			responses: [page([{ id: '1' }], 'A'), page([{ id: '2' }], 'B'), page([{ id: '3' }], null)],
		});

		await dattaCrmRequestAll.call(ctx, '/email-campaigns', {}, undefined, 50);
		expect(request.mock.calls.map((call) => call[1].qs.limit)).toEqual([50, 50, 50]);

		const capped = createExecuteContext({ responses: [page([{ id: '1' }], null)] });
		await dattaCrmRequestAll.call(capped.ctx, '/leads', {}, undefined, 500);
		expect(capped.request.mock.calls[0][1].qs).toEqual({ limit: 200 });
	});

	it('returns an empty list without a request when max is zero or negative', async () => {
		const { ctx, request } = createExecuteContext({ responses: [page([{ id: '1' }], null)] });

		expect(await dattaCrmRequestAll.call(ctx, '/leads', {}, 0)).toEqual([]);
		expect(await dattaCrmRequestAll.call(ctx, '/leads', {}, -5)).toEqual([]);
		expect(request).not.toHaveBeenCalled();
	});

	it('truncates when the server returns more than requested', async () => {
		const { ctx } = createExecuteContext({
			responses: [page([{ id: '1' }, { id: '2' }, { id: '3' }], 'A')],
		});

		const all = await dattaCrmRequestAll.call(ctx, '/leads', {}, 2);

		expect(all.map((item) => item.id)).toEqual(['1', '2']);
	});
});

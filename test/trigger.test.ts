import { createHmac } from 'crypto';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { DattaCrmTrigger, buildFilters } from '../nodes/DattaCrmTrigger/DattaCrmTrigger.node';
import { apiError, createHookContext, createWebhookContext, ok, type HookOptions } from './helpers';

const WEBHOOK_URL = 'https://n8n.example.com/webhook/abc';
const TEST_URL = 'https://n8n.example.com/webhook-test/abc';
const methods = new DattaCrmTrigger().webhookMethods.default;

function webhook(overrides: Record<string, unknown> = {}) {
	return {
		id: 'wh-1',
		name: 'n8n · Workflow',
		targetUrl: WEBHOOK_URL,
		events: ['lead.created'],
		filters: {},
		status: 'active',
		ignoreOwnChanges: true,
		...overrides,
	};
}

/** Static data as the node stores it: one entry per target URL. */
function seeded(id = 'wh-1', secret = 'whsec_stored', url = WEBHOOK_URL) {
	return { webhooks: { [url]: { id, secret } } };
}

function hook(options: HookOptions = {}) {
	return createHookContext({ webhookUrl: WEBHOOK_URL, ...options });
}

function requestOptions(request: { mock: { calls: unknown[][] } }, n: number) {
	return request.mock.calls[n][1] as Record<string, unknown>;
}

function created(id: string, secret: string, url = WEBHOOK_URL) {
	return ok({ webhook: webhook({ id, targetUrl: url }), secret }, undefined, 201);
}

describe('buildFilters', () => {
	it('repeats the filters for every selected event', () => {
		expect(
			buildFilters(['sale.paid', 'deal.won'], { productId: 'a, b', tag: ['vip'], formId: [] }),
		).toEqual({
			'sale.paid': { productId: ['a', 'b'], tag: ['vip'] },
			'deal.won': { productId: ['a', 'b'], tag: ['vip'] },
		});
	});

	it('returns an empty object when no filter has values', () => {
		expect(buildFilters(['lead.created'], {})).toEqual({});
		expect(buildFilters(['lead.created'], { productId: '  ', tag: [] })).toEqual({});
	});

	it('ignores keys the node does not know', () => {
		expect(buildFilters(['lead.created'], { bogus: 'x' })).toEqual({});
	});
});

describe('description', () => {
	const { description } = new DattaCrmTrigger();

	it('is a webhook trigger with the required credential', () => {
		expect(description.name).toBe('dattaCrmTrigger');
		expect(description.group).toEqual(['trigger']);
		expect(description.inputs).toEqual([]);
		expect(description.credentials).toEqual([{ name: 'dattaCrmApi', required: true }]);
		expect(description.webhooks).toEqual([
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				responseData: 'noData',
				path: 'webhook',
			},
		]);
	});

	it('defaults to ignoring changes made by the same API key', () => {
		const prop = description.properties.find((p) => p.name === 'ignoreOwnChanges');
		expect(prop?.default).toBe(true);
		expect(prop?.displayName).toBe('Ignore Changes Made by This API Key');
	});

	it('requires events', () => {
		const prop = description.properties.find((p) => p.name === 'events');
		expect(prop?.required).toBe(true);
		expect(prop?.type).toBe('multiOptions');
	});
});

describe('checkExists', () => {
	it('returns false and removes the entry when the webhook is not in the list', async () => {
		const { ctx, staticData, request } = hook({
			staticData: seeded(),
			responses: [ok([webhook({ id: 'other' })])],
		});
		expect(await methods.checkExists.call(ctx)).toBe(false);
		expect(staticData).toEqual({ webhooks: {} });
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('returns false without a request when nothing is stored', async () => {
		const { ctx, request } = hook();
		expect(await methods.checkExists.call(ctx)).toBe(false);
		expect(request).not.toHaveBeenCalled();
	});

	it('returns false when the remote webhook has another target URL', async () => {
		const { ctx, staticData } = hook({
			staticData: seeded(),
			responses: [ok([webhook({ targetUrl: 'https://old.example.com/webhook/zzz' })])],
		});
		expect(await methods.checkExists.call(ctx)).toBe(false);
		expect(staticData).toEqual({ webhooks: {} });
	});

	it('returns true for an active webhook with the same URL', async () => {
		const { ctx, staticData, request } = hook({
			staticData: seeded(),
			responses: [ok([webhook()])],
		});
		expect(await methods.checkExists.call(ctx)).toBe(true);
		expect(staticData).toEqual(seeded());
		expect(requestOptions(request, 0)).toMatchObject({
			method: 'GET',
			url: 'https://crm.example.com/api/v1/webhooks',
		});
	});

	it('deletes a paused webhook, removes the entry and returns false', async () => {
		const { ctx, staticData, request } = hook({
			staticData: seeded(),
			responses: [ok([webhook({ status: 'paused' })]), ok({ deleted: true, id: 'wh-1' })],
		});
		expect(await methods.checkExists.call(ctx)).toBe(false);
		expect(request).toHaveBeenCalledTimes(2);
		expect(requestOptions(request, 1)).toMatchObject({
			method: 'DELETE',
			url: 'https://crm.example.com/api/v1/webhooks/wh-1',
		});
		expect(staticData).toEqual({ webhooks: {} });
	});

	it('tolerates a 404 while deleting a disabled webhook', async () => {
		const { ctx, staticData } = hook({
			staticData: seeded(),
			responses: [
				ok([webhook({ status: 'disabled' })]),
				apiError(404, 'not_found', 'Webhook nao encontrado.'),
			],
		});
		expect(await methods.checkExists.call(ctx)).toBe(false);
		expect(staticData).toEqual({ webhooks: {} });
	});

	it('rejects and keeps the entry when deleting a paused webhook fails with 500', async () => {
		const { ctx, staticData } = hook({
			staticData: seeded(),
			responses: [
				ok([webhook({ status: 'paused' })]),
				apiError(500, 'internal_error', 'Erro interno.'),
			],
		});
		await expect(methods.checkExists.call(ctx)).rejects.toMatchObject({
			message: 'Erro interno.',
			httpCode: '500',
		});
		expect(staticData).toEqual(seeded());
	});

	it('propagates a failed list request and keeps the entry', async () => {
		const { ctx, staticData } = hook({
			staticData: seeded(),
			responses: [apiError(401, 'invalid_api_key', 'Chave invalida.')],
		});
		await expect(methods.checkExists.call(ctx)).rejects.toBeInstanceOf(NodeApiError);
		expect(staticData).toEqual(seeded());
	});

	it('raises a clear error when the list response is not an array', async () => {
		const { ctx, staticData } = hook({
			staticData: seeded(),
			responses: [ok({ unexpected: true })],
		});
		const failure = await methods.checkExists.call(ctx).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(NodeApiError);
		expect((failure as NodeApiError).message).toBe('Unexpected response from Datta CRM');
		expect(staticData).toEqual(seeded());
	});

	it('only touches the entry of its own URL', async () => {
		const staticData = {
			webhooks: {
				...seeded('wh-prod', 'whsec_prod').webhooks,
				...seeded('wh-test', 'whsec_test', TEST_URL).webhooks,
			},
		};
		const { ctx } = hook({
			webhookUrl: TEST_URL,
			staticData,
			responses: [ok([webhook({ id: 'wh-prod' })])],
		});
		expect(await methods.checkExists.call(ctx)).toBe(false);
		expect(staticData.webhooks).toEqual(seeded('wh-prod', 'whsec_prod').webhooks);
	});
});

describe('create', () => {
	const otherUrl = 'https://n8n.example.com/webhook-test/other';
	it('posts the expected body and stores the id and secret under the URL', async () => {
		const { ctx, staticData, request } = hook({
			params: {
				events: ['sale.paid', 'deal.won'],
				filters: { productId: 'p1, p2', pipelineId: ['pipe-1'] },
			},
			workflow: { id: 'wf-1', name: 'My workflow', active: true },
			responses: [ok([]), created('wh-9', 'whsec_abc')],
		});
		expect(await methods.create.call(ctx)).toBe(true);
		expect(requestOptions(request, 1)).toMatchObject({
			method: 'POST',
			url: 'https://crm.example.com/api/v1/webhooks',
			body: {
				targetUrl: WEBHOOK_URL,
				events: ['sale.paid', 'deal.won'],
				filters: {
					'sale.paid': { productId: ['p1', 'p2'], pipelineId: ['pipe-1'] },
					'deal.won': { productId: ['p1', 'p2'], pipelineId: ['pipe-1'] },
				},
				ignoreOwnChanges: true,
				name: 'n8n · My workflow',
			},
		});
		expect(staticData).toEqual(seeded('wh-9', 'whsec_abc'));
	});

	it('omits filters when none are set and honours ignoreOwnChanges false', async () => {
		const { ctx, request } = hook({
			params: { events: ['lead.created'], ignoreOwnChanges: false },
			responses: [ok([]), created('wh-1', 's')],
		});
		await methods.create.call(ctx);
		const body = requestOptions(request, 1).body as Record<string, unknown>;
		expect(body).not.toHaveProperty('filters');
		expect(body.ignoreOwnChanges).toBe(false);
	});

	it('truncates the name to 80 characters without a trailing space', async () => {
		const { ctx, request } = hook({
			params: { events: ['lead.created'] },
			workflow: { id: 'wf-1', name: 'a'.repeat(73) + ' tail words', active: true },
			responses: [ok([]), created('wh-1', 's')],
		});
		await methods.create.call(ctx);
		const name = (requestOptions(request, 1).body as { name: string }).name;
		expect(name).toBe('n8n · ' + 'a'.repeat(73));
		expect(Array.from(name)).toHaveLength(79);
	});

	it('truncates by code points so an emoji is never split', async () => {
		const { ctx, request } = hook({
			params: { events: ['lead.created'] },
			workflow: { id: 'wf-1', name: '\u{1F600}'.repeat(100), active: true },
			responses: [ok([]), created('wh-1', 's')],
		});
		await methods.create.call(ctx);
		const name = (requestOptions(request, 1).body as { name: string }).name;
		expect(name).toBe('n8n · ' + '\u{1F600}'.repeat(74));
		expect(Array.from(name)).toHaveLength(80);
		expect(name.isWellFormed()).toBe(true);
	});

	it('falls back to "n8n" when the workflow has no name', async () => {
		const { ctx, request } = hook({
			params: { events: ['lead.created'] },
			workflow: { id: 'wf-1', name: '', active: true },
			responses: [ok([]), created('wh-1', 's')],
		});
		await methods.create.call(ctx);
		expect((requestOptions(request, 1).body as { name: string }).name).toBe('n8n');
	});

	it('throws before calling the API when no event is selected', async () => {
		const { ctx, request, staticData } = hook({ params: { events: [] } });
		await expect(methods.create.call(ctx)).rejects.toBeInstanceOf(NodeOperationError);
		await expect(methods.create.call(ctx)).rejects.toThrow('Choose at least one event');
		expect(request).not.toHaveBeenCalled();
		expect(staticData).toEqual({});
	});

	it('lets an API error propagate and stores nothing', async () => {
		const { ctx, staticData } = hook({
			params: { events: ['lead.created'] },
			responses: [
				ok([]),
				apiError(400, 'validation_error', 'invalid_target_url: use HTTPS on port 443.'),
			],
		});
		await expect(methods.create.call(ctx)).rejects.toMatchObject({
			message: 'invalid_target_url: use HTTPS on port 443.',
		});
		expect(staticData).toEqual({});
	});

	it.each([
		['no webhook', { secret: 's' }],
		['a webhook without an id', { webhook: {}, secret: 's' }],
		['a non-string id', { webhook: { id: 7 }, secret: 's' }],
		['no secret', { webhook: { id: 'wh-1' } }],
		['an empty secret', { webhook: { id: 'wh-1' }, secret: '' }],
		['a null body', null],
	])('raises a clear error and stores nothing when the response has %s', async (_label, data) => {
		const { ctx, staticData } = hook({
			params: { events: ['lead.created'] },
			responses: [ok([]), ok(data, undefined, 201)],
		});
		const failure = await methods.create.call(ctx).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(NodeApiError);
		expect((failure as NodeApiError).message).toBe('Unexpected response from Datta CRM');
		expect(staticData).toEqual({});
	});

	it('deletes stale webhooks registered for the same URL before creating', async () => {
		const { ctx, staticData, request } = hook({
			params: { events: ['lead.created'] },
			responses: [
				ok([
					webhook({ id: 'stale-1' }),
					webhook({ id: 'other-url', targetUrl: otherUrl }),
					webhook({ id: 'stale-2', status: 'paused' }),
				]),
				ok({ deleted: true, id: 'stale-1' }),
				ok({ deleted: true, id: 'stale-2' }),
				created('wh-new', 'whsec_new'),
			],
		});
		expect(await methods.create.call(ctx)).toBe(true);

		const calls = request.mock.calls.map((call) => call[1] as { method: string; url: string });
		expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
			'GET https://crm.example.com/api/v1/webhooks',
			'DELETE https://crm.example.com/api/v1/webhooks/stale-1',
			'DELETE https://crm.example.com/api/v1/webhooks/stale-2',
			'POST https://crm.example.com/api/v1/webhooks',
		]);
		expect(staticData).toEqual(seeded('wh-new', 'whsec_new'));
	});

	it('never touches webhooks of other URLs', async () => {
		const { ctx, request } = hook({
			params: { events: ['lead.created'] },
			responses: [
				ok([
					webhook({ id: 'prod', targetUrl: 'https://n8n.example.com/webhook/abc/' }),
					webhook({ id: 'test', targetUrl: otherUrl }),
				]),
				created('wh-new', 's'),
			],
		});
		await methods.create.call(ctx);
		const methodsCalled = request.mock.calls.map((call) => (call[1] as { method: string }).method);
		expect(methodsCalled).toEqual(['GET', 'POST']);
	});

	it('ignores a 404 when deleting a stale webhook', async () => {
		const { ctx, staticData } = hook({
			params: { events: ['lead.created'] },
			responses: [
				ok([webhook({ id: 'gone' })]),
				apiError(404, 'not_found', 'Webhook não encontrado.'),
				created('wh-new', 's'),
			],
		});
		expect(await methods.create.call(ctx)).toBe(true);
		expect(staticData).toEqual(seeded('wh-new', 's'));
	});

	it('does not create when a stale webhook cannot be deleted', async () => {
		const { ctx, request, staticData } = hook({
			params: { events: ['lead.created'] },
			responses: [ok([webhook({ id: 'stale' })]), apiError(500, 'internal_error', 'Erro interno.')],
		});
		await expect(methods.create.call(ctx)).rejects.toMatchObject({ message: 'Erro interno.' });
		expect(request).toHaveBeenCalledTimes(2);
		expect(staticData).toEqual({});
	});

	it('raises a clear error when GET /webhooks does not return a list', async () => {
		const { ctx, request } = hook({
			params: { events: ['lead.created'] },
			responses: [ok({ not: 'a list' })],
		});
		await expect(methods.create.call(ctx)).rejects.toThrow('Unexpected response from Datta CRM');
		expect(request).toHaveBeenCalledTimes(1);
	});
});

describe('delete', () => {
	it('deletes the webhook and removes the entry', async () => {
		const { ctx, staticData, request } = hook({
			staticData: seeded(),
			responses: [ok({ deleted: true, id: 'wh-1' })],
		});
		expect(await methods.delete.call(ctx)).toBe(true);
		expect(requestOptions(request, 0)).toMatchObject({
			method: 'DELETE',
			url: 'https://crm.example.com/api/v1/webhooks/wh-1',
		});
		expect(staticData).toEqual({ webhooks: {} });
	});

	it('treats a 404 as success and removes the entry', async () => {
		const { ctx, staticData } = hook({
			staticData: seeded(),
			responses: [apiError(404, 'not_found', 'Webhook nao encontrado.')],
		});
		expect(await methods.delete.call(ctx)).toBe(true);
		expect(staticData).toEqual({ webhooks: {} });
	});

	it('returns false on a 500, keeps the entry and logs without the secret', async () => {
		const { ctx, staticData, logger } = hook({
			staticData: seeded('wh-1', 'whsec_do_not_log'),
			responses: [apiError(500, 'internal_error', 'Erro interno.')],
		});
		expect(await methods.delete.call(ctx)).toBe(false);
		expect(staticData).toEqual(seeded('wh-1', 'whsec_do_not_log'));
		expect(logger.error).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain('whsec_do_not_log');
	});

	it('returns false on a transport failure', async () => {
		const { ctx, staticData } = hook({
			staticData: seeded(),
			responses: [new Error('socket closed unexpectedly')],
		});
		expect(await methods.delete.call(ctx)).toBe(false);
		expect(staticData).toEqual(seeded());
	});

	it('returns true without a request when nothing is stored', async () => {
		const { ctx, request } = hook();
		expect(await methods.delete.call(ctx)).toBe(true);
		expect(request).not.toHaveBeenCalled();
	});
});

describe('test and production URLs share static data', () => {
	const trigger = new DattaCrmTrigger();
	const prodSecret = 'whsec_production';
	const testSecret = 'whsec_test_run';
	const payload = { id: 'evt_1', event: 'lead.created', data: { id: 'l1' } };
	const raw = Buffer.from(JSON.stringify(payload), 'utf8');
	const sign = (secret: string) =>
		`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

	it('keeps the production entry through a full test-URL cycle', async () => {
		const staticData = seeded('wh-prod', prodSecret) as Record<string, unknown>;
		const prodEntry = { ...seeded('wh-prod', prodSecret).webhooks };

		// "Listen for test event": checkExists (nothing for the test URL) -> create.
		const first = hook({ webhookUrl: TEST_URL, staticData, responses: [] });
		expect(await methods.checkExists.call(first.ctx)).toBe(false);
		expect(first.request).not.toHaveBeenCalled();

		const second = hook({
			webhookUrl: TEST_URL,
			staticData,
			params: { events: ['lead.created'] },
			responses: [ok([]), created('wh-test', testSecret, TEST_URL)],
		});
		expect(await methods.create.call(second.ctx)).toBe(true);
		expect(staticData.webhooks).toEqual({
			...prodEntry,
			...seeded('wh-test', testSecret, TEST_URL).webhooks,
		});

		// A test delivery is verified with the test secret.
		const delivery = createWebhookContext({
			webhookUrl: TEST_URL,
			staticData,
			req: { body: payload, rawBody: raw, headers: { 'x-crm-signature': sign(testSecret) } },
		});
		expect(await trigger.webhook.call(delivery.ctx)).toEqual({
			workflowData: [[{ json: payload }]],
		});

		// Stop listening: delete only removes the test entry.
		const third = hook({
			webhookUrl: TEST_URL,
			staticData,
			responses: [ok({ deleted: true, id: 'wh-test' })],
		});
		expect(await methods.delete.call(third.ctx)).toBe(true);
		expect(requestOptions(third.request, 0)).toMatchObject({
			url: 'https://crm.example.com/api/v1/webhooks/wh-test',
		});
		expect(staticData.webhooks).toEqual(prodEntry);

		// Production still verifies and is still reported as existing.
		const prodDelivery = createWebhookContext({
			webhookUrl: WEBHOOK_URL,
			staticData,
			req: { body: payload, rawBody: raw, headers: { 'x-crm-signature': sign(prodSecret) } },
		});
		expect(await trigger.webhook.call(prodDelivery.ctx)).toEqual({
			workflowData: [[{ json: payload }]],
		});
		const fourth = hook({ staticData, responses: [ok([webhook({ id: 'wh-prod' })])] });
		expect(await methods.checkExists.call(fourth.ctx)).toBe(true);
	});

	it('verifies a production delivery with the production secret while a test entry exists', async () => {
		const staticData = {
			webhooks: {
				...seeded('wh-prod', prodSecret).webhooks,
				...seeded('wh-test', testSecret, TEST_URL).webhooks,
			},
		};
		const good = createWebhookContext({
			webhookUrl: WEBHOOK_URL,
			staticData,
			req: { body: payload, rawBody: raw, headers: { 'x-crm-signature': sign(prodSecret) } },
		});
		expect(await trigger.webhook.call(good.ctx)).toEqual({ workflowData: [[{ json: payload }]] });

		// The test secret is not accepted at the production URL.
		const bad = createWebhookContext({
			webhookUrl: WEBHOOK_URL,
			staticData,
			req: { body: payload, rawBody: raw, headers: { 'x-crm-signature': sign(testSecret) } },
		});
		expect(await trigger.webhook.call(bad.ctx)).toEqual({ noWebhookResponse: true });
		expect(bad.response.statusCode).toBe(401);
	});
});

describe('webhook()', () => {
	const trigger = new DattaCrmTrigger();
	const secret = 'whsec_secret';
	const payload = { id: 'evt_1', event: 'lead.created', data: { id: 'l1' } };
	const raw = Buffer.from(JSON.stringify(payload), 'utf8');
	const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
	const stored = () => seeded('wh-1', secret);

	it('rejects a request without a signature with 401', async () => {
		const { ctx, response } = createWebhookContext({
			webhookUrl: WEBHOOK_URL,
			staticData: stored(),
			req: { body: payload, rawBody: raw, headers: {} },
		});
		const result = await trigger.webhook.call(ctx);
		expect(result).toEqual({ noWebhookResponse: true });
		expect(result).not.toHaveProperty('workflowData');
		expect(response.statusCode).toBe(401);
		expect(response.sent).toEqual(['Invalid signature']);
		expect(response.ended).toBe(true);
	});

	it('rejects a malformed signature', async () => {
		const { ctx, response } = createWebhookContext({
			webhookUrl: WEBHOOK_URL,
			staticData: stored(),
			req: { body: payload, rawBody: raw, headers: { 'x-crm-signature': 'sha256=deadbeef' } },
		});
		expect(await trigger.webhook.call(ctx)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('rejects a same-length (64 hex) wrong digest', async () => {
		const wrong = `sha256=${createHmac('sha256', 'another secret').update(raw).digest('hex')}`;
		expect(wrong).toHaveLength(signature.length);
		const { ctx, response } = createWebhookContext({
			webhookUrl: WEBHOOK_URL,
			staticData: stored(),
			req: { body: payload, rawBody: raw, headers: { 'x-crm-signature': wrong } },
		});
		expect(await trigger.webhook.call(ctx)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('rejects when the raw body is unavailable, even with a signature of the parsed body', async () => {
		const { ctx, response } = createWebhookContext({
			webhookUrl: WEBHOOK_URL,
			staticData: stored(),
			req: { body: payload, headers: { 'x-crm-signature': signature } },
		});
		expect(await trigger.webhook.call(ctx)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('rejects when no secret is stored for this URL', async () => {
		const { ctx, response } = createWebhookContext({
			webhookUrl: TEST_URL,
			staticData: stored(),
			req: { body: payload, rawBody: raw, headers: { 'x-crm-signature': signature } },
		});
		expect(await trigger.webhook.call(ctx)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('returns the body as workflow data for a valid signature', async () => {
		const { ctx, response } = createWebhookContext({
			webhookUrl: WEBHOOK_URL,
			staticData: stored(),
			req: { body: payload, rawBody: raw, headers: { 'x-crm-signature': signature } },
		});
		const result = await trigger.webhook.call(ctx);
		expect(result).toEqual({ workflowData: [[{ json: payload }]] });
		expect(response.statusCode).toBeUndefined();
	});
});

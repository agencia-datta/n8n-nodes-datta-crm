import { createHmac } from 'crypto';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { DattaCrmTrigger, buildFilters } from '../nodes/DattaCrmTrigger/DattaCrmTrigger.node';
import { apiError, createHookContext, createWebhookContext, ok, type HookOptions } from './helpers';

const WEBHOOK_URL = 'https://n8n.example.com/webhook/abc';
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

function hook(options: HookOptions = {}) {
	return createHookContext({ webhookUrl: WEBHOOK_URL, ...options });
}

function requestOptions(request: { mock: { calls: unknown[][] } }, n: number) {
	return request.mock.calls[n][1] as Record<string, unknown>;
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
			{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' },
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
	it('returns false and clears static data when the webhook is not in the list', async () => {
		const { ctx, staticData, request } = hook({
			staticData: { webhookId: 'wh-1', webhookSecret: 's' },
			responses: [ok([webhook({ id: 'other' })])],
		});
		expect(await methods.checkExists.call(ctx)).toBe(false);
		expect(staticData).toEqual({});
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('returns false without a request when nothing is stored', async () => {
		const { ctx, request } = hook();
		expect(await methods.checkExists.call(ctx)).toBe(false);
		expect(request).not.toHaveBeenCalled();
	});

	it('returns false when the stored id points at another target URL', async () => {
		const { ctx, staticData } = hook({
			staticData: { webhookId: 'wh-1', webhookSecret: 's' },
			responses: [ok([webhook({ targetUrl: 'https://old.example.com/webhook/zzz' })])],
		});
		expect(await methods.checkExists.call(ctx)).toBe(false);
		expect(staticData).toEqual({});
	});

	it('returns true for an active webhook with the same URL', async () => {
		const { ctx, staticData, request } = hook({
			staticData: { webhookId: 'wh-1', webhookSecret: 's' },
			responses: [ok([webhook()])],
		});
		expect(await methods.checkExists.call(ctx)).toBe(true);
		expect(staticData).toEqual({ webhookId: 'wh-1', webhookSecret: 's' });
		expect(requestOptions(request, 0)).toMatchObject({
			method: 'GET',
			url: 'https://crm.example.com/api/v1/webhooks',
		});
	});

	it('deletes a paused webhook, clears static data and returns false', async () => {
		const { ctx, staticData, request } = hook({
			staticData: { webhookId: 'wh-1', webhookSecret: 's' },
			responses: [ok([webhook({ status: 'paused' })]), ok({ deleted: true, id: 'wh-1' })],
		});
		expect(await methods.checkExists.call(ctx)).toBe(false);
		expect(request).toHaveBeenCalledTimes(2);
		expect(requestOptions(request, 1)).toMatchObject({
			method: 'DELETE',
			url: 'https://crm.example.com/api/v1/webhooks/wh-1',
		});
		expect(staticData).toEqual({});
	});

	it('tolerates a 404 while deleting a disabled webhook', async () => {
		const { ctx, staticData } = hook({
			staticData: { webhookId: 'wh-1', webhookSecret: 's' },
			responses: [
				ok([webhook({ status: 'disabled' })]),
				apiError(404, 'not_found', 'Webhook nao encontrado.'),
			],
		});
		expect(await methods.checkExists.call(ctx)).toBe(false);
		expect(staticData).toEqual({});
	});

	it('propagates a failed list request and keeps static data', async () => {
		const { ctx, staticData } = hook({
			staticData: { webhookId: 'wh-1', webhookSecret: 's' },
			responses: [apiError(401, 'invalid_api_key', 'Chave invalida.')],
		});
		await expect(methods.checkExists.call(ctx)).rejects.toBeInstanceOf(NodeApiError);
		expect(staticData).toEqual({ webhookId: 'wh-1', webhookSecret: 's' });
	});
});

describe('create', () => {
	it('posts the expected body and stores the id and secret', async () => {
		const { ctx, staticData, request } = hook({
			params: {
				events: ['sale.paid', 'deal.won'],
				filters: { productId: 'p1, p2', pipelineId: ['pipe-1'] },
			},
			workflow: { id: 'wf-1', name: 'My workflow', active: true },
			responses: [ok({ webhook: webhook({ id: 'wh-9' }), secret: 'whsec_abc' }, undefined, 201)],
		});
		expect(await methods.create.call(ctx)).toBe(true);
		expect(requestOptions(request, 0)).toMatchObject({
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
		expect(staticData).toEqual({ webhookId: 'wh-9', webhookSecret: 'whsec_abc' });
	});

	it('omits filters when none are set and honours ignoreOwnChanges false', async () => {
		const { ctx, request } = hook({
			params: { events: ['lead.created'], ignoreOwnChanges: false },
			responses: [ok({ webhook: webhook(), secret: 's' }, undefined, 201)],
		});
		await methods.create.call(ctx);
		const body = requestOptions(request, 0).body as Record<string, unknown>;
		expect(body).not.toHaveProperty('filters');
		expect(body.ignoreOwnChanges).toBe(false);
	});

	it('truncates the name to 80 characters without a trailing space', async () => {
		const { ctx, request } = hook({
			params: { events: ['lead.created'] },
			workflow: { id: 'wf-1', name: 'a'.repeat(73) + ' tail words', active: true },
			responses: [ok({ webhook: webhook(), secret: 's' }, undefined, 201)],
		});
		await methods.create.call(ctx);
		const name = (requestOptions(request, 0).body as { name: string }).name;
		expect(name.length).toBeLessThanOrEqual(80);
		expect(name.startsWith('n8n · ')).toBe(true);
		expect(name).toBe(name.trimEnd());
	});

	it('falls back to "n8n" when the workflow has no name', async () => {
		const { ctx, request } = hook({
			params: { events: ['lead.created'] },
			workflow: { id: 'wf-1', name: '', active: true },
			responses: [ok({ webhook: webhook(), secret: 's' }, undefined, 201)],
		});
		await methods.create.call(ctx);
		expect((requestOptions(request, 0).body as { name: string }).name).toBe('n8n');
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
			responses: [apiError(400, 'validation_error', 'invalid_target_url: use HTTPS on port 443.')],
		});
		await expect(methods.create.call(ctx)).rejects.toMatchObject({
			message: 'invalid_target_url: use HTTPS on port 443.',
		});
		expect(staticData).toEqual({});
	});
});

describe('delete', () => {
	const stored = { webhookId: 'wh-1', webhookSecret: 'whsec_do_not_log' };

	it('deletes the webhook and clears static data', async () => {
		const { ctx, staticData, request } = hook({
			staticData: { ...stored },
			responses: [ok({ deleted: true, id: 'wh-1' })],
		});
		expect(await methods.delete.call(ctx)).toBe(true);
		expect(requestOptions(request, 0)).toMatchObject({
			method: 'DELETE',
			url: 'https://crm.example.com/api/v1/webhooks/wh-1',
		});
		expect(staticData).toEqual({});
	});

	it('treats a 404 as success and clears static data', async () => {
		const { ctx, staticData } = hook({
			staticData: { ...stored },
			responses: [apiError(404, 'not_found', 'Webhook nao encontrado.')],
		});
		expect(await methods.delete.call(ctx)).toBe(true);
		expect(staticData).toEqual({});
	});

	it('returns false on a 500, keeps static data and logs without the secret', async () => {
		const { ctx, staticData, logger } = hook({
			staticData: { ...stored },
			responses: [apiError(500, 'internal_error', 'Erro interno.')],
		});
		expect(await methods.delete.call(ctx)).toBe(false);
		expect(staticData).toEqual(stored);
		expect(logger.error).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(logger.error.mock.calls)).not.toContain(stored.webhookSecret);
	});

	it('returns false on a transport failure', async () => {
		const { ctx, staticData } = hook({
			staticData: { ...stored },
			responses: [new Error('socket closed unexpectedly')],
		});
		expect(await methods.delete.call(ctx)).toBe(false);
		expect(staticData).toEqual(stored);
	});

	it('returns true without a request when nothing is stored', async () => {
		const { ctx, request } = hook();
		expect(await methods.delete.call(ctx)).toBe(true);
		expect(request).not.toHaveBeenCalled();
	});
});

describe('webhook()', () => {
	const trigger = new DattaCrmTrigger();
	const secret = 'whsec_secret';
	const payload = { id: 'evt_1', event: 'lead.created', data: { id: 'l1' } };
	const raw = Buffer.from(JSON.stringify(payload), 'utf8');
	const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

	it('rejects a request without a signature with 401', async () => {
		const { ctx, response } = createWebhookContext({
			staticData: { webhookSecret: secret },
			req: { body: payload, rawBody: raw, headers: {} },
		});
		const result = await trigger.webhook.call(ctx);
		expect(result).toEqual({ noWebhookResponse: true });
		expect(result).not.toHaveProperty('workflowData');
		expect(response.statusCode).toBe(401);
		expect(response.sent).toEqual(['Invalid signature']);
		expect(response.ended).toBe(true);
	});

	it('rejects a wrong signature', async () => {
		const { ctx, response } = createWebhookContext({
			staticData: { webhookSecret: secret },
			req: { body: payload, rawBody: raw, headers: { 'x-crm-signature': 'sha256=deadbeef' } },
		});
		expect(await trigger.webhook.call(ctx)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('rejects when the raw body is unavailable, even with a signature of the parsed body', async () => {
		const { ctx, response } = createWebhookContext({
			staticData: { webhookSecret: secret },
			req: { body: payload, headers: { 'x-crm-signature': signature } },
		});
		expect(await trigger.webhook.call(ctx)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('rejects when no secret is stored', async () => {
		const { ctx, response } = createWebhookContext({
			req: { body: payload, rawBody: raw, headers: { 'x-crm-signature': signature } },
		});
		expect(await trigger.webhook.call(ctx)).toEqual({ noWebhookResponse: true });
		expect(response.statusCode).toBe(401);
	});

	it('returns the body as workflow data for a valid signature', async () => {
		const { ctx, response } = createWebhookContext({
			staticData: { webhookSecret: secret },
			req: { body: payload, rawBody: raw, headers: { 'x-crm-signature': signature } },
		});
		const result = await trigger.webhook.call(ctx);
		expect(result).toEqual({ workflowData: [[{ json: payload }]] });
		expect(response.statusCode).toBeUndefined();
	});
});

import { describe, expect, it } from 'vitest';
import {
	createExecuteContext,
	createHookContext,
	createLoadOptionsContext,
	createWebhookContext,
} from './helpers';

describe('getNodeParameter in the mock contexts', () => {
	it('execute: (name, itemIndex, fallback) reads per-item params and dotted names', () => {
		const { ctx } = createExecuteContext({
			params: [{ a: { b: 'first' } }, { a: { b: 'second' } }],
		});

		expect(ctx.getNodeParameter('a.b', 0)).toBe('first');
		expect(ctx.getNodeParameter('a.b', 1)).toBe('second');
		expect(ctx.getNodeParameter('missing', 1, 'fallback')).toBe('fallback');
	});

	it('load options: (name, fallback) has no item index', () => {
		const { ctx } = createLoadOptionsContext({ params: { resource: 'lead' } });

		expect(ctx.getNodeParameter('resource')).toBe('lead');
		expect(ctx.getNodeParameter('missing', true)).toBe(true);
	});

	it('hook: (name, fallback) has no item index', () => {
		const { ctx } = createHookContext({ params: { events: ['lead.created'] } });

		expect(ctx.getNodeParameter('events')).toEqual(['lead.created']);
		expect(ctx.getNodeParameter('ignoreOwnChanges', true)).toBe(true);
	});

	it('webhook: (name, fallback) has no item index', () => {
		const { ctx } = createWebhookContext({ params: { secret: 'x' } });

		expect(ctx.getNodeParameter('secret')).toBe('x');
		expect(ctx.getNodeParameter('missing', false)).toBe(false);
	});

	it('throws for a missing parameter without a fallback, like n8n', () => {
		const execute = createExecuteContext({ params: {} }).ctx;
		const hook = createHookContext({ params: {} }).ctx;

		expect(() => execute.getNodeParameter('missing', 0)).toThrow('Could not get parameter');
		expect(() => hook.getNodeParameter('missing')).toThrow('Could not get parameter');
	});

	it('an explicit undefined fallback does not throw', () => {
		const { ctx } = createExecuteContext({ params: {} });

		expect(ctx.getNodeParameter('missing', 0, undefined)).toBeUndefined();
	});
});

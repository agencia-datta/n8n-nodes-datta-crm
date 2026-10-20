import { describe, expect, it } from 'vitest';
import { NodeOperationError } from 'n8n-workflow';
import {
	buildCustomFields,
	compact,
	parseJsonParameter,
	toIsoDate,
	toStringArray,
} from '../nodes/DattaCrm/shared/utils';
import { createExecuteContext, ok } from './helpers';

const catalog = ok([
	{ key: 'plano', label: 'Plan', type: 'text', options: [] },
	{ key: 'idade', label: 'Age', type: 'number', options: [] },
	{ key: 'vip', label: 'VIP', type: 'boolean', options: [] },
	{ key: 'interesses', label: 'Interests', type: 'multi_select', options: [] },
	{ key: 'nascimento', label: 'Birth date', type: 'date', options: [] },
]);

describe('toStringArray', () => {
	it('accepts a multiOptions array, an expression array and a comma separated string', () => {
		expect(toStringArray(['a', 'b'])).toEqual(['a', 'b']);
		expect(toStringArray([' a ', '', 'b'])).toEqual(['a', 'b']);
		expect(toStringArray('a, b ,, c')).toEqual(['a', 'b', 'c']);
		expect(toStringArray(undefined)).toEqual([]);
		expect(toStringArray('')).toEqual([]);
		expect(toStringArray([1, 2])).toEqual(['1', '2']);
	});
});

describe('compact', () => {
	it('drops undefined, empty strings, empty arrays and empty objects but keeps 0, false and null', () => {
		expect(
			compact({
				a: undefined,
				b: '',
				c: [],
				d: {},
				e: 0,
				f: false,
				g: null,
				h: 'x',
				i: ['y'],
				j: { k: 1 },
			}),
		).toEqual({ e: 0, f: false, g: null, h: 'x', i: ['y'], j: { k: 1 } });
	});
});

describe('toIsoDate', () => {
	it('converts n8n date strings to ISO and returns undefined when empty', () => {
		const { ctx } = createExecuteContext({});
		expect(toIsoDate(ctx, '2026-10-20T10:00:00.000Z', 'Updated Since', 0)).toBe(
			'2026-10-20T10:00:00.000Z',
		);
		expect(toIsoDate(ctx, '', 'Updated Since', 0)).toBeUndefined();
		expect(toIsoDate(ctx, undefined, 'Updated Since', 0)).toBeUndefined();
	});

	function iso(timezone: string, value: string): string | undefined {
		const { ctx } = createExecuteContext({ timezone });
		return toIsoDate(ctx, value, 'Occurred At', 0);
	}

	it('reads a zone-less value in the workflow timezone, not the OS one', () => {
		expect(iso('UTC', '2026-10-20T10:05:00')).toBe('2026-10-20T10:05:00.000Z');
		// Sao Paulo is UTC-3 all year since 2019.
		expect(iso('America/Sao_Paulo', '2026-10-20T10:05:00')).toBe('2026-10-20T13:05:00.000Z');
		expect(iso('America/Sao_Paulo', '2026-10-20T10:05:00.250')).toBe('2026-10-20T13:05:00.250Z');
		expect(iso('America/Sao_Paulo', '2026-10-20 10:05')).toBe('2026-10-20T13:05:00.000Z');
		expect(iso('Asia/Kolkata', '2026-10-20T10:05:00')).toBe('2026-10-20T04:35:00.000Z');
		expect(iso('America/Sao_Paulo', '2026-10-20')).toBe('2026-10-20T03:00:00.000Z');
	});

	it('handles daylight saving time on both sides of a change', () => {
		// US clocks jump forward on 2026-03-08 at 02:00 (EST UTC-5 -> EDT UTC-4).
		expect(iso('America/New_York', '2026-03-08T01:30:00')).toBe('2026-03-08T06:30:00.000Z');
		expect(iso('America/New_York', '2026-03-08T03:30:00')).toBe('2026-03-08T07:30:00.000Z');
		expect(iso('America/New_York', '2026-03-07T12:00:00')).toBe('2026-03-07T17:00:00.000Z');
		expect(iso('America/New_York', '2026-03-09T12:00:00')).toBe('2026-03-09T16:00:00.000Z');
		// ... and back on 2026-11-01 at 02:00 (EDT -> EST).
		expect(iso('America/New_York', '2026-11-01T00:30:00')).toBe('2026-11-01T04:30:00.000Z');
		expect(iso('America/New_York', '2026-11-01T12:00:00')).toBe('2026-11-01T17:00:00.000Z');
	});

	it('keeps an explicit zone or offset whatever the workflow timezone is', () => {
		expect(iso('America/Sao_Paulo', '2026-10-20T10:05:00Z')).toBe('2026-10-20T10:05:00.000Z');
		expect(iso('America/Sao_Paulo', '2026-10-20T10:05:00+03:00')).toBe('2026-10-20T07:05:00.000Z');
		expect(iso('America/New_York', '2026-10-20T10:05:00.000-02:00')).toBe(
			'2026-10-20T12:05:00.000Z',
		);
	});

	it('rejects an impossible zone-less date', () => {
		expect(() => iso('UTC', '2026-02-30T10:00:00')).toThrow('is not a valid date');
		expect(() => iso('UTC', '2026-10-20T25:00:00')).toThrow('is not a valid date');
	});

	it('throws a clear error for an unknown workflow timezone', () => {
		expect(() => iso('Mars/Olympus', '2026-10-20T10:00:00')).toThrow(
			'The workflow timezone is not valid',
		);
	});

	it('throws a NodeOperationError for an invalid date', () => {
		const { ctx } = createExecuteContext({});
		expect(() => toIsoDate(ctx, 'next tuesday', 'Updated Since', 0)).toThrow(NodeOperationError);
		expect(() => toIsoDate(ctx, 'next tuesday', 'Updated Since', 0)).toThrow(
			'"Updated Since" is not a valid date',
		);
	});
});

describe('parseJsonParameter', () => {
	it('parses a JSON string and passes objects through', () => {
		const { ctx } = createExecuteContext({});
		expect(parseJsonParameter(ctx, '{"a":1}', 'Fields', 0)).toEqual({ a: 1 });
		expect(parseJsonParameter(ctx, [{ a: 1 }], 'Fields', 0)).toEqual([{ a: 1 }]);
	});

	it('throws a NodeOperationError for invalid JSON', () => {
		const { ctx } = createExecuteContext({});
		expect(() => parseJsonParameter(ctx, '{nope', 'Fields', 0)).toThrow(NodeOperationError);
		expect(() => parseJsonParameter(ctx, '{nope', 'Fields', 0)).toThrow(
			'"Fields" is not valid JSON',
		);
	});
});

describe('buildCustomFields', () => {
	it('types values using the custom field catalog', async () => {
		const { ctx, request } = createExecuteContext({ responses: [catalog] });
		const result = await buildCustomFields(ctx, [
			{ key: 'plano', value: 'ouro' },
			{ key: 'idade', value: '12.5' },
			{ key: 'vip', value: 'yes' },
			{ key: 'interesses', value: 'a, b' },
			{ key: 'nascimento', value: '1990-01-31' },
		]);

		expect(result).toEqual({
			plano: 'ouro',
			idade: 12.5,
			vip: true,
			interesses: ['a', 'b'],
			nascimento: '1990-01-31',
		});
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0][1]).toMatchObject({
			method: 'GET',
			url: 'https://crm.example.com/api/v1/custom-fields',
		});
	});

	it('understands the boolean spellings true/1/yes and false/0/no', async () => {
		const { ctx } = createExecuteContext({ responses: [catalog] });
		const result = await buildCustomFields(ctx, [{ key: 'vip', value: 'NO' }]);
		expect(result).toEqual({ vip: false });
		expect(await buildCustomFields(ctx, [{ key: 'vip', value: '1' }])).toEqual({ vip: true });
		expect(await buildCustomFields(ctx, [{ key: 'vip', value: 'false' }])).toEqual({ vip: false });
		expect(await buildCustomFields(ctx, [{ key: 'vip', value: true }])).toEqual({ vip: true });
	});

	it('passes an array expression through for multi_select and numbers for number', async () => {
		const { ctx } = createExecuteContext({ responses: [catalog] });
		const result = await buildCustomFields(ctx, [
			{ key: 'interesses', value: ['x', 'y'] },
			{ key: 'idade', value: 7 },
		]);
		expect(result).toEqual({ interesses: ['x', 'y'], idade: 7 });
	});

	it('matches keys case-insensitively and keeps unknown keys as-is', async () => {
		const { ctx } = createExecuteContext({ responses: [catalog] });
		const result = await buildCustomFields(ctx, [
			{ key: 'IDADE', value: '3' },
			{ key: 'other', value: '5' },
		]);
		expect(result).toEqual({ IDADE: 3, other: '5' });
	});

	it('skips entries without a key', async () => {
		const { ctx, request } = createExecuteContext({ responses: [catalog] });
		expect(await buildCustomFields(ctx, [{ key: '', value: 'x' }])).toEqual({});
		expect(request).not.toHaveBeenCalled();
	});

	it('throws a NodeOperationError for an invalid number or boolean', async () => {
		const { ctx } = createExecuteContext({ responses: [catalog] });
		await expect(buildCustomFields(ctx, [{ key: 'idade', value: 'abc' }])).rejects.toThrow(
			NodeOperationError,
		);
		await expect(buildCustomFields(ctx, [{ key: 'idade', value: 'abc' }])).rejects.toThrow(
			'"Age" must be a number',
		);
		await expect(buildCustomFields(ctx, [{ key: 'vip', value: 'maybe' }])).rejects.toThrow(
			'"VIP" must be true or false',
		);
	});

	it('fetches the catalog once per execution context', async () => {
		const { ctx, request } = createExecuteContext({ responses: [catalog] });
		await buildCustomFields(ctx, [{ key: 'plano', value: 'a' }]);
		await buildCustomFields(ctx, [{ key: 'plano', value: 'b' }]);
		expect(request).toHaveBeenCalledTimes(1);
	});
});

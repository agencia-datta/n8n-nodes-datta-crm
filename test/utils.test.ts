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
		expect(toIsoDate(ctx, '2026-10-20T10:00:00', 'Updated Since', 0)).toBe(
			new Date('2026-10-20T10:00:00').toISOString(),
		);
		expect(toIsoDate(ctx, '', 'Updated Since', 0)).toBeUndefined();
		expect(toIsoDate(ctx, undefined, 'Updated Since', 0)).toBeUndefined();
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

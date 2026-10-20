import { describe, expect, it } from 'vitest';
import { DattaCrm } from '../nodes/DattaCrm/DattaCrm.node';
import { createExecuteContext, ok, type Params } from './helpers';

const BASE = 'https://crm.example.com/api/v1';

async function run(params: Params, responses: Parameters<typeof ok>[0][]) {
	const { ctx, request } = createExecuteContext({
		params,
		responses: responses.map((data) => ok(data)),
	});
	const result = await new DattaCrm().execute.call(ctx);
	return { items: result[0], calls: request.mock.calls.map((call) => call[1]) };
}

const lists = [
	{ id: 'l1', name: 'A', isDefault: true, count: 1 },
	{ id: 'l2', name: 'B', isDefault: false, count: 2 },
	{ id: 'l3', name: 'C', isDefault: false, count: 3 },
];

describe('List', () => {
	it('Create posts the name to /lists', async () => {
		const { items, calls } = await run(
			{ resource: 'list', operation: 'create', name: 'Newsletter' },
			[lists[0]],
		);

		expect(calls[0]).toMatchObject({
			method: 'POST',
			url: `${BASE}/lists`,
			body: { name: 'Newsletter' },
		});
		expect(items.map((i) => i.json)).toEqual([lists[0]]);
	});

	it('Create requires a name', async () => {
		await expect(run({ resource: 'list', operation: 'create', name: ' ' }, [])).rejects.toThrow(
			'List name is required',
		);
	});

	it('Get Many with Return All returns every list', async () => {
		const { items, calls } = await run({ resource: 'list', operation: 'getAll', returnAll: true }, [
			lists,
		]);

		expect(calls[0]).toMatchObject({ method: 'GET', url: `${BASE}/lists` });
		expect(items).toHaveLength(3);
	});

	it('Get Many with a limit slices client-side', async () => {
		const { items } = await run(
			{ resource: 'list', operation: 'getAll', returnAll: false, limit: 2 },
			[lists],
		);

		expect(items.map((i) => (i.json as { id: string }).id)).toEqual(['l1', 'l2']);
	});
});

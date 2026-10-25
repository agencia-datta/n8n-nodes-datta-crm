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
	{ id: 'l1', name: 'A', isDefault: false, folderId: 'f1', folderName: 'Site', count: 1 },
	{ id: 'l2', name: 'B', isDefault: false, folderId: 'f1', folderName: 'Site', count: 2 },
	{ id: 'l3', name: 'C', isDefault: false, folderId: 'f2', folderName: 'Ads', count: 3 },
];

const folders = [
	{ id: 'f2', name: 'Ads', origin: 'instagram' },
	{ id: 'f1', name: 'Site', origin: 'site' },
];

describe('List', () => {
	it('Create posts the name and the folder to /lists, without the origin', async () => {
		const { items, calls } = await run(
			{ resource: 'list', operation: 'create', name: 'Newsletter', folderId: 'f1', origin: 'site' },
			[lists[0]],
		);

		expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/lists` });
		expect(calls[0].body).toEqual({ name: 'Newsletter', folderId: 'f1' });
		expect(items.map((i) => i.json)).toEqual([lists[0]]);
	});

	it('Create without a folder sends the origin so the CRM picks its only folder', async () => {
		const { calls } = await run(
			{
				resource: 'list',
				operation: 'create',
				name: 'Newsletter',
				folderId: '',
				origin: 'whatsapp',
			},
			[lists[0]],
		);

		expect(calls[0].body).toEqual({ name: 'Newsletter', origin: 'whatsapp' });
	});

	it('Create from a 0.1.x workflow (no folder or origin saved) defaults to the site origin', async () => {
		const { calls } = await run({ resource: 'list', operation: 'create', name: 'Newsletter' }, [
			lists[0],
		]);

		expect(calls[0].body).toEqual({ name: 'Newsletter', origin: 'site' });
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

describe('Folder', () => {
	it('Get Many with Return All returns every folder', async () => {
		const { items, calls } = await run(
			{ resource: 'folder', operation: 'getAll', returnAll: true },
			[folders],
		);

		expect(calls[0]).toMatchObject({ method: 'GET', url: `${BASE}/folders` });
		expect(items.map((i) => i.json)).toEqual(folders);
	});

	it('Get Many with a limit slices client-side', async () => {
		const { items } = await run(
			{ resource: 'folder', operation: 'getAll', returnAll: false, limit: 1 },
			[folders],
		);

		expect(items.map((i) => (i.json as { id: string }).id)).toEqual(['f2']);
	});
});

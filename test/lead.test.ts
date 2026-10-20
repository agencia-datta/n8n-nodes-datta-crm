import { describe, expect, it } from 'vitest';
import type { INodeProperties } from 'n8n-workflow';
import { DattaCrm } from '../nodes/DattaCrm/DattaCrm.node';
import { apiError, createExecuteContext, ok, page, type Params } from './helpers';

const BASE = 'https://crm.example.com/api/v1';
const LEAD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_FIELD = { key: 'plano', label: 'Plan', type: 'text', options: [] };

type Options = Parameters<typeof createExecuteContext>[0];

async function run(
	params: Params | Params[],
	responses: NonNullable<Options>['responses'],
	extra: Options = {},
) {
	const { ctx, request } = createExecuteContext({ params, responses, ...extra });
	const result = await new DattaCrm().execute.call(ctx);
	const calls = request.mock.calls.map((call) => call[1]);
	return { items: result[0], calls, request };
}

function lead(extra: Params = {}) {
	return { id: LEAD_ID, name: 'Ana', email: 'ana@example.com', ...extra };
}

describe('Lead: Create or Update', () => {
	it('posts only the filled fields, with tags and a typed custom field', async () => {
		const { items, calls } = await run(
			{
				resource: 'lead',
				operation: 'upsert',
				email: 'ana@example.com',
				phone: '',
				additionalFields: {
					name: '',
					tags: ['vip'],
					listIds: [],
					customFields: { entries: [{ key: 'plano', value: 'ouro' }] },
				},
			},
			[ok([PLAN_FIELD]), ok({ lead: lead(), result: 'created' }, undefined, 201)],
		);

		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({ method: 'GET', url: `${BASE}/custom-fields` });
		expect(calls[1]).toMatchObject({
			method: 'POST',
			url: `${BASE}/leads`,
			body: { email: 'ana@example.com', tags: ['vip'], customFields: { plano: 'ouro' } },
		});
		expect(Object.keys(calls[1].body as object).sort()).toEqual(['customFields', 'email', 'tags']);
		expect(items).toEqual([{ json: { lead: lead(), result: 'created' }, pairedItem: { item: 0 } }]);
	});

	it('does not fetch the custom field catalog when no custom field is used', async () => {
		const { calls } = await run(
			{ resource: 'lead', operation: 'upsert', email: 'ana@example.com', phone: '' },
			[ok({ lead: lead(), result: 'matched' })],
		);

		expect(calls).toHaveLength(1);
		expect(calls[0].body).toEqual({ email: 'ana@example.com' });
	});

	it('sends every additional field with the contract key names', async () => {
		const { calls } = await run(
			{
				resource: 'lead',
				operation: 'upsert',
				email: '',
				phone: '+5511999999999',
				additionalFields: {
					name: 'Ana',
					tags: 'a, b',
					listIds: ['l1'],
					pipelineId: 'p1',
					stageId: 's1',
					ownerId: 'm1',
					value: 0,
					source: 'n8n',
					utm: { source: 'g', medium: '', campaign: 'c' },
					mode: 'createOnly',
				},
			},
			[ok({ lead: lead(), result: 'created' }, undefined, 201)],
		);

		expect(calls[0].body).toEqual({
			phone: '+5511999999999',
			name: 'Ana',
			tags: ['a', 'b'],
			listIds: ['l1'],
			pipelineId: 'p1',
			stageId: 's1',
			ownerId: 'm1',
			value: 0,
			source: 'n8n',
			utm: { source: 'g', campaign: 'c' },
			mode: 'createOnly',
		});
	});

	it('fetches the custom field catalog once for several items', async () => {
		const params = (value: string): Params => ({
			resource: 'lead',
			operation: 'upsert',
			email: 'ana@example.com',
			additionalFields: { customFields: { entries: [{ key: 'plano', value }] } },
		});
		const { calls, items } = await run(
			[params('ouro'), params('prata')],
			[
				ok([PLAN_FIELD]),
				ok({ lead: lead(), result: 'created' }, undefined, 201),
				ok({ lead: lead(), result: 'matched' }),
			],
		);

		expect(calls.map((c) => c.url)).toEqual([
			`${BASE}/custom-fields`,
			`${BASE}/leads`,
			`${BASE}/leads`,
		]);
		expect(items.map((i) => i.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
	});

	it('throws when both email and phone are empty', async () => {
		await expect(
			run({ resource: 'lead', operation: 'upsert', email: '  ', phone: '' }, []),
		).rejects.toThrow('Provide an email or a phone');
	});

	it('with continueOnFail returns an { error } item instead of throwing', async () => {
		const { items, request } = await run(
			{ resource: 'lead', operation: 'upsert', email: '', phone: '' },
			[],
			{ continueOnFail: true },
		);

		expect(request).not.toHaveBeenCalled();
		expect(items).toEqual([
			{ json: { error: 'Provide an email or a phone' }, pairedItem: { item: 0 } },
		]);
	});

	it('with continueOnFail returns the API message for an API error', async () => {
		const { items } = await run(
			{ resource: 'lead', operation: 'upsert', email: 'ana@example.com' },
			[apiError(400, 'validation_error', 'Informe um e-mail válido.')],
			{ continueOnFail: true },
		);

		expect(items).toEqual([
			{ json: { error: 'Informe um e-mail válido.' }, pairedItem: { item: 0 } },
		]);
	});

	it('rethrows an API error without continueOnFail', async () => {
		await expect(
			run({ resource: 'lead', operation: 'upsert', email: 'ana@example.com' }, [
				apiError(409, 'plan_limit', 'Limite do plano atingido.'),
			]),
		).rejects.toThrow('Limite do plano atingido.');
	});
});

describe('Lead: Get', () => {
	it('gets by id with GET /leads/{id}', async () => {
		const { items, calls } = await run(
			{ resource: 'lead', operation: 'get', searchBy: 'id', leadId: LEAD_ID },
			[ok(lead())],
		);

		expect(calls[0]).toMatchObject({ method: 'GET', url: `${BASE}/leads/${LEAD_ID}` });
		expect(items.map((i) => i.json)).toEqual([lead()]);
	});

	it('rejects an empty lead id instead of listing every lead', async () => {
		await expect(
			run({ resource: 'lead', operation: 'get', searchBy: 'id', leadId: ' ' }, []),
		).rejects.toThrow('Lead ID is required');
	});

	it('by email with no match returns no items', async () => {
		const { items, calls } = await run(
			{ resource: 'lead', operation: 'get', searchBy: 'email', email: 'x@example.com' },
			[page([], null)],
		);

		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: `${BASE}/leads`,
			qs: { email: 'x@example.com', limit: 1 },
		});
		expect(items).toEqual([]);
	});

	it('by email with a match returns the first lead', async () => {
		const { items } = await run(
			{ resource: 'lead', operation: 'get', searchBy: 'email', email: 'ana@example.com' },
			[page([lead(), lead({ id: 'other' })], 'next')],
		);

		expect(items.map((i) => i.json)).toEqual([lead()]);
	});

	it('by phone sends the phone filter', async () => {
		const { calls } = await run(
			{ resource: 'lead', operation: 'get', searchBy: 'phone', phone: '+5511999999999' },
			[page([lead()], null)],
		);

		expect(calls[0].qs).toEqual({ phone: '+5511999999999', limit: 1 });
	});

	it('with continueOnFail and no match still returns no items for that input', async () => {
		const { items } = await run(
			[
				{ resource: 'lead', operation: 'get', searchBy: 'email', email: 'x@example.com' },
				{ resource: 'lead', operation: 'get', searchBy: 'email', email: 'ana@example.com' },
			],
			[page([], null), page([lead()], null)],
		);

		expect(items).toEqual([{ json: lead(), pairedItem: { item: 1 } }]);
	});
});

describe('Lead: Get Many', () => {
	it('Return All follows the cursor', async () => {
		const { items, calls } = await run(
			{
				resource: 'lead',
				operation: 'getAll',
				returnAll: true,
				filters: { tag: 'vip', updatedSince: '2026-10-20T10:00:00.000Z' },
			},
			[page([lead({ id: 'a' })], 'c2'), page([lead({ id: 'b' })], null)],
		);

		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: `${BASE}/leads`,
			qs: { tag: 'vip', updatedSince: '2026-10-20T10:00:00.000Z', limit: 200 },
		});
		expect(calls[1].qs).toMatchObject({ cursor: 'c2' });
		expect(items.map((i) => (i.json as { id: string }).id)).toEqual(['a', 'b']);
	});

	it('with a limit of 10 sends limit 10 once', async () => {
		const { calls } = await run(
			{ resource: 'lead', operation: 'getAll', returnAll: false, limit: 10 },
			[
				page(
					Array.from({ length: 10 }, (_, n) => lead({ id: `l${n}` })),
					'more',
				),
			],
		);

		expect(calls).toHaveLength(1);
		expect(calls[0].qs).toEqual({ limit: 10 });
	});

	it('sends every filter with the contract names and converts updatedSince to ISO', async () => {
		const { calls } = await run(
			{
				resource: 'lead',
				operation: 'getAll',
				returnAll: false,
				limit: 5,
				filters: {
					email: 'a@b.com',
					phone: '+55',
					tag: 'vip',
					listId: 'l1',
					pipelineId: 'p1',
					stageId: 's1',
					updatedSince: '2026-10-20T10:00:00',
				},
			},
			[page([], null)],
		);

		expect(calls[0].qs).toEqual({
			email: 'a@b.com',
			phone: '+55',
			tag: 'vip',
			listId: 'l1',
			pipelineId: 'p1',
			stageId: 's1',
			updatedSince: new Date('2026-10-20T10:00:00').toISOString(),
			limit: 5,
		});
	});

	it('rejects an invalid updatedSince', async () => {
		await expect(
			run(
				{
					resource: 'lead',
					operation: 'getAll',
					returnAll: true,
					filters: { updatedSince: 'garbage' },
				},
				[],
			),
		).rejects.toThrow('"Updated Since" is not a valid date');
	});
});

describe('Lead: Update', () => {
	it('sends ownerId null when "No Owner" is chosen', async () => {
		const { calls } = await run(
			{
				resource: 'lead',
				operation: 'update',
				leadId: LEAD_ID,
				updateFields: { ownerId: '__none__' },
			},
			[ok({ lead: lead() })],
		);

		expect(calls[0]).toMatchObject({
			method: 'PATCH',
			url: `${BASE}/leads/${LEAD_ID}`,
			body: { ownerId: null },
		});
	});

	it('sends the filled fields, keeps value 0 and types custom fields', async () => {
		const { calls } = await run(
			{
				resource: 'lead',
				operation: 'update',
				leadId: LEAD_ID,
				updateFields: {
					name: 'Ana B',
					email: '',
					value: 0,
					lossReason: 'price',
					customFields: { entries: [{ key: 'plano', value: 'ouro' }] },
				},
			},
			[ok([PLAN_FIELD]), ok({ lead: lead() })],
		);

		expect(calls[1].body).toEqual({
			name: 'Ana B',
			value: 0,
			lossReason: 'price',
			customFields: { plano: 'ouro' },
		});
	});

	it('throws when no field was chosen', async () => {
		await expect(
			run({ resource: 'lead', operation: 'update', leadId: LEAD_ID, updateFields: {} }, []),
		).rejects.toThrow('Choose at least one field to update');
	});
});

describe('Lead: tags, lists and stage', () => {
	it('Add Tags patches addTags from a comma separated string', async () => {
		const { calls } = await run(
			{ resource: 'lead', operation: 'addTags', leadId: LEAD_ID, tags: 'a, b' },
			[ok({ lead: lead() })],
		);

		expect(calls[0]).toMatchObject({
			method: 'PATCH',
			url: `${BASE}/leads/${LEAD_ID}`,
			body: { addTags: ['a', 'b'] },
		});
	});

	it('Remove Tags patches removeTags from a multiOptions array', async () => {
		const { calls } = await run(
			{ resource: 'lead', operation: 'removeTags', leadId: LEAD_ID, tags: ['a'] },
			[ok({ lead: lead() })],
		);

		expect(calls[0].body).toEqual({ removeTags: ['a'] });
	});

	it('Add Tags without tags throws', async () => {
		await expect(
			run({ resource: 'lead', operation: 'addTags', leadId: LEAD_ID, tags: [] }, []),
		).rejects.toThrow('Choose at least one tag');
	});

	it('Add to Lists and Remove from Lists patch the list ids', async () => {
		const added = await run(
			{ resource: 'lead', operation: 'addToLists', leadId: LEAD_ID, listIds: ['l1', 'l2'] },
			[ok({ lead: lead() })],
		);
		const removed = await run(
			{ resource: 'lead', operation: 'removeFromLists', leadId: LEAD_ID, listIds: 'l1' },
			[ok({ lead: lead() })],
		);

		expect(added.calls[0].body).toEqual({ addListIds: ['l1', 'l2'] });
		expect(removed.calls[0].body).toEqual({ removeListIds: ['l1'] });
	});

	it('Add to Lists without lists throws', async () => {
		await expect(
			run({ resource: 'lead', operation: 'addToLists', leadId: LEAD_ID, listIds: '' }, []),
		).rejects.toThrow('Choose at least one list');
	});

	it('Move to Stage sends exactly { stageId }', async () => {
		const { calls } = await run(
			{
				resource: 'lead',
				operation: 'moveToStage',
				leadId: LEAD_ID,
				pipelineId: 'p1',
				stageId: 's2',
			},
			[ok({ lead: lead() })],
		);

		expect(calls[0]).toMatchObject({
			method: 'PATCH',
			url: `${BASE}/leads/${LEAD_ID}`,
			body: { stageId: 's2' },
		});
		expect(calls[0].body).toEqual({ stageId: 's2' });
	});
});

describe('Datta CRM node', () => {
	const description = new DattaCrm().description;

	it('rejects an unknown resource', async () => {
		await expect(run({ resource: 'nope', operation: 'x' }, [])).rejects.toThrow(
			'Unknown resource "nope"',
		);
	});

	it('registers the Lead and List resources, each with an operation property', () => {
		const resource = description.properties.find((p) => p.name === 'resource');
		expect(resource?.options?.map((o) => (o as { value: string }).value)).toEqual(['lead', 'list']);
		for (const value of ['lead', 'list']) {
			const operation = description.properties.find(
				(p) => p.name === 'operation' && p.displayOptions?.show?.resource?.includes(value),
			);
			expect(operation, `operation for ${value}`).toBeDefined();
		}
	});

	it('only references loadOptions methods that exist', () => {
		const methods = Object.keys(new DattaCrm().methods.loadOptions);
		const referenced = new Set<string>();
		const visit = (properties: INodeProperties[]) => {
			for (const property of properties) {
				const method = property.typeOptions?.loadOptionsMethod;
				if (method) referenced.add(method);
				for (const option of property.options ?? []) {
					if ('values' in option) visit(option.values as INodeProperties[]);
				}
			}
		};
		visit(description.properties);

		expect(referenced.size).toBeGreaterThan(0);
		for (const method of referenced) expect(methods).toContain(method);
	});
});

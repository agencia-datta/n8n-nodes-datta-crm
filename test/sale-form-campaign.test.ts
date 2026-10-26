import { describe, expect, it } from 'vitest';
import { DattaCrm } from '../nodes/DattaCrm/DattaCrm.node';
import { apiError, createExecuteContext, ok, page, type Params } from './helpers';

const BASE = 'https://crm.example.com/api/v1';
const SALE_ID = '22222222-2222-4222-8222-222222222222';
const FORM_ID = '33333333-3333-4333-8333-333333333333';
const CAMPAIGN_ID = '44444444-4444-4444-8444-444444444444';

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

function sale(extra: Params = {}) {
	return { id: SALE_ID, gateway: 'api', transactionId: 'tx1', status: 'paid', value: 10, ...extra };
}

describe('Sale: Create or Update', () => {
	it('defaults the gateway to "api" and sends the required fields', async () => {
		const { items, calls } = await run(
			{
				resource: 'sale',
				operation: 'upsert',
				transactionId: 'tx1',
				status: 'paid',
				value: 99.9,
				additionalFields: {},
			},
			[ok({ sale: sale(), result: 'created', leadId: null }, undefined, 201)],
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/sales` });
		expect(calls[0].body).toEqual({
			gateway: 'api',
			transactionId: 'tx1',
			status: 'paid',
			value: 99.9,
		});
		expect(items.map((i) => i.json)).toEqual([{ sale: sale(), result: 'created', leadId: null }]);
	});

	it('treats a blank gateway as "api" and keeps a chosen one', async () => {
		const base = { resource: 'sale', operation: 'upsert', transactionId: 'tx', status: 'pending' };
		const { calls } = await run(
			[
				{ ...base, value: 1, additionalFields: { gateway: '  ' } },
				{ ...base, value: 1, additionalFields: { gateway: 'hotmart' } },
			],
			[ok({ sale: sale(), result: 'created' }), ok({ sale: sale(), result: 'updated' })],
		);

		expect((calls[0].body as { gateway: string }).gateway).toBe('api');
		expect((calls[1].body as { gateway: string }).gateway).toBe('hotmart');
	});

	it('sends every additional field with the contract names, dates in ISO and an integer installments', async () => {
		const { calls } = await run(
			{
				resource: 'sale',
				operation: 'upsert',
				transactionId: 'tx1',
				status: 'refunded',
				value: 0,
				additionalFields: {
					gateway: 'stripe',
					currency: 'BRL',
					productId: 'p1',
					productName: 'Course',
					paymentType: 'card',
					occurredAt: '2026-10-20T10:00:00',
					buyer: { name: 'Ana', email: 'ana@example.com', phone: '' },
					utm: { source: 'g', campaign: 'c' },
					mirror: {
						grossValue: 120,
						buyerTaxes: 0,
						installmentFee: 1,
						processingFee: 2,
						streamingFee: 3,
						otherFees: 4,
						producerNetValue: 5,
						coproducerValue: 6,
						affiliateValue: 7,
						affiliateName: 'Bob',
						offerCode: 'o1',
						offerName: 'Offer',
						couponCode: 'C10',
						installments: 3.0,
						payoutCurrency: 'USD',
						approvedAt: '2026-10-21T08:30:00',
					},
				},
			},
			[ok({ sale: sale(), result: 'created' })],
			{ timezone: 'America/Sao_Paulo' },
		);

		expect(calls[0].body).toEqual({
			gateway: 'stripe',
			transactionId: 'tx1',
			status: 'refunded',
			value: 0,
			currency: 'BRL',
			productId: 'p1',
			productName: 'Course',
			paymentType: 'card',
			occurredAt: '2026-10-20T13:00:00.000Z',
			buyer: { name: 'Ana', email: 'ana@example.com' },
			utm: { source: 'g', campaign: 'c' },
			mirror: {
				grossValue: 120,
				buyerTaxes: 0,
				installmentFee: 1,
				processingFee: 2,
				streamingFee: 3,
				otherFees: 4,
				producerNetValue: 5,
				coproducerValue: 6,
				affiliateValue: 7,
				affiliateName: 'Bob',
				offerCode: 'o1',
				offerName: 'Offer',
				couponCode: 'C10',
				installments: 3,
				payoutCurrency: 'USD',
				approvedAt: '2026-10-21T11:30:00.000Z',
			},
		});
	});

	it('requires a transaction ID and rejects an invalid date', async () => {
		const base = { resource: 'sale', operation: 'upsert', status: 'paid', value: 1 };
		await expect(run({ ...base, transactionId: ' ' }, [])).rejects.toThrow(
			'Transaction ID is required',
		);
		await expect(
			run({ ...base, transactionId: 'tx', additionalFields: { occurredAt: 'nope' } }, []),
		).rejects.toThrow('"Occurred At" is not a valid date');
		await expect(
			run(
				{
					...base,
					transactionId: 'tx',
					additionalFields: { mirror: { approvedAt: 'nope' } },
				},
				[],
			),
		).rejects.toThrow('"Approved At" is not a valid date');
	});
});

describe('Sale: Get, Get Many and Update', () => {
	it('Get calls GET /sales/{id} and returns the sale', async () => {
		const { items, calls } = await run({ resource: 'sale', operation: 'get', saleId: SALE_ID }, [
			ok(sale()),
		]);

		expect(calls[0]).toMatchObject({ method: 'GET', url: `${BASE}/sales/${SALE_ID}` });
		expect(items.map((i) => i.json)).toEqual([sale()]);
	});

	it('Get rejects an empty sale ID', async () => {
		await expect(run({ resource: 'sale', operation: 'get', saleId: '' }, [])).rejects.toThrow(
			'Sale ID is required',
		);
	});

	it('Get Many passes the filters and follows the cursor', async () => {
		const { items, calls } = await run(
			{
				resource: 'sale',
				operation: 'getAll',
				returnAll: true,
				filters: {
					status: 'paid',
					gateway: 'hotmart',
					transactionId: 'tx1',
					leadId: 'lead-1',
					occurredSince: '2026-10-20T10:00:00.000Z',
				},
			},
			[page([sale({ id: 'a' })], 'c2'), page([sale({ id: 'b' })], null)],
		);

		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: `${BASE}/sales`,
			qs: {
				status: 'paid',
				gateway: 'hotmart',
				transactionId: 'tx1',
				leadId: 'lead-1',
				occurredSince: '2026-10-20T10:00:00.000Z',
				limit: 200,
			},
		});
		expect(calls[1].qs).toMatchObject({ status: 'paid', cursor: 'c2' });
		expect(items.map((i) => (i.json as { id: string }).id)).toEqual(['a', 'b']);
	});

	it('Get Many with a limit sends that limit and no filters by default', async () => {
		const { calls } = await run(
			{ resource: 'sale', operation: 'getAll', returnAll: false, limit: 7 },
			[page([], null)],
		);

		expect(calls[0].qs).toEqual({ limit: 7 });
	});

	it('reads zone-less dates in the workflow timezone', async () => {
		const { calls } = await run(
			[
				{
					resource: 'sale',
					operation: 'getAll',
					returnAll: false,
					limit: 1,
					filters: { occurredSince: '2026-10-20T10:05:00' },
				},
				{
					resource: 'sale',
					operation: 'upsert',
					transactionId: 'tx1',
					status: 'paid',
					value: 1,
					additionalFields: {
						occurredAt: '2026-10-20T10:05:00',
						mirror: { approvedAt: '2026-10-20T10:05:00+03:00' },
					},
				},
			],
			[page([], null), ok({ sale: sale(), result: 'created', leadId: null }, undefined, 201)],
			{ timezone: 'America/Sao_Paulo' },
		);

		expect(calls[0].qs).toEqual({ occurredSince: '2026-10-20T13:05:00.000Z', limit: 1 });
		const body = calls[1].body as { occurredAt: string; mirror: { approvedAt: string } };
		expect(body.occurredAt).toBe('2026-10-20T13:05:00.000Z');
		expect(body.mirror.approvedAt).toBe('2026-10-20T07:05:00.000Z');
	});

	it('Update patches only the chosen fields and never sends gateway or transactionId', async () => {
		const { items, calls } = await run(
			{
				resource: 'sale',
				operation: 'update',
				saleId: SALE_ID,
				updateFields: {
					status: 'chargeback',
					value: 0,
					productName: 'New name',
					buyer: { email: 'x@example.com' },
					mirror: { installments: 2, processingFee: 1.5 },
					gateway: 'ignored',
					transactionId: 'ignored',
				},
			},
			[ok({ sale: sale() })],
		);

		expect(calls[0]).toMatchObject({ method: 'PATCH', url: `${BASE}/sales/${SALE_ID}` });
		expect(calls[0].body).toEqual({
			status: 'chargeback',
			value: 0,
			productName: 'New name',
			buyer: { email: 'x@example.com' },
			mirror: { installments: 2, processingFee: 1.5 },
		});
		expect(calls[0].body).not.toHaveProperty('gateway');
		expect(calls[0].body).not.toHaveProperty('transactionId');
		expect(items.map((i) => i.json)).toEqual([{ sale: sale() }]);
	});

	it('Update with no fields throws before calling the API', async () => {
		const params = { resource: 'sale', operation: 'update', saleId: SALE_ID, updateFields: {} };
		const { request } = await run(params, [], { continueOnFail: true });
		expect(request).not.toHaveBeenCalled();
		await expect(run(params, [])).rejects.toThrow('Choose at least one field to update');
	});
});

function form(extra: Params = {}) {
	return { id: FORM_ID, name: 'Landing', slug: 'landing', isActive: true, ...extra };
}

describe('Form', () => {
	it('Deactivate patches { isActive: false }', async () => {
		const { calls } = await run({ resource: 'form', operation: 'deactivate', formId: FORM_ID }, [
			ok(form({ isActive: false })),
		]);

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method: 'PATCH', url: `${BASE}/forms/${FORM_ID}` });
		expect(calls[0].body).toEqual({ isActive: false });
	});

	it('Activate patches { isActive: true }', async () => {
		const { calls } = await run({ resource: 'form', operation: 'activate', formId: FORM_ID }, [
			ok(form()),
		]);

		expect(calls[0]).toMatchObject({ method: 'PATCH', url: `${BASE}/forms/${FORM_ID}` });
		expect(calls[0].body).toEqual({ isActive: true });
	});

	it('Get calls GET /forms/{id}', async () => {
		const { items, calls } = await run({ resource: 'form', operation: 'get', formId: FORM_ID }, [
			ok(form()),
		]);

		expect(calls[0]).toMatchObject({ method: 'GET', url: `${BASE}/forms/${FORM_ID}` });
		expect(items.map((i) => i.json)).toEqual([form()]);
	});

	it('Create parses the fields JSON string', async () => {
		const fields = [{ type: 'email', label: 'Email', required: true }];
		const { calls } = await run(
			{
				resource: 'form',
				operation: 'create',
				name: 'Landing',
				slug: 'landing',
				experience: 'classic',
				fields: JSON.stringify(fields),
				additionalFields: {},
			},
			[ok(form(), undefined, 201)],
		);

		expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/forms` });
		expect(calls[0].body).toEqual({
			name: 'Landing',
			slug: 'landing',
			experience: 'classic',
			fields,
		});
	});

	it('Create accepts fields that are already an array (expression)', async () => {
		const fields = [{ type: 'text', label: 'Name' }];
		const { calls } = await run(
			{
				resource: 'form',
				operation: 'create',
				name: 'a',
				slug: 'a',
				experience: 'conversational',
				fields,
			},
			[ok(form())],
		);

		expect((calls[0].body as { fields: unknown }).fields).toEqual(fields);
	});

	it('Create with invalid JSON in Fields throws an error naming the field', async () => {
		await expect(
			run(
				{
					resource: 'form',
					operation: 'create',
					name: 'a',
					slug: 'a',
					experience: 'classic',
					fields: '[{oops',
					additionalFields: {},
				},
				[],
			),
		).rejects.toThrow('"Fields" is not valid JSON');
	});

	it('Create rejects Fields that is not an array and Theme that is not an object', async () => {
		const base = {
			resource: 'form',
			operation: 'create',
			name: 'a',
			slug: 'a',
			experience: 'classic',
		};
		await expect(run({ ...base, fields: '{"a":1}', additionalFields: {} }, [])).rejects.toThrow(
			'"Fields" must be a JSON array',
		);
		await expect(
			run({ ...base, fields: '[]', additionalFields: { theme: '[1]' } }, []),
		).rejects.toThrow('"Theme" must be a JSON object');
		await expect(
			run({ ...base, fields: '[]', additionalFields: { consent: '{bad' } }, []),
		).rejects.toThrow('"Consent" is not valid JSON');
	});

	it('Create sends the additional fields with the contract names', async () => {
		const { calls } = await run(
			{
				resource: 'form',
				operation: 'create',
				name: 'Landing',
				slug: 'landing',
				experience: 'conversational',
				fields: '[]',
				additionalFields: {
					defaultTags: ['vip', 'lp'],
					defaultListId: 'list-1',
					isActive: false,
					showQuestions: true,
					funnelStageId: 'stage-1',
					theme: '{"accent":"#fff"}',
					consent: { enabled: true, text: 'OK' },
					emailMarketing: '{"enabled":true,"text":"Yes"}',
				},
			},
			[ok(form())],
		);

		expect(calls[0].body).toEqual({
			name: 'Landing',
			slug: 'landing',
			experience: 'conversational',
			fields: [],
			defaultTags: ['vip', 'lp'],
			defaultListId: 'list-1',
			isActive: false,
			showQuestions: true,
			theme: { accent: '#fff' },
			consent: { enabled: true, text: 'OK' },
			emailMarketing: { enabled: true, text: 'Yes' },
		});
	});

	it('Update patches the parsed JSON body', async () => {
		const { calls } = await run(
			{
				resource: 'form',
				operation: 'update',
				formId: FORM_ID,
				updateJson: '{"name":"New","funnelEntry":{"enabled":false}}',
			},
			[ok(form({ name: 'New' }))],
		);

		expect(calls[0]).toMatchObject({ method: 'PATCH', url: `${BASE}/forms/${FORM_ID}` });
		expect(calls[0].body).toEqual({ name: 'New', funnelEntry: { enabled: false } });
	});

	it('Update rejects an empty object, an array and invalid JSON', async () => {
		const base = { resource: 'form', operation: 'update', formId: FORM_ID };
		await expect(run({ ...base, updateJson: '{}' }, [])).rejects.toThrow(
			'"Fields to Update (JSON)" must include at least one field',
		);
		await expect(run({ ...base, updateJson: '[1]' }, [])).rejects.toThrow(
			'"Fields to Update (JSON)" must be a JSON object',
		);
		await expect(run({ ...base, updateJson: '{' }, [])).rejects.toThrow(
			'"Fields to Update (JSON)" is not valid JSON',
		);
	});

	it('Get Many sends isActive as "true"/"false" and nothing for All', async () => {
		const get = (isActive: string) =>
			run(
				{
					resource: 'form',
					operation: 'getAll',
					returnAll: false,
					limit: 20,
					filters: { isActive },
				},
				[page([], null)],
			);

		expect((await get('true')).calls[0].qs).toEqual({ isActive: 'true', limit: 20 });
		expect((await get('false')).calls[0].qs).toEqual({ isActive: 'false', limit: 20 });
		expect((await get('all')).calls[0].qs).toEqual({ limit: 20 });
		const all = await run({ resource: 'form', operation: 'getAll', returnAll: true }, [
			page([form()], null),
		]);
		expect(all.calls[0]).toMatchObject({ method: 'GET', url: `${BASE}/forms`, qs: { limit: 200 } });
		expect(all.items).toHaveLength(1);
	});
});

function campaign(extra: Params = {}) {
	return { id: CAMPAIGN_ID, name: 'News', state: 'draft', ...extra };
}

describe('Email Campaign', () => {
	it('Create Draft converts desiredSendAt to ISO and sends the chosen lists', async () => {
		const { items, calls } = await run(
			{
				resource: 'emailCampaign',
				operation: 'createDraft',
				name: 'News',
				html: '<p>Hi</p>',
				additionalFields: {
					subject: 'Hello',
					preheader: 'Pre',
					text: 'Hi',
					includeListIds: ['l1', 'l2'],
					excludeListIds: ['l3'],
					includeTags: ['vip'],
					excludeTags: [],
					utm: { enabled: true, source: 'crm', medium: '', campaign: 'news' },
					desiredSendAt: '2026-11-01T09:00:00',
				},
			},
			[ok(campaign(), undefined, 201)],
			{ timezone: 'America/Sao_Paulo' },
		);

		expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/email-campaigns` });
		expect(calls[0].body).toEqual({
			name: 'News',
			html: '<p>Hi</p>',
			subject: 'Hello',
			preheader: 'Pre',
			text: 'Hi',
			includeListIds: ['l1', 'l2'],
			excludeListIds: ['l3'],
			includeTags: ['vip'],
			utm: { enabled: true, source: 'crm', campaign: 'news' },
			desiredSendAt: '2026-11-01T12:00:00.000Z',
		});
		expect(items.map((i) => i.json)).toEqual([campaign()]);
	});

	it('Create Draft sends only name and html by default and omits an empty utm', async () => {
		const { calls } = await run(
			{
				resource: 'emailCampaign',
				operation: 'createDraft',
				name: 'News',
				html: '<p>Hi</p>',
				additionalFields: { utm: {} },
			},
			[ok(campaign())],
		);

		expect(calls[0].body).toEqual({ name: 'News', html: '<p>Hi</p>' });
	});

	it('Create Draft rejects an invalid desiredSendAt and an empty name', async () => {
		await expect(
			run(
				{
					resource: 'emailCampaign',
					operation: 'createDraft',
					name: 'News',
					html: '<p/>',
					additionalFields: { desiredSendAt: 'soon' },
				},
				[],
			),
		).rejects.toThrow('"Desired Send At" is not a valid date');
		await expect(
			run({ resource: 'emailCampaign', operation: 'createDraft', name: ' ', html: '<p/>' }, []),
		).rejects.toThrow('Name is required');
	});

	it('Update Draft patches the chosen fields, including name and html', async () => {
		const { calls } = await run(
			{
				resource: 'emailCampaign',
				operation: 'updateDraft',
				campaignId: CAMPAIGN_ID,
				updateFields: {
					name: 'Renamed',
					html: '<b>x</b>',
					includeTags: ['a'],
					desiredSendAt: '2026-11-01T09:00:00Z',
				},
			},
			[ok(campaign())],
		);

		expect(calls[0]).toMatchObject({
			method: 'PATCH',
			url: `${BASE}/email-campaigns/${CAMPAIGN_ID}`,
		});
		expect(calls[0].body).toEqual({
			name: 'Renamed',
			html: '<b>x</b>',
			includeTags: ['a'],
			desiredSendAt: '2026-11-01T09:00:00.000Z',
		});
	});

	it('Update Draft with no fields throws; a non-draft conflict error is surfaced', async () => {
		await expect(
			run(
				{
					resource: 'emailCampaign',
					operation: 'updateDraft',
					campaignId: CAMPAIGN_ID,
					updateFields: {},
				},
				[],
			),
		).rejects.toThrow('Choose at least one field to update');
		await expect(
			run(
				{
					resource: 'emailCampaign',
					operation: 'updateDraft',
					campaignId: CAMPAIGN_ID,
					updateFields: { subject: 'x' },
				},
				[apiError(409, 'conflict', 'A campanha não é mais um rascunho.')],
			),
		).rejects.toThrow('A campanha não é mais um rascunho.');
	});

	it('Get calls GET /email-campaigns/{id}', async () => {
		const { calls } = await run(
			{ resource: 'emailCampaign', operation: 'get', campaignId: CAMPAIGN_ID },
			[ok(campaign())],
		);

		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: `${BASE}/email-campaigns/${CAMPAIGN_ID}`,
		});
	});

	it('Get Many passes the state filter and paginates', async () => {
		const { items, calls } = await run(
			{
				resource: 'emailCampaign',
				operation: 'getAll',
				returnAll: true,
				filters: { state: 'scheduled' },
			},
			[page([campaign({ id: 'a' })], 'n1'), page([campaign({ id: 'b' })], null)],
		);

		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: `${BASE}/email-campaigns`,
			qs: { state: 'scheduled', limit: 50 },
		});
		expect(calls[1].qs).toMatchObject({ state: 'scheduled', cursor: 'n1', limit: 50 });
		expect(items).toHaveLength(2);
	});

	it('Get Many never asks for more than 50 per page, even for a larger Limit', async () => {
		const full = (prefix: string) =>
			Array.from({ length: 50 }, (_, n) => campaign({ id: `${prefix}${n}` }));
		const { items, calls } = await run(
			{ resource: 'emailCampaign', operation: 'getAll', returnAll: false, limit: 120 },
			[page(full('a'), 'n1'), page(full('b'), 'n2'), page(full('c'), 'n3')],
		);

		expect(calls.map((call) => (call.qs as { limit: number }).limit)).toEqual([50, 50, 20]);
		expect(items).toHaveLength(120);
	});
});

describe('Carried over from the Task 3 review', () => {
	it('Lead Create or Update never sends the pipeline or stage saved by 0.2.x', async () => {
		const base = { resource: 'lead', operation: 'upsert', email: 'a@b.com' };
		const created = ok({ lead: {}, result: 'created' });
		const { calls } = await run(
			[
				{ ...base, additionalFields: { pipelineId: 'p1', stageId: '' } },
				{ ...base, additionalFields: { pipelineId: 'p1' } },
				{ ...base, additionalFields: { pipelineId: 'p1', stageId: 's1' } },
			],
			[created, created, created],
		);

		expect(calls[0].body).toEqual({ email: 'a@b.com' });
		expect(calls[1].body).toEqual({ email: 'a@b.com' });
		expect(calls[2].body).toEqual({ email: 'a@b.com' });
	});

	it('List Get Many throws a clear error when data is not an array', async () => {
		await expect(
			run({ resource: 'list', operation: 'getAll', returnAll: true }, [ok({ unexpected: true })]),
		).rejects.toThrow('Unexpected response from the Datta CRM API');
	});
});

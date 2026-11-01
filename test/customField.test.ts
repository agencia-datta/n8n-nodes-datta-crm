import { describe, expect, it } from 'vitest';
import { DattaCrm } from '../nodes/DattaCrm/DattaCrm.node';
import { apiError, createExecuteContext, ok, type Params } from './helpers';

const BASE = 'https://crm.example.com/api/v1';
const PLAN_FIELD = { key: 'plano', label: 'Plan', type: 'text', options: [] };

type Options = Parameters<typeof createExecuteContext>[0];

async function run(
	params: Params | Params[],
	responses: NonNullable<Options>['responses'],
	extra: Options = {},
) {
	const { ctx, request } = createExecuteContext({ params, responses, ...extra });
	const result = await new DattaCrm().execute.call(ctx);
	return { items: result[0], calls: request.mock.calls.map((call) => call[1]) };
}

describe('Custom Field', () => {
	it('Create posts the name, the type and the key to /custom-fields', async () => {
		const created = { ...PLAN_FIELD, result: 'created' };
		const { items, calls } = await run(
			{
				resource: 'customField',
				operation: 'create',
				label: ' Plan ',
				type: 'text',
				options: 'ignored, for, text',
				key: ' plano ',
			},
			[ok(created, undefined, 201)],
		);

		expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/custom-fields` });
		expect(calls[0].body).toEqual({ label: 'Plan', type: 'text', key: 'plano' });
		expect(items.map((i) => i.json)).toEqual([created]);
	});

	it('Create of a select sends the options and lets the CRM derive the key', async () => {
		const { calls } = await run(
			{
				resource: 'customField',
				operation: 'create',
				label: 'Job title',
				type: 'select',
				options: 'Owner, Manager,,Employee ',
				key: '',
			},
			[
				ok({
					key: 'job_title',
					label: 'Job title',
					type: 'select',
					options: [],
					result: 'created',
				}),
			],
		);

		expect(calls[0].body).toEqual({
			label: 'Job title',
			type: 'select',
			options: ['Owner', 'Manager', 'Employee'],
		});
	});

	it('Create requires a name', async () => {
		await expect(
			run({ resource: 'customField', operation: 'create', label: ' ', type: 'text' }, []),
		).rejects.toThrow('Field name is required');
	});

	it('Create shows the CRM conflict when the key exists with another type', async () => {
		await expect(
			run({ resource: 'customField', operation: 'create', label: 'Age', type: 'text' }, [
				apiError(409, 'conflict', 'Já existe o campo "Age" com a chave "age" e o tipo number.'),
			]),
		).rejects.toThrow(/Já existe o campo "Age"/);
	});

	it('Get Many applies the limit to /custom-fields', async () => {
		const fields = [PLAN_FIELD, { ...PLAN_FIELD, key: 'cidade', label: 'City' }];
		const { items, calls } = await run(
			{ resource: 'customField', operation: 'getAll', returnAll: false, limit: 1 },
			[ok(fields)],
		);

		expect(calls[0]).toMatchObject({ method: 'GET', url: `${BASE}/custom-fields` });
		expect(items.map((i) => i.json)).toEqual([PLAN_FIELD]);
	});
});

describe('Lead: Create or Update with Create Missing Custom Fields', () => {
	const upsert = (createMissingCustomFields: boolean, entries: Params[]): Params => ({
		resource: 'lead',
		operation: 'upsert',
		email: 'ana@example.com',
		additionalFields: { createMissingCustomFields, customFields: { entries } },
	});
	const leadResponse = ok({ lead: { id: 'lead-1' }, result: 'created' }, undefined, 201);

	it('creates as text only the keys missing from the account, then sends the lead', async () => {
		const { calls } = await run(
			upsert(true, [
				{ key: 'PLANO', value: 'ouro' },
				{ key: 'cidade', value: 'Recife' },
				{ key: 'cidade', value: 'Recife' },
				{ key: ' ', value: 'ignored' },
			]),
			[
				ok([PLAN_FIELD]),
				ok(
					{ key: 'cidade', label: 'cidade', type: 'text', options: [], result: 'created' },
					undefined,
					201,
				),
				leadResponse,
			],
		);

		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			`GET ${BASE}/custom-fields`,
			`POST ${BASE}/custom-fields`,
			`POST ${BASE}/leads`,
		]);
		expect(calls[1].body).toEqual({ key: 'cidade', label: 'cidade', type: 'text' });
		expect(calls[2].body).toMatchObject({ customFields: { PLANO: 'ouro', cidade: 'Recife' } });
	});

	it('creates a missing key once for several items', async () => {
		const { calls } = await run(
			[
				upsert(true, [{ key: 'cidade', value: 'Recife' }]),
				upsert(true, [{ key: 'cidade', value: 'Olinda' }]),
			],
			[
				ok([]),
				ok(
					{ key: 'cidade', label: 'cidade', type: 'text', options: [], result: 'created' },
					undefined,
					201,
				),
				leadResponse,
				leadResponse,
			],
		);

		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			`GET ${BASE}/custom-fields`,
			`POST ${BASE}/custom-fields`,
			`POST ${BASE}/leads`,
			`POST ${BASE}/leads`,
		]);
	});

	it('is off by default: a missing key goes with the lead and no field is created', async () => {
		const { calls } = await run(upsert(false, [{ key: 'cidade', value: 'Recife' }]), [
			ok([]),
			leadResponse,
		]);

		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
			`GET ${BASE}/custom-fields`,
			`POST ${BASE}/leads`,
		]);
	});

	it('does not send the lead when the CRM refuses a key', async () => {
		const { items, calls } = await run(
			upsert(true, [{ key: 'qual seu cargo', value: 'Dono' }]),
			[
				ok([]),
				apiError(400, 'validation_error', 'Dados inválidos na requisição.', {
					details: [{ path: 'key', message: 'Invalid string' }],
				}),
			],
			{ continueOnFail: true },
		);

		expect(calls.map((c) => c.url)).toEqual([`${BASE}/custom-fields`, `${BASE}/custom-fields`]);
		expect(items[0].json.error).toBeDefined();
	});
});

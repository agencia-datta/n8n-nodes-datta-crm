import { describe, expect, it } from 'vitest';
import type { INodeExecutionData } from 'n8n-workflow';
import { DattaCrm } from '../nodes/DattaCrm/DattaCrm.node';
import { apiError, createExecuteContext, ok, type Params } from './helpers';

const URL = 'https://crm.example.com/api/v1/ad-metrics';

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

function records(count: number): INodeExecutionData[] {
	return Array.from({ length: count }, (_, n) => ({
		json: { date: '2026-11-01', adId: `ad-${n}`, spend: n },
	}));
}

const base = { resource: 'adMetric', operation: 'send', platform: 'meta', records: 'inputItems' };

describe('Ad Metric: Send', () => {
	it('envia 1.200 itens em 3 lotes de 500, 500 e 200 para /api/v1/ad-metrics', async () => {
		const { items, calls } = await run(
			{ ...base, batchSize: 500 },
			[ok({ upserted: 500 }), ok({ upserted: 500 }), ok({ upserted: 200 })],
			{ items: records(1200) },
		);

		expect(calls).toHaveLength(3);
		for (const call of calls) expect(call).toMatchObject({ method: 'POST', url: URL });
		expect(calls.map((call) => call.body.records.length)).toEqual([500, 500, 200]);
		expect(calls[0].body.records[0]).toEqual({ date: '2026-11-01', adId: 'ad-0', spend: 0 });
		expect(calls[2].body.records[199]).toMatchObject({ adId: 'ad-1199' });
		expect(items.map((item) => item.json)).toEqual([
			{ upserted: 500 },
			{ upserted: 500 },
			{ upserted: 200 },
		]);
	});

	it('platform vai no corpo', async () => {
		const { calls } = await run(
			{ ...base, platform: 'tiktok', batchSize: 500 },
			[ok({ upserted: 1 })],
			{ items: records(1) },
		);

		expect(calls[0].body.platform).toBe('tiktok');
	});

	it('erro 400 da API vira erro do nó com a mensagem da API', async () => {
		const failing = run(
			{ ...base, batchSize: 500 },
			[
				apiError(400, 'validation_error', 'Invalid request body', {
					details: [{ path: 'records.0.date', message: 'Invalid date' }],
				}),
			],
			{ items: records(1) },
		);

		await expect(failing).rejects.toThrow('Invalid request body');
		await expect(failing).rejects.toMatchObject({
			description: expect.stringContaining('records.0.date: Invalid date'),
		});
	});

	it('respeita o tamanho de lote escolhido e limita a 500', async () => {
		const small = await run({ ...base, batchSize: 2 }, [ok({ upserted: 2 }), ok({ upserted: 1 })], {
			items: records(3),
		});
		expect(small.calls.map((call) => call.body.records.length)).toEqual([2, 1]);

		const capped = await run(
			{ ...base, batchSize: 9999 },
			[ok({ upserted: 500 }), ok({ upserted: 1 })],
			{
				items: records(501),
			},
		);
		expect(capped.calls.map((call) => call.body.records.length)).toEqual([500, 1]);
	});

	it('modo JSON envia a lista informada, aceitando texto ou array', async () => {
		const list = [{ date: '2026-11-01', adId: 'a1', campaignName: 'Black' }];
		const { calls } = await run(
			[
				{ ...base, records: 'json', recordsJson: JSON.stringify(list), batchSize: 500 },
				{ ...base, records: 'json', recordsJson: list, platform: 'google', batchSize: 500 },
			],
			[ok({ upserted: 1 }), ok({ upserted: 1 })],
		);

		expect(calls.map((call) => call.body)).toEqual([
			{ platform: 'meta', records: list },
			{ platform: 'google', records: list },
		]);
	});

	it('falha sem registros e sem chamar a API', async () => {
		const { ctx, request } = createExecuteContext({
			params: { ...base, batchSize: 500 },
			items: [],
		});
		// No input items: nothing runs, nothing is sent.
		const result = await new DattaCrm().execute.call(ctx);
		expect(result[0]).toEqual([]);
		expect(request).not.toHaveBeenCalled();

		await expect(
			run({ ...base, records: 'json', recordsJson: '[]', batchSize: 500 }, []),
		).rejects.toThrow(/at least one record/i);
		await expect(
			run({ ...base, records: 'json', recordsJson: '{"a":1}', batchSize: 500 }, []),
		).rejects.toThrow(/JSON array/);
	});

	it('um erro no lote 2 diz qual lote falhou', async () => {
		const failing = run(
			{ ...base, batchSize: 2 },
			[ok({ upserted: 2 }), apiError(400, 'validation_error', 'Invalid request body')],
			{ items: records(3) },
		);
		await expect(failing).rejects.toMatchObject({
			description: expect.stringContaining('batch 2 of 2'),
		});
	});
});

import { describe, expect, it } from 'vitest';
import { DattaCrm } from '../nodes/DattaCrm/DattaCrm.node';
import { apiError, createExecuteContext, ok, type Params } from './helpers';

const URL = 'https://crm.example.com/api/v1/reports/weekly-summary';

type Options = Parameters<typeof createExecuteContext>[0];

async function run(params: Params | Params[], responses: NonNullable<Options>['responses']) {
	const { ctx, request } = createExecuteContext({ params, responses });
	const result = await new DattaCrm().execute.call(ctx);
	const calls = request.mock.calls.map((call) => call[1]);
	return { items: result[0], calls };
}

const base = { resource: 'report', operation: 'getWeeklySummary' };

const summary = {
	organizationId: 'org-1',
	range: { de: '2026-11-03', ate: '2026-11-09' },
	currency: 'BRL',
	total: { funnelId: null, funnelName: null, spend: 100, signups: 10, sales: 1, revenue: 997, mql: 4, sql: null, levels: [] },
	funnels: [],
};

describe('Report: Get Weekly Summary', () => {
	it('sends de and ate and returns the summary unchanged', async () => {
		const { items, calls } = await run(
			{ ...base, startDate: '2026-11-03', endDate: '2026-11-09', options: {} },
			[ok(summary)],
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method: 'GET', url: URL });
		expect(calls[0].qs).toEqual({ de: '2026-11-03', ate: '2026-11-09' });
		expect(items.map((item) => item.json)).toEqual([summary]);
	});

	it('sends timezone and funis, and takes the day of a date-time', async () => {
		const { calls } = await run(
			{
				...base,
				startDate: '2026-11-03T00:00:00',
				endDate: ' 2026-11-09 ',
				options: { timezone: 'UTC', funnels: ' Launch, Evergreen ' },
			},
			[ok(summary)],
		);
		expect(calls[0].qs).toEqual({ de: '2026-11-03', ate: '2026-11-09', timezone: 'UTC', funis: 'Launch, Evergreen' });
	});

	it('rejects a date that is not YYYY-MM-DD before calling the API', async () => {
		await expect(
			run({ ...base, startDate: '03/11/2026', endDate: '2026-11-09', options: {} }, []),
		).rejects.toThrow('"Start Date" must be a date as YYYY-MM-DD');
	});

	it('shows the API error message', async () => {
		await expect(
			run({ ...base, startDate: '2026-11-10', endDate: '2026-11-09', options: {} }, [
				apiError(400, 'validation_error', 'Dados inválidos.'),
			]),
		).rejects.toThrow('Dados inválidos.');
	});
});

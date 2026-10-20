import { describe, expect, it } from 'vitest';
import {
	getAllStages,
	getCustomFields,
	getEvents,
	getForms,
	getLists,
	getMembers,
	getMembersWithNoOwner,
	getPipelines,
	getStages,
	getTags,
} from '../nodes/DattaCrm/shared/loadOptions';
import { createLoadOptionsContext, ok, page, type Params } from './helpers';

const pipelines = [
	{
		id: 'p1',
		name: 'Sales',
		color: null,
		stages: [
			{ id: 's1', name: 'New', kind: 'open', position: 0, probability: 10 },
			{ id: 's2', name: 'Won', kind: 'won', position: 1, probability: 100 },
		],
	},
	{
		id: 'p2',
		name: 'Support',
		color: '#fff',
		stages: [{ id: 's3', name: 'Triage', kind: 'open', position: 0, probability: 0 }],
	},
];

function stagesContext(currentParams: Params) {
	return createLoadOptionsContext({ currentParams, responses: [ok(pipelines)] });
}

describe('loadOptions', () => {
	it('getPipelines maps name and id from GET /pipelines', async () => {
		const { ctx, request } = createLoadOptionsContext({ responses: [ok(pipelines)] });

		expect(await getPipelines.call(ctx)).toEqual([
			{ name: 'Sales', value: 'p1' },
			{ name: 'Support', value: 'p2' },
		]);
		expect(request.mock.calls[0][1]).toMatchObject({
			method: 'GET',
			url: 'https://crm.example.com/api/v1/pipelines',
		});
	});

	it('getStages with a pipeline returns only that pipeline stages', async () => {
		const { ctx } = stagesContext({ pipelineId: 'p1' });

		expect(await getStages.call(ctx)).toEqual([
			{ name: 'New', value: 's1' },
			{ name: 'Won', value: 's2' },
		]);
	});

	it.each([
		['additionalFields.pipelineId', { additionalFields: { pipelineId: 'p2' } }],
		['filters.pipelineId', { filters: { pipelineId: 'p2' } }],
		['updateFields.pipelineId', { updateFields: { pipelineId: 'p2' } }],
	])('getStages falls back to %s', async (_name, currentParams) => {
		const { ctx } = stagesContext(currentParams);

		expect(await getStages.call(ctx)).toEqual([{ name: 'Triage', value: 's3' }]);
	});

	it('getStages prefers the top-level pipelineId', async () => {
		const { ctx } = stagesContext({
			pipelineId: 'p1',
			additionalFields: { pipelineId: 'p2' },
		});

		expect((await getStages.call(ctx)).map((o) => o.value)).toEqual(['s1', 's2']);
	});

	it('getStages without a pipeline returns every stage as "pipeline / stage"', async () => {
		const { ctx } = stagesContext({});

		expect(await getStages.call(ctx)).toEqual([
			{ name: 'Sales / New', value: 's1' },
			{ name: 'Sales / Won', value: 's2' },
			{ name: 'Support / Triage', value: 's3' },
		]);
	});

	it('getStages survives a context that throws when reading a current parameter', async () => {
		const { ctx } = stagesContext({});
		(ctx as unknown as { getCurrentNodeParameter: () => never }).getCurrentNodeParameter = () => {
			throw new Error('not available');
		};

		expect(await getStages.call(ctx)).toHaveLength(3);
	});

	it('getAllStages returns every stage as "pipeline / stage"', async () => {
		const { ctx } = stagesContext({ pipelineId: 'p1' });

		expect(await getAllStages.call(ctx)).toEqual([
			{ name: 'Sales / New', value: 's1' },
			{ name: 'Sales / Won', value: 's2' },
			{ name: 'Support / Triage', value: 's3' },
		]);
	});

	it('getTags uses the tag name as the value', async () => {
		const { ctx } = createLoadOptionsContext({
			responses: [ok([{ id: 't1', name: 'vip', color: '#000', count: 3 }])],
		});

		expect(await getTags.call(ctx)).toEqual([{ name: 'vip', value: 'vip' }]);
	});

	it('getLists uses the list id as the value', async () => {
		const { ctx, request } = createLoadOptionsContext({
			responses: [ok([{ id: 'l1', name: 'Newsletter', isDefault: true, count: 2 }])],
		});

		expect(await getLists.call(ctx)).toEqual([{ name: 'Newsletter', value: 'l1' }]);
		expect(request.mock.calls[0][1]).toMatchObject({
			url: 'https://crm.example.com/api/v1/lists',
		});
	});

	it('getMembers names a member "name (email)" and falls back to the email', async () => {
		const { ctx } = createLoadOptionsContext({
			responses: [
				ok([
					{ id: 'm1', name: 'Ana Souza', email: 'ana@example.com' },
					{ id: 'm2', name: null, email: 'bob@example.com' },
				]),
			],
		});

		expect(await getMembers.call(ctx)).toEqual([
			{ name: 'Ana Souza (ana@example.com)', value: 'm1' },
			{ name: 'bob@example.com', value: 'm2' },
		]);
	});

	it('getMembersWithNoOwner puts "No Owner" first', async () => {
		const { ctx } = createLoadOptionsContext({
			responses: [ok([{ id: 'm1', name: null, email: 'ana@example.com' }])],
		});

		expect(await getMembersWithNoOwner.call(ctx)).toEqual([
			{ name: 'No Owner', value: '__none__' },
			{ name: 'ana@example.com', value: 'm1' },
		]);
	});

	it('getCustomFields uses the label as the name, the key as the value and the type as description', async () => {
		const { ctx } = createLoadOptionsContext({
			responses: [ok([{ key: 'plano', label: 'Plan', type: 'select', options: [] }])],
		});

		expect(await getCustomFields.call(ctx)).toEqual([
			{ name: 'Plan', value: 'plano', description: 'select' },
		]);
	});

	it('getForms follows every page', async () => {
		const { ctx, request } = createLoadOptionsContext({
			responses: [
				page([{ id: 'f1', name: 'Landing' }], 'c2'),
				page([{ id: 'f2', name: 'Quiz' }], null),
			],
		});

		expect(await getForms.call(ctx)).toEqual([
			{ name: 'Landing', value: 'f1' },
			{ name: 'Quiz', value: 'f2' },
		]);
		expect(request.mock.calls[1][1].qs).toMatchObject({ cursor: 'c2' });
	});

	it('getEvents uses the label as the name and the id as value and description', async () => {
		const { ctx, request } = createLoadOptionsContext({
			responses: [
				ok([{ id: 'lead.created', group: 'Leads', label: 'Lead created', filters: ['tag'] }]),
			],
		});

		expect(await getEvents.call(ctx)).toEqual([
			{ name: 'Lead created', value: 'lead.created', description: 'lead.created' },
		]);
		expect(request.mock.calls[0][1]).toMatchObject({
			url: 'https://crm.example.com/api/v1/webhooks/events',
		});
	});
});

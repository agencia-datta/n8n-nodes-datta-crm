import { describe, expect, it } from 'vitest';
import {
	getAllStages,
	getCustomFields,
	getEvents,
	getFolders,
	getForms,
	getLists,
	getLossReasons,
	getMembers,
	getMembersWithNoOwner,
	getStages,
	getTags,
} from '../nodes/DattaCrm/shared/loadOptions';
import { createLoadOptionsContext, ok, page, type Params } from './helpers';

const lists = [
	{
		id: 'l1',
		name: 'Leads',
		isDefault: false,
		folderId: 'f1',
		folderName: 'WhatsApp',
		count: 2,
		hasFunnel: true,
		stages: [
			{ id: 's1', name: 'New', kind: 'active', position: 0 },
			{ id: 's2', name: 'Won', kind: 'won', position: 1 },
		],
	},
	{
		id: 'l2',
		name: 'Newsletter',
		isDefault: false,
		folderId: 'f2',
		folderName: 'Site',
		count: 1,
		hasFunnel: false,
		stages: [],
	},
	{
		id: 'l3',
		name: 'Ads',
		isDefault: false,
		folderId: 'f3',
		folderName: 'Instagram',
		count: 0,
		hasFunnel: true,
		stages: [{ id: 's3', name: 'Triage', kind: 'active', position: 0 }],
	},
];

function stagesContext(currentParams: Params) {
	return createLoadOptionsContext({ currentParams, responses: [ok(lists)] });
}

describe('loadOptions', () => {
	it('getStages with a list returns only that list stages, from GET /lists', async () => {
		const { ctx, request } = stagesContext({ listId: 'l1' });

		expect(await getStages.call(ctx)).toEqual([
			{ name: 'New', value: 's1' },
			{ name: 'Won', value: 's2' },
		]);
		expect(request.mock.calls[0][1]).toMatchObject({
			method: 'GET',
			url: 'https://crm.example.com/api/v1/lists',
		});
	});

	it('getStages with a Site list returns nothing', async () => {
		const { ctx } = stagesContext({ listId: 'l2' });

		expect(await getStages.call(ctx)).toEqual([]);
	});

	it('getStages without a list returns every stage as "folder / list / stage"', async () => {
		const { ctx } = stagesContext({});

		expect(await getStages.call(ctx)).toEqual([
			{ name: 'WhatsApp / Leads / New', value: 's1' },
			{ name: 'WhatsApp / Leads / Won', value: 's2' },
			{ name: 'Instagram / Ads / Triage', value: 's3' },
		]);
	});

	it('getStages survives a context that throws when reading a current parameter', async () => {
		const { ctx } = stagesContext({});
		(ctx as unknown as { getCurrentNodeParameter: () => never }).getCurrentNodeParameter = () => {
			throw new Error('not available');
		};

		expect(await getStages.call(ctx)).toHaveLength(3);
	});

	it('getAllStages returns every stage as "folder / list / stage"', async () => {
		const { ctx } = stagesContext({ listId: 'l1' });

		expect((await getAllStages.call(ctx)).map((o) => o.name)).toEqual([
			'WhatsApp / Leads / New',
			'WhatsApp / Leads / Won',
			'Instagram / Ads / Triage',
		]);
	});

	it('getLossReasons maps name and id from GET /loss-reasons', async () => {
		const { ctx, request } = createLoadOptionsContext({
			responses: [ok([{ id: 'r1', name: 'Price' }])],
		});

		expect(await getLossReasons.call(ctx)).toEqual([{ name: 'Price', value: 'r1' }]);
		expect(request.mock.calls[0][1]).toMatchObject({
			url: 'https://crm.example.com/api/v1/loss-reasons',
		});
	});

	it('getTags uses the tag name as the value', async () => {
		const { ctx } = createLoadOptionsContext({
			responses: [ok([{ id: 't1', name: 'vip', color: '#000', count: 3 }])],
		});

		expect(await getTags.call(ctx)).toEqual([{ name: 'vip', value: 'vip' }]);
	});

	it('getLists names a list "folder / list" and uses its id as the value', async () => {
		const { ctx, request } = createLoadOptionsContext({
			responses: [
				ok([
					{
						id: 'l1',
						name: 'Newsletter',
						isDefault: false,
						folderId: 'f1',
						folderName: 'Site',
						count: 2,
					},
				]),
			],
		});

		expect(await getLists.call(ctx)).toEqual([{ name: 'Site / Newsletter', value: 'l1' }]);
		expect(request.mock.calls[0][1]).toMatchObject({
			url: 'https://crm.example.com/api/v1/lists',
		});
	});

	it('getFolders names a folder "origin / folder" and uses its id as the value', async () => {
		const { ctx, request } = createLoadOptionsContext({
			responses: [
				ok([
					{ id: 'f1', name: 'Leads', origin: 'instagram' },
					{ id: 'f2', name: 'Leads', origin: 'whatsapp' },
					{ id: 'f3', name: 'Site', origin: 'site' },
				]),
			],
		});

		expect(await getFolders.call(ctx)).toEqual([
			{ name: 'Instagram / Leads', value: 'f1' },
			{ name: 'WhatsApp / Leads', value: 'f2' },
			{ name: 'Site / Site', value: 'f3' },
		]);
		expect(request.mock.calls[0][1]).toMatchObject({
			url: 'https://crm.example.com/api/v1/folders',
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

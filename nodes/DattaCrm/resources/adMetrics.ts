import {
	NodeApiError,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
	type JsonObject,
} from 'n8n-workflow';
import { dattaCrmRequest } from '../shared/transport';
import { parseJsonArray, runOperation, type ResourceExecutor } from '../shared/utils';

const AD_METRIC = { resource: ['adMetric'] };
const SEND = { ...AD_METRIC, operation: ['send'] };

/** Most records `POST /ad-metrics` accepts in one request. */
const MAX_BATCH_SIZE = 500;

export const adMetricOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: AD_METRIC },
		options: [
			{
				name: 'Send',
				value: 'send',
				description:
					'Send daily ad metrics of a platform. A record of the same day and ad is updated.',
				action: 'Send ad metrics',
			},
		],
		default: 'send',
	},
];

export const adMetricFields: INodeProperties[] = [
	{
		displayName:
			'Each record needs a "date" (YYYY-MM-DD) and an "adId". Optional: accountId, accountName, campaignId, campaignName, adsetId, adsetName, adName, adStatus, adUrl, adThumbnail, spend, impressions, reach, clicks, pageViews, platformLeads, checkouts, platformPurchases, platformRevenue, messagingStarted, currency and extra (an object). Needs a read and write key.',
		name: 'sendNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: SEND },
	},
	{
		displayName: 'Platform',
		name: 'platform',
		type: 'options',
		required: true,
		options: [
			{ name: 'Google', value: 'google' },
			{ name: 'LinkedIn', value: 'linkedin' },
			{ name: 'Meta', value: 'meta' },
			{ name: 'TikTok', value: 'tiktok' },
		],
		default: 'meta',
		displayOptions: { show: SEND },
		description: 'Ad platform the metrics come from',
	},
	{
		displayName: 'Records',
		name: 'records',
		type: 'options',
		options: [
			{
				name: 'Use Input Items',
				value: 'inputItems',
				description:
					'Send every input item as a record, already in the camelCase format. All items are sent in one run, in batches.',
			},
			{
				name: 'JSON',
				value: 'json',
				description: 'Send the list of records written below, for each input item',
			},
		],
		default: 'inputItems',
		displayOptions: { show: SEND },
	},
	{
		displayName: 'Records (JSON)',
		name: 'recordsJson',
		type: 'json',
		required: true,
		default: '[\n  {\n    "date": "2026-11-01",\n    "adId": "123",\n    "spend": 10.5\n  }\n]',
		displayOptions: { show: { ...SEND, records: ['json'] } },
		description: 'A JSON array of records',
	},
	{
		displayName: 'Batch Size',
		name: 'batchSize',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: MAX_BATCH_SIZE, numberPrecision: 0 },
		default: MAX_BATCH_SIZE,
		displayOptions: { show: SEND },
		description: 'Max number of records per request. The API accepts up to 500.',
	},
];

export const adMetricDescription: INodeProperties[] = [...adMetricOperations, ...adMetricFields];

function batchSizeOf(raw: unknown): number {
	const size = Math.trunc(Number(raw));
	if (!Number.isFinite(size) || size < 1) return MAX_BATCH_SIZE;
	return Math.min(size, MAX_BATCH_SIZE);
}

/** Tells which batch failed; the API paths (`records.3.date`) are relative to that batch. */
function describeBatchFailure(
	error: NodeApiError,
	batch: number,
	batches: number,
	first: number,
	last: number,
): void {
	const where =
		`Failed in batch ${batch} of ${batches} (records ${first + 1} to ${last} of the list; ` +
		`"records.N" in the message counts inside this batch, starting at 0). ` +
		`Earlier batches were already saved.`;
	error.description = error.description ? `${error.description}\n${where}` : where;
}

async function sendInBatches(
	context: IExecuteFunctions,
	platform: string,
	list: IDataObject[],
	batchSize: number,
): Promise<IDataObject[]> {
	const batches = Math.ceil(list.length / batchSize);
	const results: IDataObject[] = [];
	for (let n = 0; n < batches; n++) {
		const first = n * batchSize;
		const last = Math.min(first + batchSize, list.length);
		try {
			const data = (await dattaCrmRequest.call(context, 'POST', '/ad-metrics', {
				platform,
				records: list.slice(first, last),
			})) as IDataObject | undefined;
			results.push({ upserted: Number(data?.upserted ?? 0) });
		} catch (error) {
			if (error instanceof NodeApiError) describeBatchFailure(error, n + 1, batches, first, last);
			// The constructor returns an existing NodeApiError unchanged.
			throw new NodeApiError(context.getNode(), error as unknown as JsonObject);
		}
	}
	return results;
}

async function sendAdMetrics(this: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const platform = this.getNodeParameter('platform', i) as string;
	const batchSize = batchSizeOf(this.getNodeParameter('batchSize', i, MAX_BATCH_SIZE));
	const source = this.getNodeParameter('records', i, 'inputItems') as string;

	let list: IDataObject[];
	if (source === 'json') {
		list = parseJsonArray(this, this.getNodeParameter('recordsJson', i, '[]'), 'Records', i);
	} else {
		// One run covers every input item, so the later items have nothing left to do.
		if (i !== 0) return [];
		list = this.getInputData().map((item) => item.json);
	}

	if (list.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Send at least one record', {
			itemIndex: i,
			description: 'The list of records is empty.',
		});
	}
	return sendInBatches(this, platform, list, batchSize);
}

const operations: Record<string, ResourceExecutor> = {
	send: sendAdMetrics,
};

export async function executeAdMetric(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	return runOperation(this, itemIndex, 'ad metric', operations);
}

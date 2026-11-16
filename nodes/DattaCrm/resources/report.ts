import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
} from 'n8n-workflow';
import { dattaCrmRequest } from '../shared/transport';
import { compact, runOperation, type ResourceExecutor } from '../shared/utils';

const REPORT = { resource: ['report'] };
const WEEKLY_SUMMARY = { show: { ...REPORT, operation: ['getWeeklySummary'] } };

export const reportOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: REPORT },
		options: [
			{
				name: 'Get Weekly Summary',
				value: 'getWeeklySummary',
				description:
					'Get the totals of a period (ad spend, sign-ups, sales, revenue and MQL levels) for the account and each funnel',
				action: 'Get the weekly summary',
			},
		],
		default: 'getWeeklySummary',
	},
];

export const reportFields: INodeProperties[] = [
	{
		displayName: 'Start Date',
		name: 'startDate',
		type: 'string',
		required: true,
		default: '',
		placeholder: '2026-11-03',
		displayOptions: WEEKLY_SUMMARY,
		description: 'First day of the period (included), as YYYY-MM-DD. Sent as `de`.',
	},
	{
		displayName: 'End Date',
		name: 'endDate',
		type: 'string',
		required: true,
		default: '',
		placeholder: '2026-11-09',
		displayOptions: WEEKLY_SUMMARY,
		description:
			'Last day of the period (included), as YYYY-MM-DD. At most 366 days counting both. Sent as `ate`.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: WEEKLY_SUMMARY,
		options: [
			{
				displayName: 'Funnels',
				name: 'funnels',
				type: 'string',
				default: '',
				placeholder: 'Launch, Evergreen',
				description:
					'Funnel names separated by commas, case-insensitive. Empty returns every funnel. The account total always comes. Sent as `funis`.',
			},
			{
				displayName: 'Timezone',
				name: 'timezone',
				type: 'string',
				default: 'America/Sao_Paulo',
				description: 'IANA time zone in which the days are counted',
			},
		],
	},
];

export const reportDescription: INodeProperties[] = [...reportOperations, ...reportFields];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts YYYY-MM-DD, or an ISO date-time whose date part is used as is. */
function toDay(
	context: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
): string {
	const text = String(value ?? '').trim();
	const day = text.slice(0, 10);
	if (!DATE.test(day) || (text.length > 10 && text[10] !== 'T' && text[10] !== ' ')) {
		throw new NodeOperationError(context.getNode(), `"${label}" must be a date as YYYY-MM-DD`, {
			itemIndex,
			description: `Received "${text}".`,
		});
	}
	return day;
}

async function getWeeklySummary(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const options = this.getNodeParameter('options', i, {}) as IDataObject;
	const timezone = String(options.timezone ?? '').trim();
	const funnels = String(options.funnels ?? '').trim();
	const qs = compact({
		de: toDay(this, this.getNodeParameter('startDate', i), 'Start Date', i),
		ate: toDay(this, this.getNodeParameter('endDate', i), 'End Date', i),
		timezone: timezone === '' ? undefined : timezone,
		funis: funnels === '' ? undefined : funnels,
	});
	return dattaCrmRequest.call(this, 'GET', '/reports/weekly-summary', undefined, qs);
}

const operations: Record<string, ResourceExecutor> = {
	getWeeklySummary,
};

export async function executeReport(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	return runOperation(this, itemIndex, 'report', operations);
}

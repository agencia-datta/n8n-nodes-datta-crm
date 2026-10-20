import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeProperties,
} from 'n8n-workflow';
import { dattaCrmRequest } from '../shared/transport';
import {
	compact,
	fetchMany,
	idPath,
	requireNonEmptyBody,
	requireText,
	runOperation,
	toIsoDate,
	type ResourceExecutor,
} from '../shared/utils';

const SALE = { resource: ['sale'] };

const statusOptions = [
	{ name: 'Abandoned', value: 'abandoned' },
	{ name: 'Canceled', value: 'canceled' },
	{ name: 'Chargeback', value: 'chargeback' },
	{ name: 'Paid', value: 'paid' },
	{ name: 'Pending', value: 'pending' },
	{ name: 'Refunded', value: 'refunded' },
];

const MIRROR_NUMBERS: Array<[key: string, displayName: string, description: string]> = [
	['affiliateValue', 'Affiliate Value', 'Commission paid to the affiliate'],
	['buyerTaxes', 'Buyer Taxes', 'Taxes charged to the buyer'],
	['coproducerValue', 'Coproducer Value', 'Amount that goes to the coproducer'],
	['grossValue', 'Gross Value', 'Amount paid by the buyer, before fees'],
	['installmentFee', 'Installment Fee', 'Fee charged for paying in installments'],
	['otherFees', 'Other Fees', 'Any other fees charged on the sale'],
	['processingFee', 'Processing Fee', 'Fee charged by the payment processor'],
	['producerNetValue', 'Producer Net Value', 'Amount the producer receives'],
	['streamingFee', 'Streaming Fee', 'Fee charged by the streaming platform'],
];

const mirrorOptions: INodeProperties[] = [
	{
		displayName: 'Affiliate Name',
		name: 'affiliateName',
		type: 'string',
		default: '',
		description: 'Name of the affiliate who made the sale',
	},
	{
		displayName: 'Approved At',
		name: 'approvedAt',
		type: 'dateTime',
		default: '',
		description: 'When the payment was approved',
	},
	{
		displayName: 'Coupon Code',
		name: 'couponCode',
		type: 'string',
		default: '',
		description: 'Coupon used in the purchase',
	},
	{
		displayName: 'Installments',
		name: 'installments',
		type: 'number',
		typeOptions: { minValue: 1, numberPrecision: 0 },
		default: 1,
		description: 'Number of installments',
	},
	{
		displayName: 'Offer Code',
		name: 'offerCode',
		type: 'string',
		default: '',
		description: 'Code of the offer purchased',
	},
	{
		displayName: 'Offer Name',
		name: 'offerName',
		type: 'string',
		default: '',
		description: 'Name of the offer purchased',
	},
	{
		displayName: 'Payout Currency',
		name: 'payoutCurrency',
		type: 'string',
		default: '',
		description: 'Currency of the amounts paid out to the producer, such as BRL',
	},
	...MIRROR_NUMBERS.map(
		([name, displayName, description]): INodeProperties => ({
			displayName,
			name,
			type: 'number',
			typeOptions: { numberPrecision: 2 },
			default: 0,
			description,
		}),
	),
];
mirrorOptions.sort((a, b) => a.displayName.localeCompare(b.displayName));

const mirrorProperty: INodeProperties = {
	displayName: 'Financial Details',
	name: 'mirror',
	type: 'collection',
	placeholder: 'Add Detail',
	default: {},
	description: 'Gross, net and fee amounts of the sale, as reported by the gateway',
	options: mirrorOptions,
};

const buyerProperty: INodeProperties = {
	displayName: 'Buyer',
	name: 'buyer',
	type: 'collection',
	placeholder: 'Add Buyer Detail',
	default: {},
	description: 'The buyer. The sale is linked to a lead matched by email or phone.',
	options: [
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			placeholder: 'name@email.com',
			default: '',
		},
		{ displayName: 'Name', name: 'name', type: 'string', default: '' },
		{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
	],
};

const utmProperty: INodeProperties = {
	displayName: 'UTM',
	name: 'utm',
	type: 'collection',
	placeholder: 'Add UTM Parameter',
	default: {},
	options: [
		{ displayName: 'Campaign', name: 'campaign', type: 'string', default: '' },
		{ displayName: 'Content', name: 'content', type: 'string', default: '' },
		{ displayName: 'Medium', name: 'medium', type: 'string', default: '' },
		{ displayName: 'Source', name: 'source', type: 'string', default: '' },
		{ displayName: 'Term', name: 'term', type: 'string', default: '' },
	],
};

/** Fields shared by Create or Update and Update, in alphabetical order. */
const sharedOptions: Record<
	| 'buyer'
	| 'currency'
	| 'mirror'
	| 'occurredAt'
	| 'paymentType'
	| 'productId'
	| 'productName'
	| 'utm',
	INodeProperties
> = {
	buyer: buyerProperty,
	currency: {
		displayName: 'Currency',
		name: 'currency',
		type: 'string',
		default: '',
		description: 'Currency code of the sale, such as BRL',
	},
	mirror: mirrorProperty,
	occurredAt: {
		displayName: 'Occurred At',
		name: 'occurredAt',
		type: 'dateTime',
		default: '',
		description: 'When the sale happened. Defaults to now.',
	},
	paymentType: {
		displayName: 'Payment Type',
		name: 'paymentType',
		type: 'string',
		default: '',
		description: 'How the buyer paid, such as card, pix or boleto',
	},
	productId: {
		displayName: 'Product ID',
		name: 'productId',
		type: 'string',
		default: '',
		description: 'ID of the product in the gateway',
	},
	productName: {
		displayName: 'Product Name',
		name: 'productName',
		type: 'string',
		default: '',
		description: 'Name of the product',
	},
	utm: utmProperty,
};

const statusProperty: INodeProperties = {
	displayName: 'Status',
	name: 'status',
	type: 'options',
	options: statusOptions,
	default: 'paid',
	description: 'Status of the sale',
};

const valueProperty: INodeProperties = {
	displayName: 'Value',
	name: 'value',
	type: 'number',
	typeOptions: { numberPrecision: 2 },
	default: 0,
	description: 'Value of the sale',
};

export const saleOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: SALE },
		options: [
			{
				name: 'Create or Update',
				value: 'upsert',
				description: 'Create a new record, or update the current one if it already exists (upsert)',
				action: 'Create or update a sale',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a sale by ID',
				action: 'Get a sale',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: 'Get many sales',
				action: 'Get many sales',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update the fields of a sale',
				action: 'Update a sale',
			},
		],
		default: 'upsert',
	},
];

export const saleFields: INodeProperties[] = [
	// Create or Update
	{
		displayName:
			'Matches an existing sale by gateway and transaction ID and updates only the fields sent.',
		name: 'upsertNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { ...SALE, operation: ['upsert'] } },
	},
	{
		displayName: 'Transaction ID',
		name: 'transactionId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { ...SALE, operation: ['upsert'] } },
		description: 'ID of the transaction in the gateway',
	},
	{
		...statusProperty,
		required: true,
		displayOptions: { show: { ...SALE, operation: ['upsert'] } },
	},
	{
		...valueProperty,
		required: true,
		displayOptions: { show: { ...SALE, operation: ['upsert'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...SALE, operation: ['upsert'] } },
		options: [
			sharedOptions.buyer,
			sharedOptions.currency,
			sharedOptions.mirror,
			{
				displayName: 'Gateway',
				name: 'gateway',
				type: 'string',
				default: '',
				description:
					'Where the sale was made, such as hotmart or stripe. Together with the transaction ID it identifies the sale. Defaults to "api".',
			},
			sharedOptions.occurredAt,
			sharedOptions.paymentType,
			sharedOptions.productId,
			sharedOptions.productName,
			sharedOptions.utm,
		],
	},

	// Get and Update
	{
		displayName: 'Sale ID',
		name: 'saleId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { ...SALE, operation: ['get', 'update'] } },
		description: 'ID of the sale',
	},

	// Update
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { ...SALE, operation: ['update'] } },
		description:
			'Fields to change. Choose at least one. The gateway and transaction ID cannot be changed.',
		options: [
			sharedOptions.buyer,
			sharedOptions.currency,
			sharedOptions.mirror,
			sharedOptions.occurredAt,
			sharedOptions.paymentType,
			sharedOptions.productId,
			sharedOptions.productName,
			statusProperty,
			sharedOptions.utm,
			valueProperty,
		],
	},

	// Get Many
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { ...SALE, operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		displayOptions: { show: { ...SALE, operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { ...SALE, operation: ['getAll'] } },
		options: [
			{
				displayName: 'Gateway',
				name: 'gateway',
				type: 'string',
				default: '',
				description: 'Only sales made in this gateway',
			},
			{
				displayName: 'Lead ID',
				name: 'leadId',
				type: 'string',
				default: '',
				description: 'Only sales of this lead',
			},
			{
				displayName: 'Occurred Since',
				name: 'occurredSince',
				type: 'dateTime',
				default: '',
				description: 'Only sales that happened at or after this date',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [...statusOptions, { name: 'Other', value: 'other' }].sort((a, b) =>
					a.name.localeCompare(b.name),
				),
				default: 'paid',
				description: 'Only sales with this status',
			},
			{
				displayName: 'Transaction ID',
				name: 'transactionId',
				type: 'string',
				default: '',
				description: 'Only the sale with this transaction ID',
			},
		],
	},
];

export const saleDescription: INodeProperties[] = [...saleOperations, ...saleFields];

function nested(value: unknown): IDataObject {
	return compact((value as IDataObject | undefined) ?? {});
}

function numberOf(
	context: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
): number {
	const number = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
	if (!Number.isFinite(number)) {
		throw new NodeOperationError(context.getNode(), `"${label}" must be a number`, {
			itemIndex,
			description: `Received "${String(value)}".`,
		});
	}
	return number;
}

function buildMirror(context: IExecuteFunctions, raw: unknown, itemIndex: number): IDataObject {
	const mirror = nested(raw);
	if (mirror.installments !== undefined) {
		mirror.installments = Math.trunc(
			numberOf(context, mirror.installments, 'Installments', itemIndex),
		);
	}
	if (mirror.approvedAt !== undefined) {
		mirror.approvedAt = toIsoDate(context, mirror.approvedAt, 'Approved At', itemIndex);
	}
	return compact(mirror);
}

/** The body fields that Create or Update and Update have in common. */
function sharedBody(
	context: IExecuteFunctions,
	fields: IDataObject,
	itemIndex: number,
): IDataObject {
	return {
		currency: fields.currency,
		productId: fields.productId,
		productName: fields.productName,
		paymentType: fields.paymentType,
		occurredAt: toIsoDate(context, fields.occurredAt, 'Occurred At', itemIndex),
		buyer: nested(fields.buyer),
		utm: nested(fields.utm),
		mirror: buildMirror(context, fields.mirror, itemIndex),
	};
}

async function upsertSale(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const transactionId = requireText(
		this,
		this.getNodeParameter('transactionId', i, ''),
		'Transaction ID',
		i,
	);
	const fields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
	const gateway = String(fields.gateway ?? '').trim();
	const body = compact({
		gateway: gateway === '' ? 'api' : gateway,
		transactionId,
		status: this.getNodeParameter('status', i) as string,
		value: numberOf(this, this.getNodeParameter('value', i), 'Value', i),
		...sharedBody(this, fields, i),
	});
	return dattaCrmRequest.call(this, 'POST', '/sales', body);
}

async function getSale(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	return dattaCrmRequest.call(this, 'GET', idPath(this, i, '/sales', 'saleId', 'Sale ID'));
}

async function getManySales(this: IExecuteFunctions, i: number): Promise<IDataObject[]> {
	const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
	const qs = compact({
		status: filters.status,
		gateway: filters.gateway,
		transactionId: filters.transactionId,
		leadId: filters.leadId,
		occurredSince: toIsoDate(this, filters.occurredSince, 'Occurred Since', i),
	});
	return fetchMany(this, i, '/sales', qs);
}

async function updateSale(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const path = idPath(this, i, '/sales', 'saleId', 'Sale ID');
	const fields = this.getNodeParameter('updateFields', i, {}) as IDataObject;
	const body = compact({
		status: fields.status,
		value: fields.value === undefined ? undefined : numberOf(this, fields.value, 'Value', i),
		...sharedBody(this, fields, i),
	});
	requireNonEmptyBody(this, body, i, 'Update Fields');
	return dattaCrmRequest.call(this, 'PATCH', path, body);
}

const operations: Record<string, ResourceExecutor> = {
	upsert: upsertSale,
	get: getSale,
	getAll: getManySales,
	update: updateSale,
};

export async function executeSale(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	return runOperation(this, itemIndex, 'sale', operations);
}

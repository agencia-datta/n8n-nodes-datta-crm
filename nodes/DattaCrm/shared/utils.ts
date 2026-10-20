import { NodeOperationError, type IDataObject, type IExecuteFunctions } from 'n8n-workflow';
import { dattaCrmRequest, dattaCrmRequestAll } from './transport';

/** Value of the "No Owner" choice of an owner selector; it is sent to the API as `null`. */
export const NO_OWNER_VALUE = '__none__';

/** Signature of a resource executor: one call per input item. */
export type ResourceExecutor = (
	this: IExecuteFunctions,
	itemIndex: number,
) => Promise<IDataObject | IDataObject[]>;

/**
 * Turns a multiOptions array, an array coming from an expression or a comma separated string into
 * a list of trimmed, non-empty strings.
 */
export function toStringArray(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	const parts = Array.isArray(value) ? value : String(value).split(',');
	return parts.map((part) => String(part).trim()).filter((part) => part !== '');
}

function isEmptyValue(value: unknown): boolean {
	if (value === undefined || value === '') return true;
	if (Array.isArray(value)) return value.length === 0;
	if (value !== null && typeof value === 'object') return Object.keys(value).length === 0;
	return false;
}

/**
 * Drops `undefined`, empty strings, empty arrays and empty objects from a request body. `0`,
 * `false` and `null` are real values (for example `ownerId: null`) and are kept.
 */
export function compact(source: IDataObject): IDataObject {
	const result: IDataObject = {};
	for (const [key, value] of Object.entries(source)) {
		if (!isEmptyValue(value)) result[key] = value;
	}
	return result;
}

/**
 * Converts the value of an n8n date/time parameter (with or without a zone) into an ISO string.
 * Returns `undefined` for an empty value and throws for an invalid one.
 */
export function toIsoDate(
	context: IExecuteFunctions,
	value: unknown,
	fieldName: string,
	itemIndex: number,
): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const date = new Date(value as string | number | Date);
	if (Number.isNaN(date.getTime())) {
		throw new NodeOperationError(context.getNode(), `"${fieldName}" is not a valid date`, {
			itemIndex,
			description: 'Use an ISO 8601 date such as 2026-10-20T10:00:00Z.',
		});
	}
	return date.toISOString();
}

/** Returns the trimmed text of a required parameter, or throws when it is empty. */
export function requireText(
	context: IExecuteFunctions,
	value: unknown,
	label: string,
	itemIndex: number,
): string {
	const text = value === undefined || value === null ? '' : String(value).trim();
	if (text === '') {
		throw new NodeOperationError(context.getNode(), `${label} is required`, { itemIndex });
	}
	return text;
}

/** Parses a JSON parameter given as a string; objects and arrays (from expressions) pass through. */
export function parseJsonParameter(
	context: IExecuteFunctions,
	value: unknown,
	fieldName: string,
	itemIndex: number,
): IDataObject | IDataObject[] {
	if (typeof value !== 'string') return value as IDataObject | IDataObject[];
	try {
		return JSON.parse(value) as IDataObject | IDataObject[];
	} catch (error) {
		throw new NodeOperationError(context.getNode(), `"${fieldName}" is not valid JSON`, {
			itemIndex,
			description: (error as Error).message,
		});
	}
}

/** Parses a JSON parameter that must be an object (arrays and `null` are rejected). */
export function parseJsonObject(
	context: IExecuteFunctions,
	value: unknown,
	fieldName: string,
	itemIndex: number,
): IDataObject {
	const parsed = parseJsonParameter(context, value, fieldName, itemIndex) as unknown;
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new NodeOperationError(context.getNode(), `"${fieldName}" must be a JSON object`, {
			itemIndex,
			description: 'Use a JSON object such as {"key": "value"}.',
		});
	}
	return parsed as IDataObject;
}

/** Parses a JSON parameter that must be an array. */
export function parseJsonArray(
	context: IExecuteFunctions,
	value: unknown,
	fieldName: string,
	itemIndex: number,
): IDataObject[] {
	const parsed = parseJsonParameter(context, value, fieldName, itemIndex) as unknown;
	if (!Array.isArray(parsed)) {
		throw new NodeOperationError(context.getNode(), `"${fieldName}" must be a JSON array`, {
			itemIndex,
			description: 'Use a JSON array such as [{"type": "email"}].',
		});
	}
	return parsed as IDataObject[];
}

/** `/base/{id}` for the ID parameter `parameter`, which must not be blank. */
export function idPath(
	context: IExecuteFunctions,
	itemIndex: number,
	base: string,
	parameter: string,
	label: string,
): string {
	const id = requireText(
		context,
		context.getNodeParameter(parameter, itemIndex, ''),
		label,
		itemIndex,
	);
	return `${base}/${encodeURIComponent(id)}`;
}

/** Get Many: reads Return All / Limit and follows the cursors of a paginated list. */
export async function fetchMany(
	context: IExecuteFunctions,
	itemIndex: number,
	path: string,
	qs: IDataObject,
): Promise<IDataObject[]> {
	const returnAll = context.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const max = returnAll ? undefined : (context.getNodeParameter('limit', itemIndex, 50) as number);
	return dattaCrmRequestAll.call(context, path, qs, max);
}

/** Throws unless the request body has at least one key. */
export function requireNonEmptyBody(
	context: IExecuteFunctions,
	body: IDataObject,
	itemIndex: number,
	groupLabel: string,
): void {
	if (Object.keys(body).length === 0) {
		throw new NodeOperationError(context.getNode(), 'Choose at least one field to update', {
			itemIndex,
			description: `Add a field under "${groupLabel}".`,
		});
	}
}

/** Runs the handler of the selected operation, or throws for an unknown one. */
export async function runOperation(
	context: IExecuteFunctions,
	itemIndex: number,
	resourceLabel: string,
	operations: Record<string, ResourceExecutor>,
): Promise<IDataObject | IDataObject[]> {
	const operation = context.getNodeParameter('operation', itemIndex) as string;
	const handler = operations[operation];
	if (handler === undefined) {
		throw new NodeOperationError(
			context.getNode(),
			`Unknown ${resourceLabel} operation "${operation}"`,
			{ itemIndex },
		);
	}
	return handler.call(context, itemIndex);
}

export interface CustomFieldEntry {
	key?: string;
	value?: unknown;
}

interface CustomFieldDefinition {
	key: string;
	label: string;
	type: string;
}

const catalogCache = new WeakMap<object, Promise<CustomFieldDefinition[]>>();

/** The custom field catalog, fetched at most once per execution (per execute context). */
function getCatalog(context: IExecuteFunctions): Promise<CustomFieldDefinition[]> {
	let catalog = catalogCache.get(context);
	if (catalog === undefined) {
		catalog = (dattaCrmRequest.call(context, 'GET', '/custom-fields') as Promise<unknown>).then(
			(data) => (Array.isArray(data) ? (data as CustomFieldDefinition[]) : []),
		);
		catalogCache.set(context, catalog);
		catalog.catch(() => catalogCache.delete(context));
	}
	return catalog;
}

function typedValue(
	context: IExecuteFunctions,
	definition: CustomFieldDefinition,
	value: unknown,
	itemIndex: number,
): unknown {
	const label = definition.label || definition.key;
	switch (definition.type) {
		case 'number': {
			const text = typeof value === 'string' ? value.trim() : value;
			const number = text === '' || typeof text === 'boolean' ? NaN : Number(text);
			if (!Number.isFinite(number)) {
				throw new NodeOperationError(context.getNode(), `"${label}" must be a number`, {
					itemIndex,
					description: `Received "${String(value)}".`,
				});
			}
			return number;
		}
		case 'boolean': {
			if (typeof value === 'boolean') return value;
			const text = String(value).trim().toLowerCase();
			if (['true', '1', 'yes'].includes(text)) return true;
			if (['false', '0', 'no'].includes(text)) return false;
			throw new NodeOperationError(context.getNode(), `"${label}" must be true or false`, {
				itemIndex,
				description: `Received "${String(value)}". Use true/1/yes or false/0/no.`,
			});
		}
		case 'multi_select':
			return toStringArray(value);
		default:
			return typeof value === 'string' ? value : String(value ?? '');
	}
}

/**
 * Builds the `customFields` object of a lead from the key/value rows of the node, typing each
 * value with the account's custom field catalog. The catalog is only requested when at least one
 * row has a key. Keys are matched case-insensitively; unknown keys keep their value as-is.
 */
export async function buildCustomFields(
	context: IExecuteFunctions,
	entries: CustomFieldEntry[] | undefined,
	itemIndex = 0,
): Promise<IDataObject> {
	const rows = (entries ?? []).filter((entry) => (entry.key ?? '').trim() !== '');
	if (rows.length === 0) return {};

	const catalog = await getCatalog(context);
	const result: IDataObject = {};
	for (const row of rows) {
		const key = (row.key as string).trim();
		const lower = key.toLowerCase();
		const definition =
			catalog.find((field) => field.key === key) ??
			catalog.find((field) => field.key.toLowerCase() === lower);
		result[key] =
			definition === undefined
				? (row.value as IDataObject[string])
				: (typedValue(context, definition, row.value, itemIndex) as IDataObject[string]);
	}
	return result;
}

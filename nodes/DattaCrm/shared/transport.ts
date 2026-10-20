import {
	NodeApiError,
	type IDataObject,
	type IExecuteFunctions,
	type IHookFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type ILoadOptionsFunctions,
	type JsonObject,
} from 'n8n-workflow';

export type DattaCrmContext = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions;

/** Largest `limit` of `GET /leads`, `/sales` and `/forms`. `/email-campaigns` allows only 50. */
const MAX_PAGE_SIZE = 200;

export function apiUrl(baseUrl: string, path: string): string {
	return baseUrl.trim().replace(/\/+$/, '') + '/api/v1' + path;
}

interface ApiErrorBody {
	error: { code?: string; message: string; details?: unknown; requestId?: string };
}

function isApiErrorBody(body: unknown): body is ApiErrorBody {
	if (body === null || typeof body !== 'object') return false;
	const error = (body as { error?: unknown }).error;
	return (
		error !== null &&
		typeof error === 'object' &&
		typeof (error as { message?: unknown }).message === 'string' &&
		(error as { message: string }).message !== ''
	);
}

function describeApiError({ error }: ApiErrorBody): string {
	const lines = [`code: ${error.code ?? 'unknown'} · requestId: ${error.requestId ?? 'unknown'}`];
	if (Array.isArray(error.details)) {
		for (const detail of error.details as Array<{ path?: unknown; message?: unknown }>) {
			const message = typeof detail?.message === 'string' ? detail.message : '';
			if (message === '') continue;
			const path = typeof detail.path === 'string' ? detail.path : '';
			lines.push(path === '' ? message : `${path}: ${message}`);
		}
	}
	return lines.join('\n');
}

/**
 * NodeApiError rewrites messages that contain well-known error tokens (for example
 * "preexistente" contains EEXIST), so the message is assigned again after construction to keep
 * the API text verbatim.
 */
function verbatimApiError(
	context: DattaCrmContext,
	errorResponse: JsonObject,
	message: string,
	description: string | undefined,
	httpCode?: string,
): NodeApiError {
	const error = new NodeApiError(context.getNode(), errorResponse, {
		message,
		description,
		httpCode,
	});
	error.message = message;
	return error;
}

function buildApiError(context: DattaCrmContext, statusCode: number, body: unknown): NodeApiError {
	const httpCode = String(statusCode);
	if (isApiErrorBody(body)) {
		return verbatimApiError(
			context,
			body as unknown as JsonObject,
			body.error.message,
			describeApiError(body),
			httpCode,
		);
	}
	const message = `Datta CRM returned HTTP ${statusCode}`;
	return verbatimApiError(context, { message }, message, undefined, httpCode);
}

function cleanQuery(qs: IDataObject | undefined): IDataObject | undefined {
	if (qs === undefined) return undefined;
	const clean: IDataObject = {};
	for (const [key, value] of Object.entries(qs)) {
		if (value === undefined || value === null || value === '') continue;
		clean[key] = value;
	}
	return clean;
}

async function send(
	context: DattaCrmContext,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<{ data: unknown; nextCursor: string | null }> {
	const credentials = await context.getCredentials<{ baseUrl: string }>('dattaCrmApi');
	const options: IHttpRequestOptions = {
		method,
		url: apiUrl(credentials.baseUrl, path),
		qs: cleanQuery(qs),
		json: true,
		ignoreHttpStatusErrors: true,
		returnFullResponse: true,
	};
	if (body !== undefined) options.body = body;

	let response: { statusCode: number; body: unknown };
	try {
		response = (await context.helpers.httpRequestWithAuthentication.call(
			context,
			'dattaCrmApi',
			options,
		)) as { statusCode: number; body: unknown };
	} catch (error) {
		throw new NodeApiError(context.getNode(), error as JsonObject);
	}

	if (response.statusCode >= 400) {
		throw buildApiError(context, response.statusCode, response.body);
	}

	const payload = (response.body ?? {}) as { data?: unknown; nextCursor?: string | null };
	return { data: payload.data, nextCursor: payload.nextCursor ?? null };
}

/** Calls the Datta CRM API and returns the `data` of the response. */
export async function dattaCrmRequest(
	this: DattaCrmContext,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
	return (await send(this, method, path, body, qs)).data;
}

/** Fetches one page of a paginated list. */
export async function dattaCrmRequestPage(
	this: DattaCrmContext,
	path: string,
	qs?: IDataObject,
): Promise<{ items: IDataObject[]; nextCursor: string | null }> {
	const { data, nextCursor } = await send(this, 'GET', path, undefined, qs);
	if (!Array.isArray(data)) {
		const message = 'Unexpected response from Datta CRM';
		throw verbatimApiError(
			this,
			{ message },
			message,
			`Expected a list in "data" for GET ${path}.`,
		);
	}
	return { items: data as IDataObject[], nextCursor };
}

/**
 * Follows `nextCursor` until the end of the list, or until `max` items were collected. `pageSize`
 * is the largest `limit` the endpoint accepts (200 unless the caller passes a smaller one).
 */
export async function dattaCrmRequestAll(
	this: DattaCrmContext,
	path: string,
	qs: IDataObject = {},
	max?: number,
	pageSize: number = MAX_PAGE_SIZE,
): Promise<IDataObject[]> {
	if (max !== undefined && max <= 0) return [];
	const pageLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(pageSize)));
	const all: IDataObject[] = [];
	let cursor: string | null = null;
	do {
		const remaining = max === undefined ? pageLimit : max - all.length;
		const limit = Math.min(pageLimit, remaining);
		const query: IDataObject = { ...qs, limit };
		if (cursor !== null) query.cursor = cursor;
		const { items, nextCursor } = await dattaCrmRequestPage.call(this, path, query);
		all.push(...items);
		cursor = nextCursor;
	} while (cursor !== null && (max === undefined || all.length < max));
	return max === undefined ? all : all.slice(0, max);
}

import { vi, type Mock } from 'vitest';
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
	IWebhookFunctions,
} from 'n8n-workflow';

/** A full HTTP response as returned with `returnFullResponse: true`. */
export interface MockResponse {
	statusCode: number;
	body: unknown;
	headers?: Record<string, string>;
}

/** A queued answer: a full response, or an Error to reject with (transport failure). */
export type QueuedResponse = MockResponse | Error;

export type Params = Record<string, unknown>;

export interface ContextOptions {
	/** Node parameters. A single record applies to every item; an array is per item. */
	params?: Params | Params[];
	credentials?: Record<string, unknown>;
	/** Responses handed out in order by `httpRequestWithAuthentication`. */
	responses?: QueuedResponse[];
	continueOnFail?: boolean;
	/** Input items for `getInputData()` (execute context). Defaults to one empty item per params entry. */
	items?: INodeExecutionData[];
	/** Values `getCurrentNodeParameter(name)` returns in the load-options context (dotted names). */
	currentParams?: Params;
}

export const DEFAULT_CREDENTIALS = {
	apiKey: 'crm_live_test',
	baseUrl: 'https://crm.example.com',
};

/** A 2xx response `{ data }` (plus `nextCursor` for paginated lists). */
export function ok(data: unknown, nextCursor?: string | null, statusCode = 200): MockResponse {
	const body: IDataObject = { data: data as IDataObject };
	if (nextCursor !== undefined) body.nextCursor = nextCursor;
	return { statusCode, body, headers: {} };
}

/** A paginated list page. */
export function page(items: IDataObject[], nextCursor: string | null): MockResponse {
	return ok(items, nextCursor);
}

/** An API error response `{ error: { code, message, details?, requestId } }`. */
export function apiError(
	statusCode: number,
	code: string,
	message: string,
	extra: { details?: unknown; requestId?: string; headers?: Record<string, string> } = {},
): MockResponse {
	return {
		statusCode,
		body: {
			error: {
				code,
				message,
				...(extra.details === undefined ? {} : { details: extra.details }),
				requestId: extra.requestId ?? 'req_test',
			},
		},
		headers: extra.headers ?? {},
	};
}

export function makeNode(parameters: IDataObject = {}): INode {
	return {
		id: 'node-1',
		name: 'Datta CRM',
		type: 'n8n-nodes-datta-crm.dattaCrm',
		typeVersion: 1,
		position: [0, 0],
		parameters,
	};
}

function readPath(source: unknown, name: string): unknown {
	let current: unknown = source;
	for (const key of name.split('.')) {
		if (current === null || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function lookupParameter(
	record: Params,
	name: string,
	hasFallback: boolean,
	fallback: unknown,
): unknown {
	const value = readPath(record, name);
	if (value !== undefined) return value;
	if (hasFallback) return fallback;
	throw new Error(`Could not get parameter "${name}"`);
}

/**
 * `IExecuteFunctions.getNodeParameter(name, itemIndex, fallback?)`.
 * Throws for a missing parameter unless a fallback argument is passed (even `undefined`).
 */
function makeExecuteGetNodeParameter(params: Params | Params[]) {
	return (name: string, itemIndex = 0, ...rest: unknown[]) => {
		const record = Array.isArray(params) ? (params[itemIndex] ?? {}) : params;
		return lookupParameter(record, name, rest.length > 0, rest[0]);
	};
}

/**
 * `getNodeParameter(name, fallback?)` of the load-options, hook and webhook contexts: no item
 * index. An array of params uses its first entry.
 */
function makeContextGetNodeParameter(params: Params | Params[]) {
	return (name: string, ...rest: unknown[]) => {
		const record = (Array.isArray(params) ? params[0] : params) ?? {};
		return lookupParameter(record, name, rest.length > 0, rest[0]);
	};
}

function returnJsonArray(data: IDataObject | IDataObject[]): INodeExecutionData[] {
	return (Array.isArray(data) ? data : [data]).map((json) => ({ json }));
}

function makeRequestMock(responses: QueuedResponse[]): Mock {
	const queue = [...responses];
	return vi.fn(async () => {
		const next = queue.shift();
		if (next === undefined) throw new Error('No mocked response queued');
		if (next instanceof Error) throw next;
		return next;
	});
}

interface BaseMock {
	[key: string]: unknown;
	request: Mock;
	getNode: () => INode;
	getCredentials: Mock;
	getNodeParameter: Mock;
	helpers: Record<string, unknown>;
}

function buildBase(options: ContextOptions): BaseMock {
	const request = makeRequestMock(options.responses ?? []);
	const credentials = options.credentials ?? DEFAULT_CREDENTIALS;
	return {
		request,
		getNode: () => makeNode(),
		getCredentials: vi.fn(async () => credentials),
		getNodeParameter: vi.fn(makeContextGetNodeParameter(options.params ?? {})),
		helpers: { httpRequestWithAuthentication: request },
	};
}

export interface ExecuteMock {
	ctx: IExecuteFunctions;
	/** The `httpRequestWithAuthentication` mock; inspect `request.mock.calls[n][1]` for the options. */
	request: Mock;
}

/** Mock `IExecuteFunctions` for action node resources. */
export function createExecuteContext(options: ContextOptions = {}): ExecuteMock {
	const base = buildBase(options);
	const count = Array.isArray(options.params) ? options.params.length : 1;
	const items = options.items ?? Array.from({ length: count }, () => ({ json: {} }));
	const ctx = {
		...base,
		getNodeParameter: vi.fn(makeExecuteGetNodeParameter(options.params ?? {})),
		getInputData: () => items,
		continueOnFail: () => options.continueOnFail ?? false,
		helpers: {
			...base.helpers,
			returnJsonArray,
			constructExecutionMetaData: (
				input: INodeExecutionData[],
				meta: { itemData: { item: number } | Array<{ item: number }> },
			) => input.map((item) => ({ ...item, pairedItem: meta.itemData })),
		},
	};
	return { ctx: ctx as unknown as IExecuteFunctions, request: base.request };
}

export interface LoadOptionsMock {
	ctx: ILoadOptionsFunctions;
	request: Mock;
}

/** Mock `ILoadOptionsFunctions` (loadOptions methods). */
export function createLoadOptionsContext(options: ContextOptions = {}): LoadOptionsMock {
	const base = buildBase(options);
	const currentParams = options.currentParams ?? {};
	const ctx = {
		...base,
		getCurrentNodeParameter: vi.fn((name: string) => readPath(currentParams, name)),
	};
	return { ctx: ctx as unknown as ILoadOptionsFunctions, request: base.request };
}

export interface HookOptions extends ContextOptions {
	/** Value returned by `getNodeWebhookUrl('default')`. */
	webhookUrl?: string;
	/** Backing object for `getWorkflowStaticData('node')`; pass your own to pre-seed it. */
	staticData?: IDataObject;
	workflow?: { id: string; name: string; active: boolean };
}

export interface HookMock {
	ctx: IHookFunctions;
	request: Mock;
	staticData: IDataObject;
	/** `ctx.logger` methods, as mocks. */
	logger: Record<'error' | 'warn' | 'info' | 'debug', Mock>;
}

/** Mock `IHookFunctions` (webhookMethods checkExists/create/delete). */
export function createHookContext(options: HookOptions = {}): HookMock {
	const base = buildBase(options);
	const staticData = options.staticData ?? {};
	const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
	const ctx = {
		...base,
		getNodeWebhookUrl: vi.fn(() => options.webhookUrl ?? 'https://n8n.example.com/webhook/abc'),
		getWorkflow: () => options.workflow ?? { id: 'wf-1', name: 'Workflow', active: true },
		getWorkflowStaticData: vi.fn(() => staticData),
		logger,
	};
	return { ctx: ctx as unknown as IHookFunctions, request: base.request, staticData, logger };
}

export interface WebhookOptions extends HookOptions {
	/** Incoming request: parsed body, raw body bytes and headers (lower-case names). */
	req?: { body?: unknown; rawBody?: Buffer | string; headers?: Record<string, string> };
}

export interface RecordedResponse {
	statusCode?: number;
	sent: unknown[];
	ended: boolean;
}

export interface WebhookMock {
	ctx: IWebhookFunctions;
	request: Mock;
	staticData: IDataObject;
	/** What the node did with the express response (`status().send().end()`). */
	response: RecordedResponse;
}

/** Mock `IWebhookFunctions` (trigger `webhook()` method). */
export function createWebhookContext(options: WebhookOptions = {}): WebhookMock {
	const hook = createHookContext(options);
	const req = options.req ?? {};
	const response: RecordedResponse = { sent: [], ended: false };
	const res = {
		status: (code: number) => {
			response.statusCode = code;
			return res;
		},
		send: (payload?: unknown) => {
			response.sent.push(payload);
			return res;
		},
		end: () => {
			response.ended = true;
			return res;
		},
	};
	const hookCtx = hook.ctx as unknown as { helpers: Record<string, unknown> };
	const ctx = {
		...(hook.ctx as unknown as Record<string, unknown>),
		helpers: { ...hookCtx.helpers, returnJsonArray },
		getRequestObject: () => ({
			body: req.body ?? {},
			rawBody: req.rawBody,
			headers: req.headers ?? {},
		}),
		getResponseObject: () => res,
		getBodyData: () => req.body ?? {},
		getHeaderData: () => req.headers ?? {},
	};
	return {
		ctx: ctx as unknown as IWebhookFunctions,
		request: hook.request,
		staticData: hook.staticData,
		response,
	};
}

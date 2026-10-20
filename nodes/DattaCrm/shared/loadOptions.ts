import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { dattaCrmRequest, dattaCrmRequestAll } from './transport';
import { NO_OWNER_VALUE } from './utils';

interface Pipeline {
	id: string;
	name: string;
	stages: Array<{ id: string; name: string }>;
}

/** Where the pipeline of a stage selector can live, in order of preference. */
const PIPELINE_PARAMETER_PATHS = [
	'pipelineId',
	'additionalFields.pipelineId',
	'filters.pipelineId',
	'updateFields.pipelineId',
];

async function fetchList<T>(context: ILoadOptionsFunctions, path: string): Promise<T[]> {
	const data = (await dattaCrmRequest.call(context, 'GET', path)) as unknown;
	return Array.isArray(data) ? (data as T[]) : [];
}

function readCurrentPipelineId(context: ILoadOptionsFunctions): string | undefined {
	for (const path of PIPELINE_PARAMETER_PATHS) {
		try {
			const value = context.getCurrentNodeParameter(path);
			if (typeof value === 'string' && value !== '') return value;
		} catch {
			// The parameter does not exist in this context: try the next location.
		}
	}
	return undefined;
}

function allStages(pipelines: Pipeline[]): INodePropertyOptions[] {
	return pipelines.flatMap((pipeline) =>
		pipeline.stages.map((stage) => ({
			name: `${pipeline.name} / ${stage.name}`,
			value: stage.id,
		})),
	);
}

export async function getPipelines(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const pipelines = await fetchList<Pipeline>(this, '/pipelines');
	return pipelines.map((pipeline) => ({ name: pipeline.name, value: pipeline.id }));
}

/**
 * Stages of the pipeline chosen next to the field (top level or inside a collection). Without a
 * pipeline, every stage is listed as "pipeline / stage".
 */
export async function getStages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const pipelines = await fetchList<Pipeline>(this, '/pipelines');
	const pipelineId = readCurrentPipelineId(this);
	if (pipelineId === undefined) return allStages(pipelines);
	const pipeline = pipelines.find((candidate) => candidate.id === pipelineId);
	return (pipeline?.stages ?? []).map((stage) => ({ name: stage.name, value: stage.id }));
}

export async function getAllStages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return allStages(await fetchList<Pipeline>(this, '/pipelines'));
}

export async function getTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const tags = await fetchList<{ name: string }>(this, '/tags');
	return tags.map((tag) => ({ name: tag.name, value: tag.name }));
}

export async function getLists(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const lists = await fetchList<{ id: string; name: string }>(this, '/lists');
	return lists.map((list) => ({ name: list.name, value: list.id }));
}

export async function getMembers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const members = await fetchList<{ id: string; name: string | null; email: string }>(
		this,
		'/members',
	);
	return members.map((member) => ({
		name: member.name ? `${member.name} (${member.email})` : member.email,
		value: member.id,
	}));
}

/** Members preceded by a "No Owner" choice (sends `ownerId: null` to clear the owner). */
export async function getMembersWithNoOwner(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return [{ name: 'No Owner', value: NO_OWNER_VALUE }, ...(await getMembers.call(this))];
}

export async function getCustomFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const fields = await fetchList<{ key: string; label: string; type: string }>(
		this,
		'/custom-fields',
	);
	return fields.map((field) => ({
		name: field.label,
		value: field.key,
		description: field.type,
	}));
}

export async function getForms(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const forms = (await dattaCrmRequestAll.call(this, '/forms')) as Array<{
		id: string;
		name: string;
	}>;
	return forms.map((form) => ({ name: form.name, value: form.id }));
}

export async function getEvents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const events = await fetchList<{ id: string; label: string }>(this, '/webhooks/events');
	return events.map((event) => ({ name: event.label, value: event.id, description: event.id }));
}

import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { dattaCrmRequest, dattaCrmRequestAll } from './transport';
import { NO_OWNER_VALUE } from './utils';

interface ListWithStages {
	id: string;
	name: string;
	folderName: string;
	stages?: Array<{ id: string; name: string }>;
}

async function fetchList<T>(context: ILoadOptionsFunctions, path: string): Promise<T[]> {
	const data = (await dattaCrmRequest.call(context, 'GET', path)) as unknown;
	return Array.isArray(data) ? (data as T[]) : [];
}

function readCurrentListId(context: ILoadOptionsFunctions): string | undefined {
	try {
		const value = context.getCurrentNodeParameter('listId');
		if (typeof value === 'string' && value !== '') return value;
	} catch {
		// The parameter does not exist in this context.
	}
	return undefined;
}

/** Every stage of the lists with a funnel, named "folder / list / stage". */
function allStages(lists: ListWithStages[]): INodePropertyOptions[] {
	return lists.flatMap((list) =>
		(list.stages ?? []).map((stage) => ({
			name: `${list.folderName} / ${list.name} / ${stage.name}`,
			value: stage.id,
		})),
	);
}

/**
 * Stages of the list chosen next to the field. Without a list, every stage is listed as
 * "folder / list / stage". Lists of the Site origin have no stages.
 */
export async function getStages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const lists = await fetchList<ListWithStages>(this, '/lists');
	const listId = readCurrentListId(this);
	if (listId === undefined) return allStages(lists);
	const list = lists.find((candidate) => candidate.id === listId);
	return (list?.stages ?? []).map((stage) => ({ name: stage.name, value: stage.id }));
}

export async function getAllStages(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return allStages(await fetchList<ListWithStages>(this, '/lists'));
}

export async function getLossReasons(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const reasons = await fetchList<{ id: string; name: string }>(this, '/loss-reasons');
	return reasons.map((reason) => ({ name: reason.name, value: reason.id }));
}

export async function getTags(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const tags = await fetchList<{ name: string }>(this, '/tags');
	return tags.map((tag) => ({ name: tag.name, value: tag.name }));
}

/** Lists named "folder / list", since list names only have to be unique within an origin. */
export async function getLists(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const lists = await fetchList<{ id: string; name: string; folderName: string }>(this, '/lists');
	return lists.map((list) => ({ name: `${list.folderName} / ${list.name}`, value: list.id }));
}

const ORIGIN_LABELS: Record<string, string> = {
	site: 'Site',
	whatsapp: 'WhatsApp',
	instagram: 'Instagram',
};

/** Folders named "origin / folder": folder names can repeat across origins. */
export async function getFolders(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const folders = await fetchList<{ id: string; name: string; origin: string }>(this, '/folders');
	return folders.map((folder) => ({
		name: `${ORIGIN_LABELS[folder.origin] ?? folder.origin} / ${folder.name}`,
		value: folder.id,
	}));
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

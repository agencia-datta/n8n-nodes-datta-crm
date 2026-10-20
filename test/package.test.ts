import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

describe('package.json', () => {
	it('has no runtime dependencies', () => {
		expect(pkg).not.toHaveProperty('dependencies');
	});

	it('declares the credential and both nodes', () => {
		expect(pkg.n8n.credentials).toEqual(['dist/credentials/DattaCrmApi.credentials.js']);
		expect(pkg.n8n.nodes).toEqual([
			'dist/nodes/DattaCrm/DattaCrm.node.js',
			'dist/nodes/DattaCrmTrigger/DattaCrmTrigger.node.js',
		]);
	});
});

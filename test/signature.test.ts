import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import { verifySignature } from '../nodes/DattaCrmTrigger/signature';

const secret = 'whsec_test_secret';
const body = '{"id":"evt_1","event":"lead.created","data":{"id":"l1"}}';

function sign(payload: Buffer | string, key = secret): string {
	return `sha256=${createHmac('sha256', key).update(payload).digest('hex')}`;
}

describe('verifySignature', () => {
	it('accepts the right HMAC for a string body', () => {
		expect(verifySignature(body, sign(body), secret)).toBe(true);
	});

	it('accepts the right HMAC for a Buffer body', () => {
		const raw = Buffer.from(body, 'utf8');
		expect(verifySignature(raw, sign(raw), secret)).toBe(true);
	});

	it('uses the first element of an array header', () => {
		expect(verifySignature(body, [sign(body), 'sha256=bad'], secret)).toBe(true);
		expect(verifySignature(body, ['sha256=bad', sign(body)], secret)).toBe(false);
	});

	it('rejects a signature made with another secret', () => {
		expect(verifySignature(body, sign(body, 'other'), secret)).toBe(false);
	});

	it('rejects a signature of a different body', () => {
		expect(verifySignature(body + ' ', sign(body), secret)).toBe(false);
	});

	it('rejects a missing, empty or empty-array header', () => {
		expect(verifySignature(body, undefined, secret)).toBe(false);
		expect(verifySignature(body, '', secret)).toBe(false);
		expect(verifySignature(body, [], secret)).toBe(false);
	});

	it('rejects a sha1 prefix and a missing prefix', () => {
		const hex = createHmac('sha256', secret).update(body).digest('hex');
		expect(verifySignature(body, `sha1=${hex}`, secret)).toBe(false);
		expect(verifySignature(body, hex, secret)).toBe(false);
	});

	it('rejects short, long and non-hex values without throwing', () => {
		const valid = sign(body);
		expect(verifySignature(body, 'sha256=abc', secret)).toBe(false);
		expect(verifySignature(body, `${valid}00`, secret)).toBe(false);
		expect(verifySignature(body, `sha256=${'z'.repeat(64)}`, secret)).toBe(false);
		expect(verifySignature(body, 'sha256=', secret)).toBe(false);
		expect(verifySignature(body, 'garbage é中', secret)).toBe(false);
	});

	it('accepts an upper-case hex digest of the right value', () => {
		const upper = `sha256=${createHmac('sha256', secret).update(body).digest('hex').toUpperCase()}`;
		expect(verifySignature(body, upper, secret)).toBe(true);
	});
});

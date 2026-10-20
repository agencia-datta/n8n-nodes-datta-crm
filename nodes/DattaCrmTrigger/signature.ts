import { createHmac, timingSafeEqual } from 'crypto';

const SIGNATURE_PREFIX = 'sha256=';
const SHA256_HEX_LENGTH = 64;

/**
 * Checks the `x-crm-signature` header (`sha256=<hex HMAC-SHA256(secret, raw body)>`) in constant
 * time. Never throws: a missing, malformed or wrong-length header simply returns false.
 */
export function verifySignature(
	rawBody: Buffer | string,
	header: string | string[] | undefined,
	secret: string,
): boolean {
	const value = Array.isArray(header) ? header[0] : header;
	if (typeof value !== 'string' || !value.startsWith(SIGNATURE_PREFIX)) return false;

	const received = value.slice(SIGNATURE_PREFIX.length);
	if (received.length !== SHA256_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(received)) return false;

	const expected = createHmac('sha256', secret).update(rawBody).digest();
	return timingSafeEqual(expected, Buffer.from(received, 'hex'));
}

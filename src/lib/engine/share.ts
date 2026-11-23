/**
 * URL-Encoded Shareable Circuit Codec (`#c=v1.<b64url>` / `#c=u1.<b64url>`).
 *
 * Encodes a CircuitDocument along with optional Thévenin target and unit system
 * into a compact, URL-safe hash fragment using `deflate-raw` compression when
 * available, with a lossless uncompressed fallback (`u1.`).
 */

import { parseCircuitImport } from './io';
import type {
	CircuitComponent,
	CircuitDocument,
	TheveninTarget,
	UnitSystemId
} from './types';

export interface ShareableCircuitPayload {
	document: CircuitDocument;
	theveninTarget?: TheveninTarget;
	unitSystem?: UnitSystemId;
}

const SHARE_SCHEMA_VERSION = 1;
const MAX_ENCODED_HASH_LENGTH = 120_000;
const MAX_DECOMPRESSED_BYTES = 2_000_000;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

const ALLOWED_UNIT_SYSTEMS = new Set<UnitSystemId>([
	'auto',
	'ohm-v-a',
	'kohm-v-ma',
	'mohm-v-ua'
]);

function isPlainObject(val: unknown): val is Record<string, unknown> {
	return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function compactComponent(c: CircuitComponent): Record<string, unknown> {
	const out: Record<string, unknown> = {
		id: c.id,
		kind: c.kind,
		label: c.label,
		x: c.x,
		y: c.y,
		rotation: c.rotation,
		value: c.value
	};
	if (c.numericValue !== undefined) out.numericValue = c.numericValue;
	if (c.phaseDeg !== undefined) out.phaseDeg = c.phaseDeg;
	if (c.frequencyHz !== undefined) out.frequencyHz = c.frequencyHz;
	if (c.unit !== undefined) out.unit = c.unit;
	if (c.valueMode !== undefined) out.valueMode = c.valueMode;
	if (c.terminalName !== undefined) out.terminalName = c.terminalName;
	if (c.controlRef !== undefined) {
		const ref: Record<string, unknown> = {};
		if (c.controlRef.controlComponentId !== undefined) {
			ref.controlComponentId = c.controlRef.controlComponentId;
		}
		if (c.controlRef.controlNodePos !== undefined) ref.controlNodePos = c.controlRef.controlNodePos;
		if (c.controlRef.controlNodeNeg !== undefined) ref.controlNodeNeg = c.controlRef.controlNodeNeg;
		if (c.controlRef.controlBranchComponentId !== undefined) {
			ref.controlBranchComponentId = c.controlRef.controlBranchComponentId;
		}
		if (c.controlRef.controlPolarity !== undefined) {
			ref.controlPolarity = c.controlRef.controlPolarity;
		}
		if (c.controlRef.controlVarName !== undefined) {
			ref.controlVarName = c.controlRef.controlVarName;
		}
		if (c.controlRef.gain !== undefined) ref.gain = c.controlRef.gain;
		if (Object.keys(ref).length > 0) {
			out.controlRef = ref;
		}
	}
	return out;
}

function compactDocument(doc: CircuitDocument): Record<string, unknown> {
	const out: Record<string, unknown> = {
		schemaVersion: 1
	};
	if (doc.id !== undefined) out.id = doc.id;
	if (doc.name !== undefined) out.name = doc.name;
	out.mode = doc.mode;
	out.frequencyHz = doc.frequencyHz;
	if (doc.acMagnitudeMode !== undefined) out.acMagnitudeMode = doc.acMagnitudeMode;
	if (doc.unitSystem !== undefined) out.unitSystem = doc.unitSystem;
	out.components = doc.components.map(compactComponent);
	out.wires = doc.wires.map((w) => ({
		id: w.id,
		points: w.points.map((p) => ({ x: p.x, y: p.y }))
	}));
	if (doc.unknownProblem !== undefined) {
		const up = doc.unknownProblem;
		const validTerms = Array.isArray(up.terms)
			? up.terms
					.filter(
						(t) =>
							typeof t.componentId === 'string' &&
							t.componentId.trim() !== '' &&
							typeof t.multiplier === 'number' &&
							Number.isFinite(t.multiplier) &&
							Math.abs(t.multiplier) > 1e-15
					)
					.map((t) => ({
						componentId: t.componentId.trim(),
						multiplier: t.multiplier
					}))
			: [];
		out.unknownProblem = {
			componentId: up.componentId,
			...(up.symbol !== undefined && up.symbol !== '' ? { symbol: up.symbol } : {}),
			...(validTerms.length > 0 ? { terms: validTerms } : {}),
			constraint: {
				kind: up.constraint.kind,
				targetId: up.constraint.targetId,
				value: up.constraint.value,
				...(up.constraint.label !== undefined && up.constraint.label !== ''
					? { label: up.constraint.label }
					: {})
			}
		};
	}
	return out;
}

function serializePayload(payload: ShareableCircuitPayload): string {
	const compactDoc = compactDocument(payload.document);
	const wirePayload: Record<string, unknown> = {
		v: SHARE_SCHEMA_VERSION,
		d: compactDoc
	};
	if (payload.theveninTarget !== undefined) {
		wirePayload.t = payload.theveninTarget;
	}
	if (payload.unitSystem !== undefined) {
		wirePayload.u = payload.unitSystem;
	}
	return JSON.stringify(wirePayload);
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
		binary += String.fromCharCode(...sub);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(encoded: string): Uint8Array | null {
	if (!encoded || encoded.length % 4 === 1 || !BASE64URL_RE.test(encoded)) {
		return null;
	}
	const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	try {
		const binary = atob(padded);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			out[i] = binary.charCodeAt(i);
		}
		return out;
	} catch {
		return null;
	}
}

async function runTransformStream(
	stream: CompressionStream | DecompressionStream,
	input: Uint8Array,
	maxOutputBytes: number
): Promise<Uint8Array> {
	const writer = stream.writable.getWriter();
	const reader = stream.readable.getReader();

	const copy = new Uint8Array(input.byteLength);
	copy.set(input);

	const writePromise = (async () => {
		await writer.write(copy);
		await writer.close();
	})();
	// Prevent unhandled rejection if reader rejects before writePromise is awaited
	writePromise.catch(() => {});

	const chunks: Uint8Array[] = [];
	let totalLength = 0;

	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		if (value) {
			totalLength += value.byteLength;
			if (totalLength > maxOutputBytes) {
				await reader.cancel().catch(() => {});
				await writer.abort().catch(() => {});
				throw new Error('Payload exceeds maximum allowed byte length.');
			}
			chunks.push(value);
		}
	}

	await writePromise;

	const out = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

/**
 * Encodes a circuit payload into an uncompressed URL hash (`#c=u1.<b64url>`).
 */
export function encodeCircuitToHashUncompressed(payload: ShareableCircuitPayload): string {
	const jsonStr = serializePayload(payload);
	const utf8Bytes = new TextEncoder().encode(jsonStr);
	return `#c=u1.${bytesToBase64Url(utf8Bytes)}`;
}

/**
 * Encodes a circuit payload into a compact, URL-safe hash fragment.
 * Uses `deflate-raw` compression (`#c=v1.<b64url>`) when `CompressionStream` is available,
 * and falls back cleanly to uncompressed UTF-8 base64url (`#c=u1.<b64url>`).
 */
export async function encodeCircuitToHash(payload: ShareableCircuitPayload): Promise<string> {
	const jsonStr = serializePayload(payload);
	const utf8Bytes = new TextEncoder().encode(jsonStr);

	if (typeof CompressionStream !== 'undefined') {
		try {
			const compressed = await runTransformStream(
				new CompressionStream('deflate-raw'),
				utf8Bytes,
				MAX_DECOMPRESSED_BYTES
			);
			return `#c=v1.${bytesToBase64Url(compressed)}`;
		} catch {
			// Fall through to uncompressed encoding if deflate-raw is unsupported
		}
	}

	return `#c=u1.${bytesToBase64Url(utf8Bytes)}`;
}

function extractEncodedParam(hash: string): string | null {
	if (typeof hash !== 'string') return null;
	const trimmed = hash.trim();
	if (!trimmed) return null;
	const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
	if (!withoutHash) return null;

	for (const part of withoutHash.split('&')) {
		const eqIdx = part.indexOf('=');
		if (eqIdx === -1) continue;
		const key = part.slice(0, eqIdx);
		if (key === 'c') {
			const val = part.slice(eqIdx + 1);
			return val ? val : null;
		}
	}
	return null;
}

function validateTheveninTarget(
	raw: unknown,
	components: CircuitComponent[]
): TheveninTarget | undefined {
	if (!isPlainObject(raw)) return undefined;
	if (raw.kind === 'component') {
		if (typeof raw.componentId === 'string') {
			const id = raw.componentId.trim();
			if (
				id &&
				components.some(
					(c) =>
						c.id === id &&
						c.kind !== 'ground' &&
						c.kind !== 'terminal' &&
						c.kind !== 'voltmeter'
				)
			) {
				return { kind: 'component', componentId: id };
			}
		}
		return undefined;
	}
	if (raw.kind === 'terminals') {
		if (typeof raw.nodeA === 'string' && typeof raw.nodeB === 'string') {
			const nodeA = raw.nodeA.trim();
			const nodeB = raw.nodeB.trim();
			if (nodeA && nodeB && nodeA !== nodeB) {
				return { kind: 'terminals', nodeA, nodeB };
			}
		}
		return undefined;
	}
	return undefined;
}

function validateUnitSystem(raw: unknown): UnitSystemId | undefined {
	if (typeof raw !== 'string') return undefined;
	const normalized = raw.trim().toLowerCase() as UnitSystemId;
	return ALLOWED_UNIT_SYSTEMS.has(normalized) ? normalized : undefined;
}

/**
 * Decodes and validates a shareable circuit hash (`#c=v1.<b64url>` or `#c=u1.<b64url>`).
 * Returns `null` on any empty, malformed, oversized, or corrupted input without throwing.
 */
export async function decodeCircuitFromHash(
	hash: string
): Promise<ShareableCircuitPayload | null> {
	try {
		const encoded = extractEncodedParam(hash);
		if (!encoded || encoded.length > MAX_ENCODED_HASH_LENGTH) {
			return null;
		}

		let utf8Bytes: Uint8Array;
		if (encoded.startsWith('v1.')) {
			if (typeof DecompressionStream === 'undefined') {
				return null;
			}
			const compressedBytes = base64UrlToBytes(encoded.slice(3));
			if (!compressedBytes || compressedBytes.byteLength === 0) {
				return null;
			}
			utf8Bytes = await runTransformStream(
				new DecompressionStream('deflate-raw'),
				compressedBytes,
				MAX_DECOMPRESSED_BYTES
			);
		} else if (encoded.startsWith('u1.')) {
			const rawBytes = base64UrlToBytes(encoded.slice(3));
			if (!rawBytes || rawBytes.byteLength === 0) {
				return null;
			}
			utf8Bytes = rawBytes;
		} else {
			return null;
		}

		const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(utf8Bytes);
		const parsedRaw: unknown = JSON.parse(jsonText);
		if (!isPlainObject(parsedRaw)) {
			return null;
		}
		if (parsedRaw.v !== SHARE_SCHEMA_VERSION || !isPlainObject(parsedRaw.d)) {
			return null;
		}

		const imported = parseCircuitImport(JSON.stringify(parsedRaw.d));
		if (!imported.ok || imported.sourceFormat !== 'circuit-document') {
			return null;
		}

		const theveninTarget = validateTheveninTarget(parsedRaw.t, imported.document.components);
		const unitSystem = validateUnitSystem(parsedRaw.u);

		const result: ShareableCircuitPayload = {
			document: imported.document
		};
		if (theveninTarget !== undefined) {
			result.theveninTarget = theveninTarget;
		}
		if (unitSystem !== undefined) {
			result.unitSystem = unitSystem;
		}
		return result;
	} catch {
		return null;
	}
}

/**
 * Builds an absolute shareable URL by replacing only the hash fragment on `currentHref`,
 * cleanly preserving origin, base paths (e.g. `/circuit-lab/`), and query parameters.
 */
export function buildShareableUrl(currentHref: string, hash: string): string {
	const url = new URL(currentHref);
	url.hash = hash;
	return url.toString();
}

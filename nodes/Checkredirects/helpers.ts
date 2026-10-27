// Pure helpers shared across the action node, triggers, and per-resource
// handlers. Kept dependency-free of n8n-workflow types so it can be imported
// from anywhere in the package.

// Sanitize upstream error text before surfacing it through NodeOperationError or
// continueOnFail output. Four redaction passes:
//   1. Checkredirects API keys (httpnd_ current + httpd_ legacy) — if the user
//      pasted a key into a URL or the API echoes one back, we never want it in
//      workflow JSON or execution logs.
//   2. Bearer-style auth headers ("Authorization: Bearer ..." / "Bearer ...")
//      — token following the literal string is opaque, redact wholesale.
//   3. URL query strings (signing tokens, share-link secrets that the API
//      echoes back when the user's input URL contained them).
//   4. Truncate at 500 chars so a verbose 5xx body doesn't fill workflow data.
export function sanitizeApiMessage(raw: unknown): string {
	if (typeof raw !== 'string' || raw.length === 0) return '';
	let cleaned = raw
		.replace(/\b(?:httpnd|httpd)_[A-Za-z0-9_=-]{8,128}\b/g, '[redacted-apikey]')
		.replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer [redacted]')
		.replace(/(https?:\/\/[^\s"'<>?\\]+)\?[^\s"'<>\\]*/g, '$1?[redacted]');
	if (cleaned.length > 500) cleaned = cleaned.slice(0, 497) + '...';
	return cleaned;
}

// Validate + percent-encode an ID that goes into a URL path segment. Rejects
// `/ ? # whitespace control % \` characters so a hostile or malformed value
// can't reroute the call (e.g. `abc/../usage`, `abc?foo=bar`, double-encoded
// `%2F`). The encoded value is safe to interpolate into `${encId(id)}` template
// positions.
export function encId(raw: unknown, kind: string): string {
	if (typeof raw !== 'string' || raw.length === 0) {
		throw new Error(`Missing ${kind}. Provide a non-empty value.`);
	}
	if (/[/?#%\\\s\x00-\x1F\x7F]/.test(raw)) {
		throw new Error(`Invalid ${kind}. IDs must not contain slashes, query characters, percent signs, backslashes, whitespace, or control characters.`);
	}
	return encodeURIComponent(raw);
}

const MAX_URL_LENGTH = 2048;
const MAX_BULK_URLS = 1000;

// Shared URL parser: rejects non-http(s) protocols and embedded credentials in
// the authority. `@` is allowed in path / query (e.g. `/@username`) — only the
// authority's username/password fields are a security concern.
export function assertHttpUrl(raw: string, kind: string): void {
	if (raw.length > MAX_URL_LENGTH) {
		throw new Error(`${kind} exceeds ${MAX_URL_LENGTH} chars.`);
	}
	if (/[\x00-\x1F\x7F]/.test(raw)) {
		throw new Error(`${kind} contains control characters.`);
	}
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`Invalid ${kind} — not a valid URL.`);
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(`Invalid ${kind} — must use http:// or https://.`);
	}
	if (!parsed.hostname) {
		throw new Error(`Invalid ${kind} — missing host.`);
	}
	if (parsed.username || parsed.password) {
		throw new Error(`Invalid ${kind} — must not include embedded credentials.`);
	}
}

// Parse a newline-separated URL list. Trims, filters blanks, validates each via
// assertHttpUrl. Caps at MAX_BULK_URLS.
export function parseBulkUrls(text: unknown, kind: string): string[] {
	if (typeof text !== 'string' || text.trim().length === 0) {
		throw new Error(`No ${kind} provided.`);
	}
	const raw = text.split('\n').map((s) => s.trim()).filter(Boolean);
	if (raw.length === 0) {
		throw new Error(`No ${kind} provided.`);
	}
	if (raw.length > MAX_BULK_URLS) {
		throw new Error(`Too many ${kind} (${raw.length}). Maximum per call is ${MAX_BULK_URLS} — split into multiple calls or use the web app.`);
	}
	for (const url of raw) {
		assertHttpUrl(url, 'URL');
	}
	return raw;
}

// Single-URL validator for webhook/callback fields. Empty input is allowed and
// returns ''; the caller's `if (wh)` skips the body field.
export function validateOptionalUrl(url: unknown, kind: string): string {
	if (url == null || url === '') return '';
	if (typeof url !== 'string') throw new Error(`${kind} must be a string.`);
	const trimmed = url.trim();
	if (trimmed.length === 0) return '';
	assertHttpUrl(trimmed, kind);
	return trimmed;
}

// Flattens list-shape responses where the API uses an n8n-conventional `data[]`
// envelope (monitor listing etc.). NOT for batch responses: those carry
// pagination / job metadata around their `checks` array, and the explicit
// `splitResults` branches handle the per-row fan-out. When `splitResults=false`,
// callers should receive the full envelope.
export function unwrap(result: any): any {
	if (Array.isArray(result)) return result;
	if (result?.data && Array.isArray(result.data)) return result.data;
	return result;
}

// Reads the n8n "Additional Request Options" collection and merges supported
// fields into the request body. Mirrors the API request schema. NOTE the
// monitorRequest struct does NOT support `basic_auth` (only `headers` and
// `cookies`) — pass `allowBasicAuth: false` for monitor callers to skip it.
// The API uses DisallowUnknownFields so sending basic_auth on a monitor
// request would 400 the call.
export function applyRequestOptions(
	body: Record<string, any>,
	additional: unknown,
	options: { allowBasicAuth?: boolean } = {},
): void {
	if (!additional || typeof additional !== 'object') return;
	const add = additional as Record<string, any>;
	const allowBasicAuth = options.allowBasicAuth !== false;

	// Headers come in as { entries: [{ name, value }, ...] } from fixedCollection.
	const hdrEntries: Array<{ name?: string; value?: string }> = Array.isArray(add.headers?.entries)
		? add.headers.entries
		: [];
	const headers: Record<string, string> = {};
	for (const e of hdrEntries) {
		const name = typeof e.name === 'string' ? e.name.trim() : '';
		const value = typeof e.value === 'string' ? e.value : '';
		if (name.length > 0) headers[name] = value;
	}
	if (Object.keys(headers).length > 0) body.headers = headers;

	if (typeof add.cookies === 'string' && add.cookies.length > 0) {
		body.cookies = add.cookies;
	}

	if (allowBasicAuth) {
		const user = typeof add.basicAuthUser === 'string' ? add.basicAuthUser : '';
		const pass = typeof add.basicAuthPass === 'string' ? add.basicAuthPass : '';
		if (user.length > 0 || pass.length > 0) {
			body.basic_auth = { user, pass };
		}
	}
}

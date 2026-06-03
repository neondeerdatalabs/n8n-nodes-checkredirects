// Centralized base-URL + API-key validation for every authenticated request.
// A lower-trust operator who can edit a shared credential's `baseUrl` (but
// can't see the masked `apiKey`) could otherwise redirect the Bearer header
// to an attacker-controlled host on the next node run. These assertions fail
// fast with a clear error before any HTTP request is constructed.
//
// Two enforcement points:
//   1. `preAuthentication` in CheckredirectsApi.credentials.ts runs on EVERY
//      authenticated request — including the n8n credential test path.
//   2. Each node consumer (Checkredirects.node.ts, CheckredirectsPollTrigger
//      .node.ts) also calls these so failures surface as NodeOperationError
//      with `this.getNode()` context.

export const DEFAULT_BASE_URL = 'https://api.checkredirects.io';

const ALLOWED_HOSTS: RegExp[] = [
	/^([a-z0-9-]+\.)?checkredirects\.io$/i,
	/^localhost$/i,
	/^127\.0\.0\.1$/,
	/^\[::1\]$/,
];

export function assertApiKeyPresent(rawApiKey: unknown): string {
	if (typeof rawApiKey !== 'string' || rawApiKey.trim().length === 0) {
		throw new Error('API key is missing. Set it in the Checkredirects.io credential.');
	}
	return rawApiKey.trim();
}

// allowCustomHost tri-state:
//   undefined — LEGACY credential (the field was added after v1.0.0). Treat
//     as "allow" so pre-upgrade credentials pointing at a self-hosted host
//     don't break on next n8n start. This is the backwards-compat path
//     required by R5 (baseUrl is user-overridable).
//   true      — explicit opt-in via the new credential UI toggle. Allow.
//   false (or any other value) — explicit opt-out. Apply the *.checkredirects.io
//     + loopback allowlist (the post-C-F1 security default for NEW credentials).
//
// The schema's `default: false` means newly-saved credentials get locked
// down unless the user ticks the toggle. Legacy credentials (no field) stay
// open. Both branches keep the other guards (https-only, no userinfo, no
// query/fragment).
export function assertAllowedBaseUrl(rawBaseUrl: unknown, options: { allowCustomHost?: boolean } = {}): string {
	const baseUrl = typeof rawBaseUrl === 'string' ? rawBaseUrl.trim() : '';
	if (!baseUrl) {
		throw new Error('Base URL is missing. Set it in the Checkredirects.io credential.');
	}

	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw new Error('Base URL is not a valid URL. Use a value like https://api.checkredirects.io.');
	}

	const hostname = parsed.hostname;
	const isLoopback =
		hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

	if (parsed.protocol !== 'https:' && !(isLoopback && parsed.protocol === 'http:')) {
		throw new Error('Base URL must use https:// (http:// is only allowed for localhost during development).');
	}

	if (parsed.username || parsed.password) {
		throw new Error('Base URL must not embed credentials (no user:pass@host).');
	}

	if (parsed.search || parsed.hash) {
		throw new Error('Base URL must not include a query string or fragment.');
	}

	// Skip the hostname allowlist for legacy creds (field undefined = pre-fix
	// migration path) and explicit opt-in. Everything else falls into the
	// allowlist check.
	const isLegacy = options.allowCustomHost === undefined;
	const isExplicitlyAllowed = options.allowCustomHost === true;
	if (!isLegacy && !isExplicitlyAllowed && !ALLOWED_HOSTS.some((re) => re.test(hostname))) {
		throw new Error(
			`Base URL host "${hostname}" is not allowed. Use https://api.checkredirects.io (or a *.checkredirects.io host, or http://localhost for development). To point at a different host, enable "Allow Custom Host" in the credential.`,
		);
	}

	// Return the trimmed value for callers that want to use it as the canonical form.
	return baseUrl.replace(/\/+$/, '');
}

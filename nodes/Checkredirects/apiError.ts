// Shared HTTP-status → user-facing message map. Used by every Checkredirects
// API caller in this package so error UX stays consistent between the action
// node and the trigger nodes (F8). Operator-side telemetry (status codes,
// sanitized body) should be logged separately; this is only the message a
// node surfaces back to the user.

import { sanitizeApiMessage } from './helpers';

export interface MapApiErrorOptions {
	context?: string;
	idLabel?: string;
	idValue?: string;
	// Sanitized upstream message (e.g. via sanitizeApiMessage) — appended to
	// status-class messages where the upstream detail is useful (422, 429).
	apiMessage?: string;
}

export function mapCheckredirectsApiError(error: any, opts: MapApiErrorOptions = {}): string {
	const httpStatus = error?.response?.status ?? error?.statusCode;
	const apiMessage = opts.apiMessage && opts.apiMessage.length > 0 ? opts.apiMessage : '';
	if (httpStatus === 401) {
		return 'Invalid API key. Check your Checkredirects.io credentials (Settings > API Keys).';
	}
	if (httpStatus === 403) {
		const base = 'This action requires a paid plan. Upgrade at https://app.checkredirects.io/settings/billing.';
		return apiMessage ? `${apiMessage} — ${base}` : base;
	}
	if (httpStatus === 404) {
		if (opts.idLabel && opts.idValue) {
			return `${opts.idLabel} "${opts.idValue}" not found. Verify the ID.`;
		}
		return 'Not found. Check the resource ID and try again.';
	}
	if (httpStatus === 422) {
		return apiMessage ? `Invalid request: ${apiMessage}` : 'Invalid request — check the URL or parameters and try again.';
	}
	if (httpStatus === 429) {
		const tail = ' Upgrade at https://app.checkredirects.io/settings/billing.';
		return apiMessage ? `Monthly check limit exceeded: ${apiMessage}.${tail}` : `Monthly check limit exceeded.${tail}`;
	}
	if (httpStatus === 503) {
		return 'Service unavailable. Google Sheets may not be connected — check https://app.checkredirects.io/settings/integrations.';
	}
	if (typeof httpStatus === 'number' && httpStatus >= 500) {
		return `Checkredirects service unavailable (${httpStatus}). Try again soon.`;
	}
	if (typeof httpStatus === 'number') {
		return apiMessage
			? `Checkredirects API returned ${httpStatus}: ${apiMessage}`
			: `Checkredirects API returned ${httpStatus}.`;
	}
	const networkCode = error?.cause?.code || error?.code;
	if (networkCode) {
		return `Network error contacting Checkredirects (${networkCode}). Try again.`;
	}
	// Fallback path: prefer the caller's pre-sanitized apiMessage, but if absent
	// run sanitizeApiMessage over raw error.message INLINE — callers that omit
	// apiMessage (e.g. CheckredirectsPollTrigger network errors) must not leak
	// Bearer tokens / signed-URL query strings into the user-visible
	// NodeOperationError. The status-mapped branches above can rely on a
	// pre-sanitized apiMessage because they only fire on HTTP responses; the
	// fallback fires on transport-level failures the caller may not have
	// pre-sanitized.
	const rawMessage = typeof error?.message === 'string' ? error.message : '';
	const safeFallback = apiMessage || sanitizeApiMessage(rawMessage) || 'unknown error';
	if (opts.context) {
		return `${opts.context}: ${safeFallback}`;
	}
	return safeFallback === 'unknown error' ? 'Request failed' : safeFallback;
}

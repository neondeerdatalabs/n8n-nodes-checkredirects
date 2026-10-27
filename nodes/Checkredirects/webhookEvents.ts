// Single source of truth for webhook events. The UI options list, the
// KNOWN_EVENTS allowlist, and the per-event filter dispatch are all derived
// from this array — adding a new event needs only one edit here.
// Each `value` is part of the public contract (R1); never change existing
// values without a major version bump.

export interface WebhookEvent {
	value: string;
	name: string;
	description: string;
	// Returns true when an incoming POST body should fire this UI-selected event.
	matches(incomingEvent: string | undefined, body: any): boolean;
}

export const WEBHOOK_EVENTS: WebhookEvent[] = [
	{
		value: 'batch.completed',
		name: 'Batch Completed',
		description: 'Fires when any batch job finishes',
		matches: (incoming) => incoming === 'batch.completed',
	},
	{
		value: 'monitor.completed',
		name: 'Monitor Completed',
		description: 'Fires when a monitor run finishes',
		matches: (incoming) => incoming === 'monitor.completed',
	},
	{
		value: 'monitor.change_detected',
		name: 'Monitor Change Detected',
		description: 'Fires only when a monitor run detects changes vs the previous run',
		// Require strict boolean true. Boolean(body.has_changes) coerces truthy
		// non-booleans (e.g. the string "false", "0", {}, []) to true. A signed
		// payload with `has_changes: "false"` from upstream serialization regression
		// or a proxy transform would otherwise fire change_detected subscribers
		// as a false positive.
		matches: (incoming, body) => incoming === 'monitor.completed' && body && body.has_changes === true,
	},
];

// Wire-level allowlist: only event names the API actually sends. The original
// KNOWN_EVENTS Set also included 'monitor.change_detected' but the filter
// ladder below would have rejected that incoming wire shape anyway — it was
// dead/defensive. This set intentionally represents accepted wire events only.
export const KNOWN_EVENT_VALUES = new Set(
	WEBHOOK_EVENTS.flatMap((e) => {
		if (e.value === 'monitor.change_detected') return ['monitor.completed'];
		return [e.value];
	}),
);

export function eventOptions() {
	return WEBHOOK_EVENTS.map((e) => ({
		name: e.name,
		value: e.value,
		description: e.description,
	}));
}

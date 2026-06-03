import {
	IPollFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';
import { assertAllowedBaseUrl, assertApiKeyPresent } from './baseUrl';
import { mapCheckredirectsApiError } from './apiError';

// Defensive page-size cap. If the API ever returns more runs than this on one
// page, we surface a NodeOperationError (so the missed-event situation is
// observable) instead of silently advancing lastSeen past unseen records.
const MAX_RUNS_PER_POLL = 100;

// Parse an ISO-8601 timestamp to epoch ms. Returns NaN for unparseable input —
// callers must skip such records rather than advance lastSeen past them.
function parseCreatedAt(raw: unknown): number {
	if (typeof raw !== 'string' || raw.length === 0) return NaN;
	const ts = Date.parse(raw);
	return Number.isFinite(ts) ? ts : NaN;
}

export class CheckredirectsPollTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Checkredirects.io Poll Trigger',
		name: 'checkredirectsPollTrigger',
		icon: 'file:checkredirects.svg',
		group: ['trigger'],
		version: 1,
		subtitle: 'Monitor: {{$parameter["monitorId"]}}',
		description: 'Polls for new monitor runs on a schedule. No webhook setup needed.',
		defaults: {
			name: 'Checkredirects.io Poll',
		},
		polling: true,
		inputs: [],
		outputs: [{ type: NodeConnectionTypes.Main }],
		credentials: [
			{
				name: 'checkredirectsApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Monitor ID',
				name: 'monitorId',
				type: 'string',
				required: true,
				default: '',
				description: 'The monitor to watch for new runs. Get the ID from the Monitors page or the List Monitors operation.',
			},
			{
				displayName: 'Include Changes',
				name: 'includeChanges',
				type: 'boolean',
				default: true,
				description: 'Include change detection data (what changed vs the previous run).',
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const credentials = await this.getCredentials('checkredirectsApi');
		let baseUrl: string;
		try {
			assertApiKeyPresent(credentials.apiKey);
			baseUrl = assertAllowedBaseUrl(credentials.baseUrl, { allowCustomHost: credentials.allowCustomHost as boolean | undefined });
		} catch (err) {
			throw new NodeOperationError(this.getNode(), (err as Error).message);
		}

		const rawMonitorId = this.getNodeParameter('monitorId') as string;
		const monitorIdTrimmed = typeof rawMonitorId === 'string' ? rawMonitorId.trim() : '';
		if (monitorIdTrimmed.length === 0) {
			throw new NodeOperationError(this.getNode(), 'Monitor ID is missing. Find it on the Monitors page or via the List Monitors operation.');
		}
		if (/[/?#%\\\s\x00-\x1F\x7F]/.test(monitorIdTrimmed)) {
			throw new NodeOperationError(this.getNode(), 'Invalid Monitor ID. IDs must not contain slashes, query characters, percent signs, backslashes, whitespace, or control characters.');
		}
		const monitorId = encodeURIComponent(monitorIdTrimmed);
		const includeChanges = this.getNodeParameter('includeChanges') as boolean;

		// Request the same page size we use for the overflow detector so the API's
		// default page size can't diverge from our cap. Without this, an upstream
		// default smaller than MAX_RUNS_PER_POLL would never trigger the full-page
		// alarm even when runs are being silently skipped.
		const params = new URLSearchParams();
		params.set('per_page', String(MAX_RUNS_PER_POLL));
		if (includeChanges) params.set('include_changes', 'true');
		const url = `${baseUrl}/v1/monitors/${monitorId}/runs?${params.toString()}`;

		let runs: any[];
		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'checkredirectsApi',
				{ method: 'GET', url, json: true },
			);
			// Validate before assigning. A future API revision that wraps the list
			// (e.g. `{ data: { items: [...], next_cursor: "..." } }`) would
			// otherwise throw a raw TypeError on the .map/.reduce calls below.
			// Surface a controlled NodeOperationError instead so the user sees
			// "API contract may have changed" rather than a runtime crash.
			if (!Array.isArray(response?.data)) {
				throw new NodeOperationError(
					this.getNode(),
					'Unexpected response from /v1/monitors/{id}/runs — expected an array under `data`. The API contract may have changed.',
				);
			}
			runs = response.data;
		} catch (error: any) {
			if (error instanceof NodeOperationError) throw error;
			throw new NodeOperationError(
				this.getNode(),
				mapCheckredirectsApiError(error, {
					idLabel: 'Monitor',
					idValue: monitorIdTrimmed,
					context: 'Failed to fetch monitor runs',
				}),
			);
		}

		if (runs.length === 0) return null;

		// F2: parse created_at to epoch ms so sort/compare are chronological,
		// not lexicographic. Records with unparseable timestamps are skipped
		// (not used to advance lastSeen — keeps the watermark sane).
		const staticData = this.getWorkflowStaticData('node');
		const lastSeenStr = staticData.lastSeen as string | undefined;
		const lastSeenMs = parseCreatedAt(lastSeenStr);
		// Tied-timestamp tie-breaker: tracks the job_ids ALREADY emitted at the
		// watermark timestamp. Filter accepts records strictly newer than
		// lastSeen OR records equal to lastSeen whose job_id isn't in this set.
		// Without this, two runs sharing the same created_at (second-granular
		// API timestamps or near-simultaneous completions) would silently drop
		// the second one because the strict `>` filter rejects ties.
		const lastSeenJobIds = Array.isArray(staticData.lastSeenJobIds)
			? new Set(staticData.lastSeenJobIds as string[])
			: new Set<string>();

		// F3: alarm on a full page when we have evidence runs may be silently
		// skipped. Two distinct failure modes:
		//   (a) Cursor moved past unseen runs: page is full AND its oldest run
		//       is strictly newer than lastSeen — we missed the runs between
		//       lastSeen and oldest.
		//   (b) Tied-timestamp saturation: page is full AND every run shares
		//       the same created_at — there could be MORE runs at that same
		//       timestamp beyond per_page that the tied-jobIds tie-breaker
		//       below will never see.
		// First poll (no lastSeenMs) skips (a) but (b) still applies.
		if (runs.length >= MAX_RUNS_PER_POLL) {
			let oldestMs = Number.POSITIVE_INFINITY;
			let newestMs = Number.NEGATIVE_INFINITY;
			for (const r of runs) {
				const ms = parseCreatedAt(r.created_at);
				if (Number.isFinite(ms)) {
					if (ms < oldestMs) oldestMs = ms;
					if (ms > newestMs) newestMs = ms;
				}
			}
			const fullyTiedPage = Number.isFinite(newestMs) && newestMs === oldestMs;
			const cursorPastUnseen = Number.isFinite(lastSeenMs)
				&& Number.isFinite(oldestMs)
				&& oldestMs > lastSeenMs;
			if (cursorPastUnseen || fullyTiedPage) {
				throw new NodeOperationError(
					this.getNode(),
					`Monitor "${monitorIdTrimmed}" returned a full page (${runs.length}) ${fullyTiedPage ? 'with every run sharing the same created_at' : 'and the oldest run is still newer than the last seen one'} — older or tied unseen runs may be silently dropped. Increase poll frequency, or contact support if you need a paginated/cursor API.`,
				);
			}
		}

		const enriched = runs
			.map((r: any) => ({ run: r, ms: parseCreatedAt(r.created_at) }))
			.filter((e) => Number.isFinite(e.ms));

		if (enriched.length === 0) return null;

		// Sort newest first by parsed timestamp.
		enriched.sort((a, b) => b.ms - a.ms);

		// Pre-scan: any tied-watermark record without a usable job_id violates the
		// API contract (every run carries job_id). Without this guard the filter
		// below would silently drop the record forever — caller has no signal an
		// event was lost. Surface a controlled NodeOperationError so the user sees
		// "contract may have changed" instead of missing webhooks. The same check
		// applies to the first-poll path (lastSeenMs is NaN, lastSeenJobIds is
		// empty) for any record sharing the newest timestamp, because that
		// timestamp becomes the new watermark and any unemitted tied record at
		// that ts would otherwise persist as never-emittable.
		const newestEnrichedMs = enriched[0].ms;
		const watermarkMs = Number.isFinite(lastSeenMs) ? lastSeenMs : newestEnrichedMs;
		for (const e of enriched) {
			if (e.ms !== watermarkMs) continue;
			const jobId = typeof e.run.job_id === 'string' ? e.run.job_id : '';
			if (jobId.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					`Monitor "${monitorIdTrimmed}" returned a run with timestamp ${e.run.created_at} tied to the watermark but no valid job_id — without job_id we cannot dedupe ties across polls and would silently drop events. The API contract may have changed.`,
				);
			}
		}

		const newEntries = Number.isFinite(lastSeenMs)
			? enriched.filter((e) => {
				if (e.ms > lastSeenMs) return true;
				// Tied with the watermark — accept only if we haven't emitted this
				// job_id at this timestamp yet. (The pre-scan above already
				// asserted job_id is present + non-empty for every tied record.)
				if (e.ms === lastSeenMs) {
					const jobId = e.run.job_id as string;
					return !lastSeenJobIds.has(jobId);
				}
				return false;
			})
			: [enriched[0]];

		if (newEntries.length === 0) return null;

		// Persist the newest seen timestamp + the job_ids EMITTED at that
		// timestamp so the next poll's tie-breaker can reject them on tie.
		// We persist only EMITTED ids — never tied-but-not-emitted runs — so a
		// first-poll case where two runs share the newest created_at still gets
		// the unemitted tied run picked up on the next poll.
		const newestMs = newEntries[0].ms;
		staticData.lastSeen = newEntries[0].run.created_at;
		const tiedJobIds = new Set<string>();
		// If the watermark stayed at the same timestamp, retain prior IDs so
		// previously-emitted ties continue to be rejected.
		if (Number.isFinite(lastSeenMs) && lastSeenMs === newestMs) {
			lastSeenJobIds.forEach((id) => tiedJobIds.add(id));
		}
		for (const e of newEntries) {
			if (e.ms !== newestMs) break; // newEntries is sorted newest-first
			const jid = typeof e.run.job_id === 'string' ? e.run.job_id : '';
			if (jid.length > 0) tiedJobIds.add(jid);
		}
		staticData.lastSeenJobIds = Array.from(tiedJobIds);

		return [newEntries.map((e) => ({ json: e.run }))];
	}
}

import {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';
import { assertAllowedBaseUrl, assertApiKeyPresent } from './baseUrl';
import { mapCheckredirectsApiError } from './apiError';
import { sanitizeApiMessage, unwrap } from './helpers';
import { inspectionHandlers } from './handlers/inspection';
import { batchHandlers } from './handlers/batch';
import { monitorHandlers } from './handlers/monitor';
import { accountHandlers } from './handlers/account';
import { ResourceHandlers, HandlerContext } from './handlers/types';

// Per-resource handler registry. New resources / operations register here.
// Operation `value` keys are part of the published n8n contract (R1) — never
// rename existing entries without a major version bump.
const RESOURCE_HANDLERS: Record<string, ResourceHandlers> = {
	inspection: inspectionHandlers,
	batch: batchHandlers,
	monitor: monitorHandlers,
	account: accountHandlers,
};

// Hardcoded fallback for the user-agent pack list — used when /v1/user-agents
// is unreachable. Keep the existing keys stable per R1.
function fallbackPacks() {
	return [
		{ name: 'Custom (specify agents below)', value: '' },
		{ name: 'SEO Essentials', value: 'seo_essentials' },
		{ name: 'Social Preview', value: 'social_preview' },
		{ name: 'Mobile vs Desktop', value: 'mobile_vs_desktop' },
		{ name: 'AI Crawler Audit', value: 'ai_crawler_audit' },
		{ name: 'Full Coverage', value: 'full_coverage' },
	];
}

// Minimal fallback set of common user-agents when the catalog can't load.
function fallbackUserAgents() {
	return [
		{ name: 'Googlebot Desktop (search)', value: 'googlebot_desktop' },
		{ name: 'Googlebot Mobile (search)', value: 'googlebot_mobile' },
		{ name: 'Bingbot (search)', value: 'bingbot' },
		{ name: 'Chrome on Windows (browser)', value: 'chrome_windows' },
		{ name: 'Safari on iPhone (browser)', value: 'safari_iphone' },
	];
}

export class Checkredirects implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Checkredirects.io',
		name: 'checkredirects',
		icon: 'file:checkredirects.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description: 'URL inspection, redirect checking, and monitoring API',
		defaults: {
			name: 'Checkredirects.io',
		},
		inputs: [{ type: NodeConnectionTypes.Main }],
		outputs: [{ type: NodeConnectionTypes.Main }],
		credentials: [
			{
				name: 'checkredirectsApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'URL Inspection', value: 'inspection' },
					{ name: 'Batch', value: 'batch' },
					{ name: 'Monitor', value: 'monitor' },
					{ name: 'Account', value: 'account' },
				],
				default: 'inspection',
			},

			// ── Inspection operations ──
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['inspection'] } },
				options: [
					{ name: 'Inspect URL', value: 'inspect', description: 'Check a single URL with full redirect chain', action: 'Inspect a URL' },
					{ name: 'Compare Agents', value: 'compareAgents', description: 'Check same URL across multiple user agents', action: 'Compare user agents' },
					{ name: 'Import Sitemap', value: 'importSitemap', description: 'Extract URLs from a sitemap', action: 'Import sitemap URLs' },
				],
				default: 'inspect',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com',
				description: 'The URL to inspect (http/https, max 2048 characters)',
				displayOptions: { show: { resource: ['inspection'], operation: ['inspect', 'compareAgents'] } },
			},
			{
				displayName: 'Preset',
				name: 'inspectPresetId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getPresets' },
				default: '',
				description: 'Apply a saved preset configuration',
				displayOptions: { show: { resource: ['inspection'], operation: ['inspect'] } },
			},
			{
				displayName: 'Method',
				name: 'method',
				type: 'options',
				options: [
					{ name: 'HEAD', value: 'HEAD' },
					{ name: 'GET', value: 'GET' },
				],
				default: 'HEAD',
				description: 'HTTP method to use for the request',
				displayOptions: { show: { resource: ['inspection'], operation: ['inspect'] } },
			},
			{
				displayName: 'Follow Redirects',
				name: 'followRedirects',
				type: 'boolean',
				default: true,
				description: 'Whether to follow redirect responses (3xx status codes)',
				displayOptions: { show: { resource: ['inspection'], operation: ['inspect'] } },
			},
			{
				displayName: 'Max Redirects',
				name: 'maxRedirects',
				type: 'number',
				default: 10,
				description: 'Maximum number of redirects to follow (max 20)',
				displayOptions: { show: { resource: ['inspection'], operation: ['inspect'] } },
			},
			{
				displayName: 'User Agent (Preset)',
				name: 'userAgentKey',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getUserAgents' },
				default: '',
				description: 'Pick a preset from the live /v1/user-agents catalog. Takes precedence over the User Agent string below when set.',
				displayOptions: { show: { resource: ['inspection'], operation: ['inspect'] } },
			},
			{
				displayName: 'User Agent (Custom)',
				name: 'userAgent',
				type: 'string',
				default: '',
				placeholder: 'Mozilla/5.0 ...',
				description: 'Custom UA string. Used only when User Agent (Preset) is left empty.',
				displayOptions: { show: { resource: ['inspection'], operation: ['inspect'] } },
			},
			{
				displayName: 'Retrieve Body (Meta Tags)',
				name: 'retrieveBody',
				type: 'boolean',
				default: false,
				description: 'Extract SEO metadata (title, canonical, OG tags) from the final page',
				displayOptions: { show: { resource: ['inspection'], operation: ['inspect'] } },
			},
			{
				displayName: 'Additional Request Options',
				name: 'inspectAdditional',
				type: 'collection',
				default: {},
				placeholder: 'Add Option',
				displayOptions: { show: { resource: ['inspection'], operation: ['inspect'] } },
				options: [
					{
						displayName: 'Headers',
						name: 'headers',
						type: 'fixedCollection',
						default: {},
						typeOptions: { multipleValues: true },
						placeholder: 'Add Header',
						options: [{
							name: 'entries',
							displayName: 'Header',
							values: [
								{ displayName: 'Name', name: 'name', type: 'string', default: '' },
								{ displayName: 'Value', name: 'value', type: 'string', default: '' },
							],
						}],
					},
					{
						displayName: 'Cookies',
						name: 'cookies',
						type: 'string',
						default: '',
						description: 'Cookie header value (e.g. "session=abc; ref=foo")',
					},
					{
						displayName: 'Basic Auth User',
						name: 'basicAuthUser',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Basic Auth Password',
						name: 'basicAuthPass',
						type: 'string',
						typeOptions: { password: true },
						default: '',
					},
				],
			},

			// Compare Agents fields
			{
				displayName: 'Pack',
				name: 'pack',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getUserAgentPacks' },
				default: 'seo_essentials',
				description: 'Pack of pre-defined user agents. The list is fetched live from /v1/user-agents — if that endpoint is unreachable, a hardcoded fallback is shown.',
				displayOptions: { show: { resource: ['inspection'], operation: ['compareAgents'] } },
			},
			{
				displayName: 'User Agents',
				name: 'userAgents',
				type: 'string',
				default: '',
				placeholder: 'googlebot_desktop, chrome_windows, safari_iphone',
				description: 'Comma-separated agent keys (only when Pack is "Custom")',
				displayOptions: { show: { resource: ['inspection'], operation: ['compareAgents'], pack: [''] } },
			},

			// Import Sitemap fields
			{
				displayName: 'Sitemap URL',
				name: 'sitemapUrl',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com/sitemap.xml',
				displayOptions: { show: { resource: ['inspection'], operation: ['importSitemap'] } },
			},
			{
				displayName: 'Max URLs',
				name: 'sitemapMaxUrls',
				type: 'number',
				default: 5000,
				typeOptions: { minValue: 1, maxValue: 100000 },
				description: 'Cap on URLs emitted from the sitemap. Large sitemaps (50k+ URLs per sitemap.org standard) can flood downstream nodes; truncating prevents runaway workflows. Raise if you need more, lower for safety.',
				displayOptions: { show: { resource: ['inspection'], operation: ['importSitemap'] } },
			},

			// ── Batch operations ──
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['batch'] } },
				options: [
					{ name: 'Check and Wait', value: 'checkAndWait', description: 'Submit URLs and wait for results', action: 'Check URLs and wait for results' },
					{ name: 'Create Batch', value: 'create', description: 'Submit URLs for async checking', action: 'Create a batch job' },
					{ name: 'Get Results', value: 'getResults', description: 'Fetch completed batch results', action: 'Get batch results' },
					{ name: 'Get Progress', value: 'getProgress', description: 'Check batch completion status', action: 'Get batch progress' },
					{ name: 'Compare Batches', value: 'compare', description: 'Diff two batch runs', action: 'Compare two batches' },
				{ name: 'Export CSV', value: 'exportCsv', description: 'Download completed batch results as a CSV file (binary)', action: 'Export batch as CSV' },
				{ name: 'Export to Google Sheets', value: 'exportToSheets', description: 'Push completed batch results into a Google Sheet', action: 'Export batch to Sheets' },
				],
				default: 'checkAndWait',
			},
			{
				displayName: 'URLs',
				name: 'urls',
				type: 'string',
				typeOptions: { rows: 10 },
				required: true,
				default: '',
				placeholder: 'https://example.com/page1\nhttps://example.com/page2',
				description: 'One URL per line',
				displayOptions: { show: { resource: ['batch'], operation: ['create', 'checkAndWait'] } },
			},
			{
				displayName: 'Preset',
				name: 'batchPresetId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getPresets' },
				default: '',
				description: 'Apply a saved preset configuration',
				displayOptions: { show: { resource: ['batch'], operation: ['create', 'checkAndWait'] } },
			},
			{
				displayName: 'Method',
				name: 'batchMethod',
				type: 'options',
				options: [
					{ name: 'HEAD', value: 'HEAD' },
					{ name: 'GET', value: 'GET' },
				],
				default: 'HEAD',
				description: 'HTTP method to use for batch requests',
				displayOptions: { show: { resource: ['batch'], operation: ['create', 'checkAndWait'] } },
			},
			{
				displayName: 'User Agent',
				name: 'batchUserAgent',
				type: 'string',
				default: '',
				description: 'A preset key (e.g. googlebot_desktop) or custom UA string',
				displayOptions: { show: { resource: ['batch'], operation: ['create', 'checkAndWait'] } },
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				description: 'URL to POST when batch completes',
				displayOptions: { show: { resource: ['batch'], operation: ['create'] } },
			},
			{
				displayName: 'Export to Google Sheets',
				name: 'exportToSheets',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['batch'], operation: ['create', 'checkAndWait'] } },
			},
			{
				displayName: 'Additional Request Options',
				name: 'batchAdditional',
				type: 'collection',
				default: {},
				placeholder: 'Add Option',
				displayOptions: { show: { resource: ['batch'], operation: ['create', 'checkAndWait'] } },
				options: [
					{
						displayName: 'Headers',
						name: 'headers',
						type: 'fixedCollection',
						default: {},
						typeOptions: { multipleValues: true },
						placeholder: 'Add Header',
						options: [{
							name: 'entries',
							displayName: 'Header',
							values: [
								{ displayName: 'Name', name: 'name', type: 'string', default: '' },
								{ displayName: 'Value', name: 'value', type: 'string', default: '' },
							],
						}],
					},
					{
						displayName: 'Cookies',
						name: 'cookies',
						type: 'string',
						default: '',
						description: 'Cookie header value applied to every URL in the batch',
					},
					{
						displayName: 'Basic Auth User',
						name: 'basicAuthUser',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Basic Auth Password',
						name: 'basicAuthPass',
						type: 'string',
						typeOptions: { password: true },
						default: '',
					},
				],
			},
			{
				displayName: 'Split Results',
				name: 'splitResults',
				type: 'boolean',
				default: true,
				description: 'Output each URL as a separate item (enables per-URL downstream processing)',
				displayOptions: { show: { resource: ['batch'], operation: ['checkAndWait', 'getResults'] } },
			},
			{
				displayName: 'Compare with Previous Job ID',
				name: 'compareWithJobId',
				type: 'string',
				default: '',
				description: 'If set, returns only the diff between this batch and the specified job',
				displayOptions: { show: { resource: ['batch'], operation: ['checkAndWait'] } },
			},
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['batch'], operation: ['getResults', 'getProgress', 'exportCsv', 'exportToSheets'] } },
			},
			{
				displayName: 'Spreadsheet Mode',
				name: 'sheetsExportMode',
				type: 'options',
				options: [
					{ name: 'Default Spreadsheet', value: 'default', description: 'Use the org default spreadsheet (creates one if none exists)' },
					{ name: 'New Spreadsheet', value: 'new', description: 'Always create a new spreadsheet' },
					{ name: 'Specific Spreadsheet', value: 'specific', description: 'Use the spreadsheet whose ID you provide below' },
				],
				default: 'default',
				displayOptions: { show: { resource: ['batch'], operation: ['exportToSheets'] } },
			},
			{
				displayName: 'Spreadsheet ID',
				name: 'sheetsSpreadsheetId',
				type: 'string',
				default: '',
				required: true,
				description: 'The Google Sheets spreadsheet ID to export to (required when Spreadsheet Mode is Specific)',
				displayOptions: { show: { resource: ['batch'], operation: ['exportToSheets'], sheetsExportMode: ['specific'] } },
			},
			{
				displayName: 'Drive Folder ID',
				name: 'sheetsDriveFolderId',
				type: 'string',
				default: '',
				description: 'Optional Google Drive folder ID to create new spreadsheets in. Only used when Spreadsheet Mode is "New" or when creating the first default spreadsheet.',
				displayOptions: { show: { resource: ['batch'], operation: ['exportToSheets'] } },
			},
			{
				displayName: 'Sort By',
				name: 'sort',
				type: 'options',
				options: [
					{ name: 'Input Order', value: 'input_order' },
					{ name: 'Status Code', value: 'status' },
					{ name: 'Response Time', value: 'latency' },
					{ name: 'Hop Count', value: 'hops' },
				],
				default: 'input_order',
				displayOptions: { show: { resource: ['batch'], operation: ['getResults'] } },
			},
			{
				displayName: 'URL Contains',
				name: 'urlContains',
				type: 'string',
				default: '',
				description: 'Filter results to URLs containing this substring',
				displayOptions: { show: { resource: ['batch'], operation: ['getResults'] } },
			},
			{
				displayName: 'Final URL Contains',
				name: 'finalUrlContains',
				type: 'string',
				default: '',
				description: 'Filter results by final destination URL substring',
				displayOptions: { show: { resource: ['batch'], operation: ['getResults'] } },
			},
			{
				displayName: 'Page',
				name: 'page',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 1 },
				description: 'Page number (1-based). Default returns page 1 only; use Per Page to control page size, then increment Page to fetch the rest.',
				displayOptions: { show: { resource: ['batch'], operation: ['getResults'] } },
			},
			{
				displayName: 'Per Page',
				name: 'perPage',
				type: 'number',
				default: 100,
				typeOptions: { minValue: 1, maxValue: 500 },
				description: 'Results per page (max 500). Higher values return more data per call but are slower; lower values let you stream results incrementally.',
				displayOptions: { show: { resource: ['batch'], operation: ['getResults'] } },
			},
			{
				displayName: 'Job ID',
				name: 'compareJobId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['batch'], operation: ['compare'] } },
			},
			{
				displayName: 'Other Job ID',
				name: 'compareOtherJobId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['batch'], operation: ['compare'] } },
			},
			{
				displayName: 'Changes Only',
				name: 'changesOnly',
				type: 'boolean',
				default: true,
				description: 'Only return URLs that changed between the two runs',
				displayOptions: { show: { resource: ['batch'], operation: ['compare'] } },
			},

			// ── Monitor operations ──
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['monitor'] } },
				options: [
					{ name: 'Create', value: 'create', action: 'Create a monitor' },
					{ name: 'List', value: 'list', action: 'List monitors' },
					{ name: 'Get', value: 'get', action: 'Get a monitor' },
					{ name: 'Update', value: 'update', description: 'Replace ALL monitor settings — required fields (name, urls, interval) overwrite the existing values. Optional fields follow the same convention as Create: webhook URL is only set when you provide one (leave blank to keep the existing), Auto-Export to Sheets is only flipped on when checked (leave unchecked to keep the existing).', action: 'Update a monitor' },
					{ name: 'Delete', value: 'delete', action: 'Delete a monitor' },
					{ name: 'Pause', value: 'pause', action: 'Pause a monitor' },
					{ name: 'Resume', value: 'resume', action: 'Resume a monitor' },
					{ name: 'Trigger', value: 'trigger', action: 'Trigger a monitor run' },
					{ name: 'Get Runs', value: 'getRuns', action: 'Get monitor run history' },
				],
				default: 'list',
			},
			{
				displayName: 'Monitor ID',
				name: 'monitorId',
				type: 'string',
				required: true,
				default: '',
				description: 'The ID of the monitor. Find it on the Monitors page or via List Monitors.',
				displayOptions: { show: { resource: ['monitor'], operation: ['get', 'update', 'delete', 'pause', 'resume', 'trigger', 'getRuns'] } },
			},
			{
				displayName:
					'Update is GET-then-PUT (the Checkredirects API does not yet support If-Match / ETag headers). If two workflows update the same monitor at the same time, the later PUT will silently overwrite the earlier one. For high-contention scenarios, serialize updates upstream (queue, lock node, single workflow) until first-class concurrency control ships.',
				name: 'monitorUpdateConcurrencyNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { resource: ['monitor'], operation: ['update'] } },
			},
			{
				displayName: 'Name',
				name: 'monitorName',
				type: 'string',
				required: true,
				default: '',
				description: 'A display name for this monitor',
				displayOptions: { show: { resource: ['monitor'], operation: ['create', 'update'] } },
			},
			{
				displayName: 'URLs',
				name: 'monitorUrls',
				type: 'string',
				typeOptions: { rows: 5 },
				required: true,
				default: '',
				placeholder: 'One URL per line',
				description: 'URLs to monitor for redirect changes, one per line',
				displayOptions: { show: { resource: ['monitor'], operation: ['create', 'update'] } },
			},
			{
				displayName: 'Check Interval',
				name: 'intervalMinutes',
				type: 'options',
				options: [
					{ name: 'Every 30 Minutes', value: 30 },
					{ name: 'Every Hour', value: 60 },
					{ name: 'Every 6 Hours', value: 360 },
					{ name: 'Daily', value: 1440 },
					{ name: 'Weekly', value: 10080 },
				],
				default: 1440,
				displayOptions: { show: { resource: ['monitor'], operation: ['create', 'update'] } },
			},
			{
				displayName: 'Webhook URL',
				name: 'monitorWebhookUrl',
				type: 'string',
				default: '',
				description: 'URL to POST when a monitor run completes',
				displayOptions: { show: { resource: ['monitor'], operation: ['create', 'update'] } },
			},
			{
				displayName: 'Auto-Export to Sheets',
				name: 'sheetsAppend',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['monitor'], operation: ['create', 'update'] } },
			},
			{
				displayName: 'Clear Webhook URL',
				name: 'clearWebhookUrl',
				type: 'boolean',
				default: false,
				description: 'Update only. Turn ON to explicitly remove the existing webhook URL (otherwise blank input preserves the existing value).',
				displayOptions: { show: { resource: ['monitor'], operation: ['update'] } },
			},
			{
				displayName: 'Clear Auto-Export to Sheets',
				name: 'clearSheetsAppend',
				type: 'boolean',
				default: false,
				description: 'Update only. Turn ON to explicitly disable Auto-Export to Sheets on the existing monitor (otherwise the unchecked "Auto-Export" box preserves the existing value).',
				displayOptions: { show: { resource: ['monitor'], operation: ['update'] } },
			},
			{
				displayName: 'Clear Custom Headers',
				name: 'clearHeaders',
				type: 'boolean',
				default: false,
				description: 'Update only. Turn ON to explicitly remove ALL custom headers from the existing monitor (otherwise empty Headers in Additional Request Options preserves the existing values).',
				displayOptions: { show: { resource: ['monitor'], operation: ['update'] } },
			},
			{
				displayName: 'Clear Cookies',
				name: 'clearCookies',
				type: 'boolean',
				default: false,
				description: 'Update only. Turn ON to explicitly remove the existing Cookies value (otherwise empty Cookies in Additional Request Options preserves the existing value).',
				displayOptions: { show: { resource: ['monitor'], operation: ['update'] } },
			},
			{
				displayName: 'Additional Request Options',
				name: 'monitorAdditional',
				type: 'collection',
				default: {},
				placeholder: 'Add Option',
				displayOptions: { show: { resource: ['monitor'], operation: ['create', 'update'] } },
				// NOTE: the API's monitorRequest schema only accepts headers + cookies
				// here — basic_auth is supported on inspect / batch only. Don't add a
				// basic auth field unless the API adds it server-side first; the
				// request would 400 due to DisallowUnknownFields.
				options: [
					{
						displayName: 'Headers',
						name: 'headers',
						type: 'fixedCollection',
						default: {},
						typeOptions: { multipleValues: true },
						placeholder: 'Add Header',
						options: [{
							name: 'entries',
							displayName: 'Header',
							values: [
								{ displayName: 'Name', name: 'name', type: 'string', default: '' },
								{ displayName: 'Value', name: 'value', type: 'string', default: '' },
							],
						}],
					},
					{
						displayName: 'Cookies',
						name: 'cookies',
						type: 'string',
						default: '',
						description: 'Cookie header value applied to every monitor check',
					},
				],
			},
			{
				displayName: 'Include Changes',
				name: 'includeChanges',
				type: 'boolean',
				default: false,
				description: 'Include change detection data for each run (what changed vs previous)',
				displayOptions: { show: { resource: ['monitor'], operation: ['getRuns'] } },
			},

			// ── Account operations ──
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{ name: 'Get Usage', value: 'getUsage', description: 'Get current usage and credit balance', action: 'Get account usage' },
				],
				default: 'getUsage',
			},
		],
	};

	methods = {
		loadOptions: {
			async getPresets(this: ILoadOptionsFunctions) {
				try {
					const creds = await this.getCredentials('checkredirectsApi');
					const baseUrl = assertAllowedBaseUrl(creds.baseUrl, { allowCustomHost: creds.allowCustomHost as boolean | undefined });
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'checkredirectsApi',
						{
							method: 'GET',
							url: `${baseUrl}/v1/presets`,
							json: true,
						},
					);
					const options = [{ name: '(None)', value: '' }];
					if (Array.isArray(response?.data)) {
						for (const p of response.data) {
							options.push({ name: p.name, value: p.id });
						}
					}
					return options;
				} catch (err: any) {
					// Distinguish "no presets exist" (which would still return [{name:'(None)'}])
					// from "could not load presets" so the user can debug rather than
					// silently see (None). Common causes: bad apiKey, bad baseUrl
					// (caught by assertAllowedBaseUrl), or upstream outage.
					const httpStatus = err?.response?.status || err?.statusCode;
					if (httpStatus === 401) {
						return [{ name: '(Could not load presets — invalid API key)', value: '' }];
					}
					if (typeof httpStatus === 'number') {
						return [{ name: `(Could not load presets — API returned ${httpStatus})`, value: '' }];
					}
					if (err?.message && /Base URL|API key/i.test(err.message)) {
						return [{ name: '(Could not load presets — check credentials)', value: '' }];
					}
					return [{ name: '(Could not load presets — see node logs)', value: '' }];
				}
			},

			// /v1/user-agents is public — no auth required — but we still funnel
			// through assertAllowedBaseUrl so an attacker-edited baseUrl can't
			// leak the bearer header via the loadOptions request.
			async getUserAgents(this: ILoadOptionsFunctions) {
				try {
					const creds = await this.getCredentials('checkredirectsApi');
					const baseUrl = assertAllowedBaseUrl(creds.baseUrl, { allowCustomHost: creds.allowCustomHost as boolean | undefined });
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'checkredirectsApi',
						{ method: 'GET', url: `${baseUrl}/v1/user-agents`, json: true },
					);
					const agents = Array.isArray(response?.agents) ? response.agents : [];
					if (agents.length === 0) return fallbackUserAgents();
					return agents.map((a: any) => ({
						name: `${a.label || a.key} (${a.group || 'other'})`,
						value: a.key,
					}));
				} catch {
					return fallbackUserAgents();
				}
			},

			async getUserAgentPacks(this: ILoadOptionsFunctions) {
				try {
					const creds = await this.getCredentials('checkredirectsApi');
					const baseUrl = assertAllowedBaseUrl(creds.baseUrl, { allowCustomHost: creds.allowCustomHost as boolean | undefined });
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'checkredirectsApi',
						{ method: 'GET', url: `${baseUrl}/v1/user-agents`, json: true },
					);
					const packs = Array.isArray(response?.packs) ? response.packs : [];
					const options = [{ name: 'Custom (specify agents below)', value: '' }];
					for (const p of packs) {
						options.push({
							name: p.name || p.key,
							value: p.key,
						});
					}
					if (options.length === 1) return fallbackPacks();
					return options;
				} catch {
					return fallbackPacks();
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Preflight: checkAndWait blocks the worker for up to 5 minutes per item.
		// Reject multi-item executions where ANY item uses checkAndWait (item-0
		// alone is not safe to check after F-015 made resource/operation per-item).
		// Multi-item flows should use Create Batch + Get Results, or wire the
		// Webhook Trigger to fire when each batch completes.
		//
		// continueOnFail honored: when ON, we defer the rejection into the per-
		// item loop so non-checkAndWait items still process and the disallowed
		// items emit a clean `{ error }` output instead of aborting execution.
		// When OFF, we hard-throw before any item runs to preserve the current
		// fail-fast semantic.
		const hasMultiItemCheckAndWait = items.length > 1 && (() => {
			for (let j = 0; j < items.length; j++) {
				const r = this.getNodeParameter('resource', j) as string;
				const o = this.getNodeParameter('operation', j) as string;
				if (r === 'batch' && o === 'checkAndWait') return true;
			}
			return false;
		})();

		if (hasMultiItemCheckAndWait && !this.continueOnFail()) {
			throw new NodeOperationError(
				this.getNode(),
				`Batch "Check and Wait" only supports one input item per execution (multi-item input with checkAndWait detected). Use "Create Batch" followed by "Get Results" or the Webhook Trigger for multi-item flows.`,
			);
		}

		const credentials = await this.getCredentials('checkredirectsApi');
		let baseUrl: string;
		try {
			assertApiKeyPresent(credentials.apiKey);
			baseUrl = assertAllowedBaseUrl(credentials.baseUrl, { allowCustomHost: credentials.allowCustomHost as boolean | undefined });
		} catch (err) {
			throw new NodeOperationError(this.getNode(), (err as Error).message);
		}

		const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(() => r(), ms));

		const api = async (method: string, path: string, body?: object, qs?: Record<string, string>, retries = 1): Promise<any> => {
			const options: any = {
				method,
				url: `${baseUrl}${path}`,
				json: true,
				followRedirect: false,
				followAllRedirects: false,
			};
			if (body) options.body = body;
			if (qs) {
				const params = new URLSearchParams(qs).toString();
				if (params) options.url += '?' + params;
			}
			try {
				return await this.helpers.httpRequestWithAuthentication.call(this, 'checkredirectsApi', options);
			} catch (error: any) {
				const httpStatus = error?.response?.status || error?.statusCode;
				const networkCode = error?.cause?.code || error?.code;
				const isRetryable = (httpStatus && httpStatus >= 500) ||
					['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(networkCode);

				if (isRetryable && retries > 0) {
					await sleep(2000);
					return api(method, path, body, qs, retries - 1);
				}

				const respBody = error?.response?.body;
				const rawApiMsg = typeof respBody === 'string' ? respBody : respBody?.error?.message;
				const apiMessage = sanitizeApiMessage(rawApiMsg) || sanitizeApiMessage(error?.message);
				throw new NodeOperationError(
					this.getNode(),
					mapCheckredirectsApiError(error, { apiMessage }),
				);
			}
		};

		// Authenticated GET for binary endpoints (e.g. CSV download). Returns the
		// raw response buffer. Uses the same baseUrl + credential plumbing as api()
		// AND mirrors api()'s single-retry policy on 5xx / transient network errors.
		const binaryGet = async (path: string, retries = 1): Promise<Buffer> => {
			try {
				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'checkredirectsApi',
					{
						method: 'GET',
						url: `${baseUrl}${path}`,
						encoding: 'arraybuffer',
						returnFullResponse: false,
					},
				);
				return Buffer.isBuffer(response) ? response : Buffer.from(response as any);
			} catch (error: any) {
				const httpStatus = error?.response?.status || error?.statusCode;
				const networkCode = error?.cause?.code || error?.code;
				const isRetryable = (httpStatus && httpStatus >= 500) ||
					['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(networkCode);
				if (isRetryable && retries > 0) {
					await sleep(2000);
					return binaryGet(path, retries - 1);
				}
				const respBody = error?.response?.body;
				const rawApiMsg = typeof respBody === 'string' ? respBody : respBody?.error?.message;
				const apiMessage = sanitizeApiMessage(rawApiMsg) || sanitizeApiMessage(error?.message);
				throw new NodeOperationError(
					this.getNode(),
					mapCheckredirectsApiError(error, { apiMessage }),
				);
			}
		};

		for (let i = 0; i < items.length; i++) {
			// F-015: read resource/operation per item so expression-bound values from
			// $json on items > 0 resolve correctly.
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;

			try {
				// Per-item gate for the multi-item checkAndWait case. Only reached
				// when continueOnFail() is true (otherwise the preflight throw above
				// already aborted execution). Throws inside the per-item try so the
				// catch below converts it to a clean per-item error output.
				if (hasMultiItemCheckAndWait && resource === 'batch' && operation === 'checkAndWait') {
					throw new NodeOperationError(
						this.getNode(),
						'Batch "Check and Wait" cannot run in a multi-item execution (worker would block for hours). Use "Create Batch" + "Get Results" or the Webhook Trigger for multi-item flows.',
					);
				}

				const handlers = RESOURCE_HANDLERS[resource];
				const handler = handlers && handlers[operation];
				if (!handler) {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown operation: ${resource}.${operation}`,
					);
				}

				const ctx: HandlerContext = {
					exec: this,
					api,
					binaryGet,
					sleep,
					pushItem: (json, pairedItem) => returnData.push({ json, pairedItem }),
					pushExecution: (data) => returnData.push(data),
				};

				const ret = await handler(ctx, i);
				if ('result' in ret) {
					const unwrapped = unwrap(ret.result);
					const items_out = this.helpers.returnJsonArray(unwrapped);
					for (const item of items_out) {
						returnData.push({ ...item, pairedItem: i });
					}
				}
				// else: handler used ctx.pushItem(...) directly.

			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: i });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}

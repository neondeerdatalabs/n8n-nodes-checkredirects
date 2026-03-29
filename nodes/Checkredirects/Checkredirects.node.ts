import {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

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
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'checkredirectsApi',
				required: true,
			},
		],
		properties: [
			// Resource selector
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

			// Inspect URL fields
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'https://example.com',
				displayOptions: { show: { resource: ['inspection'], operation: ['inspect', 'compareAgents'] } },
			},
			{
				displayName: 'Preset',
				name: 'presetId',
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
				displayOptions: { show: { resource: ['inspection'], operation: ['inspect'] } },
			},
			{
				displayName: 'Follow Redirects',
				name: 'followRedirects',
				type: 'boolean',
				default: true,
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
				displayName: 'User Agent',
				name: 'userAgent',
				type: 'string',
				default: '',
				placeholder: 'googlebot_desktop or custom string',
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

			// Compare Agents fields
			{
				displayName: 'Pack',
				name: 'pack',
				type: 'options',
				options: [
					{ name: 'Custom (specify agents below)', value: '' },
					{ name: 'SEO Essentials', value: 'seo_essentials' },
					{ name: 'Social Preview', value: 'social_preview' },
					{ name: 'Mobile vs Desktop', value: 'mobile_vs_desktop' },
					{ name: 'AI Crawler Audit', value: 'ai_crawler_audit' },
					{ name: 'Full Coverage', value: 'full_coverage' },
				],
				default: 'seo_essentials',
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
				],
				default: 'checkAndWait',
			},

			// Batch: URLs input (for create and checkAndWait)
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
				name: 'presetId',
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
				displayOptions: { show: { resource: ['batch'], operation: ['create', 'checkAndWait'] } },
			},
			{
				displayName: 'User Agent',
				name: 'batchUserAgent',
				type: 'string',
				default: '',
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

			// Batch: Job ID (for getResults, getProgress)
			{
				displayName: 'Job ID',
				name: 'jobId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['batch'], operation: ['getResults', 'getProgress'] } },
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

			// Batch: Compare
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
					{ name: 'Update', value: 'update', action: 'Update a monitor' },
					{ name: 'Delete', value: 'delete', action: 'Delete a monitor' },
					{ name: 'Pause', value: 'pause', action: 'Pause a monitor' },
					{ name: 'Resume', value: 'resume', action: 'Resume a monitor' },
					{ name: 'Trigger', value: 'trigger', action: 'Trigger a monitor run' },
					{ name: 'Get Runs', value: 'getRuns', action: 'Get monitor run history' },
				],
				default: 'list',
			},

			// Monitor: ID field
			{
				displayName: 'Monitor ID',
				name: 'monitorId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['monitor'], operation: ['get', 'update', 'delete', 'pause', 'resume', 'trigger', 'getRuns'] } },
			},

			// Monitor: Create/Update fields
			{
				displayName: 'Name',
				name: 'monitorName',
				type: 'string',
				required: true,
				default: '',
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
				displayOptions: { show: { resource: ['monitor'], operation: ['create', 'update'] } },
			},
			{
				displayName: 'Auto-Export to Sheets',
				name: 'sheetsAppend',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['monitor'], operation: ['create', 'update'] } },
			},

			// Monitor: Get Runs options
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
				const credentials = await this.getCredentials('checkredirectsApi');
				const baseUrl = credentials.baseUrl as string;
				try {
					const response = await this.helpers.httpRequest({
						method: 'GET',
						url: `${baseUrl}/v1/presets`,
						headers: { Authorization: `Bearer ${credentials.apiKey}` },
					});
					const options = [{ name: '(None)', value: '' }];
					if (response?.data) {
						for (const p of response.data) {
							options.push({ name: p.name, value: p.id });
						}
					}
					return options;
				} catch {
					return [{ name: '(None)', value: '' }];
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const credentials = await this.getCredentials('checkredirectsApi');
		const baseUrl = credentials.baseUrl as string;

		const api = async (method: string, path: string, body?: object, qs?: Record<string, string>, retries = 1): Promise<any> => {
			const options: any = {
				method,
				url: `${baseUrl}${path}`,
				headers: { Authorization: `Bearer ${credentials.apiKey}` },
				json: true,
			};
			if (body) options.body = body;
			if (qs) {
				const params = new URLSearchParams(qs).toString();
				if (params) options.url += '?' + params;
			}
			try {
				return await this.helpers.httpRequest(options);
			} catch (error: any) {
				const status = error?.response?.status || error?.statusCode || error?.cause?.code;

				// Retry on transient 5xx errors (deploy-related 502s, etc.)
				if (status >= 500 && retries > 0) {
					await sleep(2000);
					return api(method, path, body, qs, retries - 1);
				}

				const respBody = error?.response?.body;
				const apiMsg = typeof respBody === 'string' ? respBody : respBody?.error?.message;
				const msg = apiMsg || error?.message || 'API request failed';
				if (status === 401) throw new NodeOperationError(this.getNode(), 'Invalid API key. Create one at Settings > API Keys in checkredirects.io.');
				if (status === 403) throw new NodeOperationError(this.getNode(), msg || 'This feature requires a paid plan. Upgrade at checkredirects.io/settings/billing.');
				if (status === 422) throw new NodeOperationError(this.getNode(), msg);
				if (status === 429) throw new NodeOperationError(this.getNode(), `Monthly check limit exceeded. ${msg}. Upgrade at checkredirects.io/settings/billing.`);
				if (status === 503) throw new NodeOperationError(this.getNode(), 'Service unavailable. Google Sheets may not be connected — check checkredirects.io/settings/integrations.');
				throw new NodeOperationError(this.getNode(), `API error (${status || 'unknown'}): ${msg}`);
			}
		};

		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

		let result: any;

		// ── Inspection ──
		if (resource === 'inspection') {
			if (operation === 'inspect') {
				const body: any = { url: this.getNodeParameter('url', 0) as string };
				const method = this.getNodeParameter('method', 0) as string;
				if (method) body.method = method;
				if (!this.getNodeParameter('followRedirects', 0)) body.follow_redirects = false;
				const max = this.getNodeParameter('maxRedirects', 0) as number;
				if (max !== 10) body.max_redirects = max;
				const ua = this.getNodeParameter('userAgent', 0) as string;
				if (ua) body.user_agent = ua;
				if (this.getNodeParameter('retrieveBody', 0)) body.retrieve_body = true;
				const preset = this.getNodeParameter('presetId', 0) as string;
				if (preset) body.preset_id = preset;
				result = await api('POST', '/v1/inspect', body);

			} else if (operation === 'compareAgents') {
				const body: any = { url: this.getNodeParameter('url', 0) as string };
				const pack = this.getNodeParameter('pack', 0) as string;
				if (pack) {
					body.pack = pack;
				} else {
					const agents = (this.getNodeParameter('userAgents', 0) as string).split(',').map((s) => s.trim()).filter(Boolean);
					body.user_agents = agents;
				}
				result = await api('POST', '/v1/compare-agents', body);

			} else if (operation === 'importSitemap') {
				const sitemapUrl = this.getNodeParameter('sitemapUrl', 0) as string;
				const data = await api('GET', `/v1/sitemap/parse`, undefined, { url: sitemapUrl });
				// Split each URL into a separate item
				const items: INodeExecutionData[] = (data.urls || []).map((url: string) => ({
					json: { url },
				}));
				return [items];
			}
		}

		// ── Batch ──
		if (resource === 'batch') {
			if (operation === 'create' || operation === 'checkAndWait') {
				const urlText = this.getNodeParameter('urls', 0) as string;
				const urls = urlText.split('\n').map((s) => s.trim()).filter(Boolean);
				const body: any = { urls };
				const m = this.getNodeParameter('batchMethod', 0) as string;
				if (m) body.method = m;
				const ua = this.getNodeParameter('batchUserAgent', 0) as string;
				if (ua) body.user_agent = ua;
				if (operation === 'create') {
					const wh = this.getNodeParameter('webhookUrl', 0) as string;
					if (wh) body.webhook_url = wh;
				}
				if (this.getNodeParameter('exportToSheets', 0)) body.export_to_sheets = true;
				const preset = this.getNodeParameter('presetId', 0, '') as string;
				if (preset) body.preset_id = preset;

				const batch = await api('POST', '/v1/batch', body);

			if (operation === 'create') {
				result = batch;
			} else {
				const jobId = batch.job_id;
				const deadline = Date.now() + 5 * 60 * 1000;
				let finalStatus = 'pending';
				while (Date.now() < deadline) {
					await sleep(3000);
					const progress = await api('GET', `/v1/batch/${jobId}/progress`);
					finalStatus = progress.status;
					if (finalStatus === 'completed' || finalStatus === 'failed') break;
				}

				if (finalStatus === 'failed') {
					throw new NodeOperationError(this.getNode(), `Batch job ${jobId} failed. Check the job in checkredirects.io for details.`);
				}
				if (finalStatus !== 'completed') {
					throw new NodeOperationError(
						this.getNode(),
						`Batch job ${jobId} is still ${finalStatus} after 5 minutes. Use "Create Batch" + "Get Results" separately for large jobs.`,
					);
				}

				result = await api('GET', `/v1/batch/${jobId}`);

					// Optional: compare with previous job
					const compareWith = this.getNodeParameter('compareWithJobId', 0, '') as string;
					if (compareWith) {
						result = await api('GET', `/v1/jobs/${jobId}/compare/${compareWith}`);
					}

					// Split results if requested
					if (this.getNodeParameter('splitResults', 0, true) && result.checks) {
						const items: INodeExecutionData[] = result.checks.map((check: any) => ({
							json: check,
						}));
						return [items];
					}
				}

			} else if (operation === 'getResults') {
				const jobId = this.getNodeParameter('jobId', 0) as string;
				const qs: Record<string, string> = {};
				const sort = this.getNodeParameter('sort', 0) as string;
				if (sort && sort !== 'input_order') qs.sort = sort;
				const uc = this.getNodeParameter('urlContains', 0, '') as string;
				if (uc) qs.url_contains = uc;
				const fuc = this.getNodeParameter('finalUrlContains', 0, '') as string;
				if (fuc) qs.final_url_contains = fuc;

				result = await api('GET', `/v1/batch/${jobId}`, undefined, qs);

				if (this.getNodeParameter('splitResults', 0, true) && result.checks) {
					const items: INodeExecutionData[] = result.checks.map((check: any) => ({
						json: check,
					}));
					return [items];
				}

			} else if (operation === 'getProgress') {
				const jobId = this.getNodeParameter('jobId', 0) as string;
				result = await api('GET', `/v1/batch/${jobId}/progress`);

			} else if (operation === 'compare') {
				const jobId = this.getNodeParameter('compareJobId', 0) as string;
				const otherId = this.getNodeParameter('compareOtherJobId', 0) as string;
				const data = await api('GET', `/v1/jobs/${jobId}/compare/${otherId}`);

				const changesOnly = this.getNodeParameter('changesOnly', 0, true);
				let diffs = data.diffs || [];
				if (changesOnly) {
					diffs = diffs.filter((d: any) => d.change_type !== 'unchanged');
				}
				const items: INodeExecutionData[] = diffs.map((d: any) => ({ json: d }));
				return [items];
			}
		}

		// ── Monitor ──
		if (resource === 'monitor') {
			if (operation === 'list') {
				result = await api('GET', '/v1/monitors');
			} else if (operation === 'get') {
				const id = this.getNodeParameter('monitorId', 0) as string;
				result = await api('GET', `/v1/monitors/${id}`);
			} else if (operation === 'create') {
				const urlText = this.getNodeParameter('monitorUrls', 0) as string;
				const body: any = {
					name: this.getNodeParameter('monitorName', 0) as string,
					urls: urlText.split('\n').map((s) => s.trim()).filter(Boolean),
					interval_minutes: this.getNodeParameter('intervalMinutes', 0) as number,
				};
				const wh = this.getNodeParameter('monitorWebhookUrl', 0, '') as string;
				if (wh) body.webhook_url = wh;
				if (this.getNodeParameter('sheetsAppend', 0)) body.sheets_append = true;
				result = await api('POST', '/v1/monitors', body);
			} else if (operation === 'update') {
				const id = this.getNodeParameter('monitorId', 0) as string;
				const urlText = this.getNodeParameter('monitorUrls', 0) as string;
				const body: any = {
					name: this.getNodeParameter('monitorName', 0) as string,
					urls: urlText.split('\n').map((s) => s.trim()).filter(Boolean),
					interval_minutes: this.getNodeParameter('intervalMinutes', 0) as number,
				};
				const wh = this.getNodeParameter('monitorWebhookUrl', 0, '') as string;
				if (wh) body.webhook_url = wh;
				body.sheets_append = this.getNodeParameter('sheetsAppend', 0);
				result = await api('PUT', `/v1/monitors/${id}`, body);
			} else if (operation === 'delete') {
				const id = this.getNodeParameter('monitorId', 0) as string;
				result = await api('DELETE', `/v1/monitors/${id}`);
			} else if (operation === 'pause') {
				const id = this.getNodeParameter('monitorId', 0) as string;
				result = await api('POST', `/v1/monitors/${id}/pause`);
			} else if (operation === 'resume') {
				const id = this.getNodeParameter('monitorId', 0) as string;
				result = await api('POST', `/v1/monitors/${id}/resume`);
			} else if (operation === 'trigger') {
				const id = this.getNodeParameter('monitorId', 0) as string;
				result = await api('POST', `/v1/monitors/${id}/trigger`);
			} else if (operation === 'getRuns') {
				const id = this.getNodeParameter('monitorId', 0) as string;
				const qs: Record<string, string> = {};
				if (this.getNodeParameter('includeChanges', 0, false)) qs.include_changes = 'true';
				result = await api('GET', `/v1/monitors/${id}/runs`, undefined, qs);
			}
		}

		// ── Account ──
		if (resource === 'account') {
			if (operation === 'getUsage') {
				result = await api('GET', '/v1/usage');
			}
		}

		if (!result) {
			throw new NodeOperationError(this.getNode(), `Unknown operation: ${resource}.${operation}`);
		}

		return [this.helpers.returnJsonArray(result)];
	}
}

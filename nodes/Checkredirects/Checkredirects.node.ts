import {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
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
				displayName: 'User Agent',
				name: 'userAgent',
				type: 'string',
				default: '',
				placeholder: 'googlebot_desktop or custom string',
				description: 'A preset key (e.g. googlebot_desktop) or custom UA string',
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
					{ name: 'Update', value: 'update', description: 'Replace all monitor settings (all fields required)', action: 'Update a monitor' },
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
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'checkredirectsApi',
						{
							method: 'GET',
							url: `${(await this.getCredentials('checkredirectsApi')).baseUrl}/v1/presets`,
							json: true,
						},
					);
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
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const credentials = await this.getCredentials('checkredirectsApi');
		const baseUrl = credentials.baseUrl as string;

		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

		const api = async (method: string, path: string, body?: object, qs?: Record<string, string>, retries = 1): Promise<any> => {
			const options: any = {
				method,
				url: `${baseUrl}${path}`,
				json: true,
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
				const apiMsg = typeof respBody === 'string' ? respBody : respBody?.error?.message;
				const msg = apiMsg || error?.message || 'API request failed';
				if (httpStatus === 401) throw new NodeOperationError(this.getNode(), 'Invalid API key. Create one at Settings > API Keys in checkredirects.io.');
				if (httpStatus === 403) throw new NodeOperationError(this.getNode(), msg || 'This feature requires a paid plan. Upgrade at checkredirects.io/settings/billing.');
				if (httpStatus === 422) throw new NodeOperationError(this.getNode(), msg);
				if (httpStatus === 429) throw new NodeOperationError(this.getNode(), `Monthly check limit exceeded. ${msg}. Upgrade at checkredirects.io/settings/billing.`);
				if (httpStatus === 503) throw new NodeOperationError(this.getNode(), 'Service unavailable. Google Sheets may not be connected — check checkredirects.io/settings/integrations.');
				throw new NodeOperationError(this.getNode(), `API error (${httpStatus || networkCode || 'unknown'}): ${msg}`);
			}
		};

		const unwrap = (result: any): any => {
			if (Array.isArray(result)) return result;
			if (result?.data && Array.isArray(result.data)) return result.data;
			if (result?.checks && Array.isArray(result.checks)) return result.checks;
			return result;
		};

		for (let i = 0; i < items.length; i++) {
			try {
				let result: any;

				// ── Inspection ──
				if (resource === 'inspection') {
					if (operation === 'inspect') {
						const body: any = { url: this.getNodeParameter('url', i) as string };
						const method = this.getNodeParameter('method', i) as string;
						if (method) body.method = method;
						if (!this.getNodeParameter('followRedirects', i)) body.follow_redirects = false;
						const max = this.getNodeParameter('maxRedirects', i) as number;
						if (max !== 10) body.max_redirects = max;
						const ua = this.getNodeParameter('userAgent', i) as string;
						if (ua) body.user_agent = ua;
						if (this.getNodeParameter('retrieveBody', i)) body.retrieve_body = true;
						const preset = this.getNodeParameter('inspectPresetId', i) as string;
						if (preset) body.preset_id = preset;
						result = await api('POST', '/v1/inspect', body);

					} else if (operation === 'compareAgents') {
						const body: any = { url: this.getNodeParameter('url', i) as string };
						const pack = this.getNodeParameter('pack', i) as string;
						if (pack) {
							body.pack = pack;
						} else {
							const agents = (this.getNodeParameter('userAgents', i) as string).split(',').map((s) => s.trim()).filter(Boolean);
							body.user_agents = agents;
						}
						result = await api('POST', '/v1/compare-agents', body);

					} else if (operation === 'importSitemap') {
						const sitemapUrl = this.getNodeParameter('sitemapUrl', i) as string;
						const data = await api('GET', '/v1/sitemap/parse', undefined, { url: sitemapUrl });
						for (const url of (data.urls || [])) {
							returnData.push({ json: { url }, pairedItem: i });
						}
						continue;
					}
				}

				// ── Batch ──
				if (resource === 'batch') {
					if (operation === 'create' || operation === 'checkAndWait') {
						const urlText = this.getNodeParameter('urls', i) as string;
						const urls = urlText.split('\n').map((s) => s.trim()).filter(Boolean);
						const body: any = { urls };
						const m = this.getNodeParameter('batchMethod', i) as string;
						if (m) body.method = m;
						const ua = this.getNodeParameter('batchUserAgent', i) as string;
						if (ua) body.user_agent = ua;
						if (operation === 'create') {
							const wh = this.getNodeParameter('webhookUrl', i) as string;
							if (wh) body.webhook_url = wh;
						}
						if (this.getNodeParameter('exportToSheets', i)) body.export_to_sheets = true;
						const preset = this.getNodeParameter('batchPresetId', i, '') as string;
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

							const compareWith = this.getNodeParameter('compareWithJobId', i, '') as string;
							if (compareWith) {
								result = await api('GET', `/v1/jobs/${jobId}/compare/${compareWith}`);
							}

							if (this.getNodeParameter('splitResults', i, true) && result.checks) {
								for (const check of result.checks) {
									returnData.push({ json: check, pairedItem: i });
								}
								continue;
							}
						}

					} else if (operation === 'getResults') {
						const jobId = this.getNodeParameter('jobId', i) as string;
						const qs: Record<string, string> = {};
						const sort = this.getNodeParameter('sort', i) as string;
						if (sort && sort !== 'input_order') qs.sort = sort;
						const uc = this.getNodeParameter('urlContains', i, '') as string;
						if (uc) qs.url_contains = uc;
						const fuc = this.getNodeParameter('finalUrlContains', i, '') as string;
						if (fuc) qs.final_url_contains = fuc;

						result = await api('GET', `/v1/batch/${jobId}`, undefined, qs);

						if (this.getNodeParameter('splitResults', i, true) && result.checks) {
							for (const check of result.checks) {
								returnData.push({ json: check, pairedItem: i });
							}
							continue;
						}

					} else if (operation === 'getProgress') {
						const jobId = this.getNodeParameter('jobId', i) as string;
						result = await api('GET', `/v1/batch/${jobId}/progress`);

					} else if (operation === 'compare') {
						const jobId = this.getNodeParameter('compareJobId', i) as string;
						const otherId = this.getNodeParameter('compareOtherJobId', i) as string;
						const data = await api('GET', `/v1/jobs/${jobId}/compare/${otherId}`);

						const changesOnly = this.getNodeParameter('changesOnly', i, true);
						let diffs = data.diffs || [];
						if (changesOnly) {
							diffs = diffs.filter((d: any) => d.change_type !== 'unchanged');
						}
						for (const d of diffs) {
							returnData.push({ json: d, pairedItem: i });
						}
						continue;
					}
				}

				// ── Monitor ──
				if (resource === 'monitor') {
					if (operation === 'list') {
						result = await api('GET', '/v1/monitors');
					} else if (operation === 'get') {
						const id = this.getNodeParameter('monitorId', i) as string;
						result = await api('GET', `/v1/monitors/${id}`);
					} else if (operation === 'create') {
						const urlText = this.getNodeParameter('monitorUrls', i) as string;
						const body: any = {
							name: this.getNodeParameter('monitorName', i) as string,
							urls: urlText.split('\n').map((s) => s.trim()).filter(Boolean),
							interval_minutes: this.getNodeParameter('intervalMinutes', i) as number,
						};
						const wh = this.getNodeParameter('monitorWebhookUrl', i, '') as string;
						if (wh) body.webhook_url = wh;
						if (this.getNodeParameter('sheetsAppend', i)) body.sheets_append = true;
						result = await api('POST', '/v1/monitors', body);
					} else if (operation === 'update') {
						const id = this.getNodeParameter('monitorId', i) as string;
						const urlText = this.getNodeParameter('monitorUrls', i) as string;
						const body: any = {
							name: this.getNodeParameter('monitorName', i) as string,
							urls: urlText.split('\n').map((s) => s.trim()).filter(Boolean),
							interval_minutes: this.getNodeParameter('intervalMinutes', i) as number,
						};
						const wh = this.getNodeParameter('monitorWebhookUrl', i, '') as string;
						if (wh) body.webhook_url = wh;
						body.sheets_append = this.getNodeParameter('sheetsAppend', i);
						result = await api('PUT', `/v1/monitors/${id}`, body);
					} else if (operation === 'delete') {
						const id = this.getNodeParameter('monitorId', i) as string;
						result = await api('DELETE', `/v1/monitors/${id}`);
					} else if (operation === 'pause') {
						const id = this.getNodeParameter('monitorId', i) as string;
						result = await api('POST', `/v1/monitors/${id}/pause`);
					} else if (operation === 'resume') {
						const id = this.getNodeParameter('monitorId', i) as string;
						result = await api('POST', `/v1/monitors/${id}/resume`);
					} else if (operation === 'trigger') {
						const id = this.getNodeParameter('monitorId', i) as string;
						result = await api('POST', `/v1/monitors/${id}/trigger`);
					} else if (operation === 'getRuns') {
						const id = this.getNodeParameter('monitorId', i) as string;
						const qs: Record<string, string> = {};
						if (this.getNodeParameter('includeChanges', i, false)) qs.include_changes = 'true';
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

				const unwrapped = unwrap(result);
				const items_out = this.helpers.returnJsonArray(unwrapped);
				for (const item of items_out) {
					returnData.push({ ...item, pairedItem: i });
				}

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

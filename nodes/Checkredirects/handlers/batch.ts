import { NodeOperationError } from 'n8n-workflow';
import { applyRequestOptions, encId, parseBulkUrls, validateOptionalUrl } from '../helpers';
import { ResourceHandlers } from './types';

// Shared body builder for create + checkAndWait: same parameter set, same
// validation rules. `includeWebhook` controls whether `webhookUrl` is read
// (only `create` exposes it in the UI).
function buildBatchBody(ctx: { exec: any }, i: number, includeWebhook: boolean): any {
	const urls = parseBulkUrls(ctx.exec.getNodeParameter('urls', i), 'URLs');
	const body: any = { urls };
	const m = ctx.exec.getNodeParameter('batchMethod', i) as string;
	if (m) body.method = m;
	const ua = ctx.exec.getNodeParameter('batchUserAgent', i) as string;
	if (ua) body.user_agent = ua;
	if (includeWebhook) {
		const wh = validateOptionalUrl(ctx.exec.getNodeParameter('webhookUrl', i), 'webhook URL');
		if (wh) body.webhook_url = wh;
	}
	if (ctx.exec.getNodeParameter('exportToSheets', i)) body.export_to_sheets = true;
	const preset = ctx.exec.getNodeParameter('batchPresetId', i, '') as string;
	if (preset) body.preset_id = preset;
	applyRequestOptions(body, ctx.exec.getNodeParameter('batchAdditional', i, {}));
	return body;
}

export const batchHandlers: ResourceHandlers = {
	async create(ctx, i) {
		const body = buildBatchBody(ctx, i, /* includeWebhook */ true);
		return { result: await ctx.api('POST', '/v1/batch', body) };
	},

	async checkAndWait(ctx, i) {
		const body = buildBatchBody(ctx, i, /* includeWebhook */ false);
		const batch = await ctx.api('POST', '/v1/batch', body);

		if (typeof batch.job_id !== 'string' || batch.job_id.length === 0) {
			throw new NodeOperationError(ctx.exec.getNode(), 'Batch creation returned an unexpected response shape (missing job_id).');
		}
		const jobId = batch.job_id;
		const deadline = Date.now() + 5 * 60 * 1000;
		let finalStatus = 'pending';
		while (Date.now() < deadline) {
			await ctx.sleep(3000);
			const progress = await ctx.api('GET', `/v1/batch/${encId(jobId, 'job ID')}/progress`);
			if (typeof progress.status !== 'string') {
				throw new NodeOperationError(ctx.exec.getNode(), 'Progress check returned an unexpected response shape (missing status).');
			}
			finalStatus = progress.status;
			if (finalStatus === 'completed' || finalStatus === 'failed') break;
		}

		if (finalStatus === 'failed') {
			throw new NodeOperationError(ctx.exec.getNode(), `Batch job ${jobId} failed. Check the job in checkredirects.io for details.`);
		}
		if (finalStatus !== 'completed') {
			throw new NodeOperationError(
				ctx.exec.getNode(),
				`Batch job ${jobId} is still ${finalStatus} after 5 minutes. Use "Create Batch" + "Get Results" separately for large jobs.`,
			);
		}

		let result = await ctx.api('GET', `/v1/batch/${encId(jobId, 'job ID')}`);

		const compareWith = ctx.exec.getNodeParameter('compareWithJobId', i, '') as string;
		if (compareWith) {
			result = await ctx.api('GET', `/v1/jobs/${encId(jobId, 'job ID')}/compare/${encId(compareWith, 'compare job ID')}`);
			if (ctx.exec.getNodeParameter('splitResults', i, true) && Array.isArray(result.diffs)) {
				for (const diff of result.diffs) {
					ctx.pushItem(diff, i);
				}
				return { handled: true };
			}
		} else if (ctx.exec.getNodeParameter('splitResults', i, true) && Array.isArray(result.checks)) {
			for (const check of result.checks) {
				ctx.pushItem(check, i);
			}
			return { handled: true };
		}

		return { result };
	},

	async getResults(ctx, i) {
		const jobId = ctx.exec.getNodeParameter('jobId', i) as string;
		const qs: Record<string, string> = {};
		const sort = ctx.exec.getNodeParameter('sort', i) as string;
		if (sort && sort !== 'input_order') qs.sort = sort;
		const uc = ctx.exec.getNodeParameter('urlContains', i, '') as string;
		if (uc) qs.url_contains = uc;
		const fuc = ctx.exec.getNodeParameter('finalUrlContains', i, '') as string;
		if (fuc) qs.final_url_contains = fuc;
		const page = ctx.exec.getNodeParameter('page', i, 1) as number;
		const perPage = Math.min(Math.max(ctx.exec.getNodeParameter('perPage', i, 100) as number, 1), 500);
		if (page > 1) qs.page = String(page);
		if (perPage !== 100) qs.per_page = String(perPage);

		const result = await ctx.api('GET', `/v1/batch/${encId(jobId, 'job ID')}`, undefined, qs);

		if (ctx.exec.getNodeParameter('splitResults', i, true) && Array.isArray(result.checks)) {
			for (const check of result.checks) {
				ctx.pushItem(check, i);
			}
			return { handled: true };
		}
		return { result };
	},

	async getProgress(ctx, i) {
		const jobId = ctx.exec.getNodeParameter('jobId', i) as string;
		return { result: await ctx.api('GET', `/v1/batch/${encId(jobId, 'job ID')}/progress`) };
	},

	async compare(ctx, i) {
		const jobId = ctx.exec.getNodeParameter('compareJobId', i) as string;
		const otherId = ctx.exec.getNodeParameter('compareOtherJobId', i) as string;
		const data = await ctx.api('GET', `/v1/jobs/${encId(jobId, 'job ID')}/compare/${encId(otherId, 'other job ID')}`);

		const changesOnly = ctx.exec.getNodeParameter('changesOnly', i, true) as boolean;
		let diffs = Array.isArray(data.diffs) ? data.diffs : [];
		if (changesOnly) {
			diffs = diffs.filter((d: any) => d.change !== 'unchanged');
		}
		for (const d of diffs) {
			ctx.pushItem(d, i);
		}
		return { handled: true };
	},

	async exportCsv(ctx, i) {
		const jobId = ctx.exec.getNodeParameter('jobId', i) as string;
		const buffer = await ctx.binaryGet(`/v1/batch/${encId(jobId, 'job ID')}/export/csv`);
		const fileName = `batch-${jobId.slice(0, 8)}.csv`;
		const binaryData = await ctx.exec.helpers.prepareBinaryData(buffer, fileName, 'text/csv');
		ctx.pushExecution({
			json: { jobId, fileName, sizeBytes: buffer.length },
			binary: { data: binaryData },
			pairedItem: i,
		});
		return { handled: true };
	},

	async exportToSheets(ctx, i) {
		const jobId = ctx.exec.getNodeParameter('jobId', i) as string;
		const mode = ctx.exec.getNodeParameter('sheetsExportMode', i, 'default') as string;
		const body: any = { mode };
		if (mode === 'specific') {
			const spreadsheetId = (ctx.exec.getNodeParameter('sheetsSpreadsheetId', i, '') as string).trim();
			if (spreadsheetId.length === 0) {
				throw new NodeOperationError(ctx.exec.getNode(), 'Spreadsheet ID is required when Spreadsheet Mode is "Specific".');
			}
			body.spreadsheet_id = spreadsheetId;
		}
		const driveFolderId = (ctx.exec.getNodeParameter('sheetsDriveFolderId', i, '') as string).trim();
		if (driveFolderId.length > 0) body.drive_folder_id = driveFolderId;

		return { result: await ctx.api('POST', `/v1/batch/${encId(jobId, 'job ID')}/export/sheets`, body) };
	},
};

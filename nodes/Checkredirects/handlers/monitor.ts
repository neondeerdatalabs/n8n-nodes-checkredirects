import { NodeOperationError } from 'n8n-workflow';
import { applyRequestOptions, encId, parseBulkUrls, validateOptionalUrl } from '../helpers';
import { ResourceHandlers } from './types';

export const monitorHandlers: ResourceHandlers = {
	async list(ctx, _i) {
		return { result: await ctx.api('GET', '/v1/monitors') };
	},

	async get(ctx, i) {
		const id = ctx.exec.getNodeParameter('monitorId', i) as string;
		return { result: await ctx.api('GET', `/v1/monitors/${encId(id, 'monitor ID')}`) };
	},

	async create(ctx, i) {
		const body: any = {
			name: ctx.exec.getNodeParameter('monitorName', i) as string,
			urls: parseBulkUrls(ctx.exec.getNodeParameter('monitorUrls', i), 'monitor URLs'),
			interval_minutes: ctx.exec.getNodeParameter('intervalMinutes', i) as number,
		};
		const wh = validateOptionalUrl(ctx.exec.getNodeParameter('monitorWebhookUrl', i, ''), 'monitor webhook URL');
		if (wh) body.webhook_url = wh;
		if (ctx.exec.getNodeParameter('sheetsAppend', i)) body.sheets_append = true;
		applyRequestOptions(body, ctx.exec.getNodeParameter('monitorAdditional', i, {}), { allowBasicAuth: false });
		return { result: await ctx.api('POST', '/v1/monitors', body) };
	},

	async update(ctx, i) {
		const id = ctx.exec.getNodeParameter('monitorId', i) as string;
		// PUT is replacement-style AND the API rejects unknown fields. We can't
		// spread the GET response directly (it carries server-owned fields like
		// id/created_at/status that would cause a 400). Instead: GET, then build
		// a fresh PUT body containing only the fields the request schema accepts,
		// lifting per-request settings from response.request_config back to the
		// top level where PUT expects them.
		const existing: any = await ctx.api('GET', `/v1/monitors/${encId(id, 'monitor ID')}`);
		const body: any = {
			name: ctx.exec.getNodeParameter('monitorName', i) as string,
			urls: parseBulkUrls(ctx.exec.getNodeParameter('monitorUrls', i), 'monitor URLs'),
			interval_minutes: ctx.exec.getNodeParameter('intervalMinutes', i) as number,
		};

		// Preserve top-level optional fields from the existing record.
		if (existing && existing.preset_id) body.preset_id = existing.preset_id;
		if (existing && typeof existing.webhook_url === 'string' && existing.webhook_url.length > 0) {
			body.webhook_url = existing.webhook_url;
		}
		if (existing && existing.sheets_append) body.sheets_append = true;

		// Lift request-config fields back to the top level for PUT. These are
		// the only nested keys the monitorRequest schema knows about; everything
		// else in request_config is operator-only and rejected by the API.
		const rc = existing && existing.request_config && typeof existing.request_config === 'object'
			? existing.request_config
			: {};
		const liftKeys = ['method', 'follow_redirects', 'max_redirects', 'user_agent', 'user_agents', 'pack', 'headers', 'cookies'];
		for (const k of liftKeys) {
			if (rc[k] !== undefined && rc[k] !== null && rc[k] !== '') {
				body[k] = rc[k];
			}
		}

		// User overrides — explicit Clear toggles take precedence over the preserved
		// values so users can actually unset webhook_url / sheets_append via update.
		const clearWh = ctx.exec.getNodeParameter('clearWebhookUrl', i, false) as boolean;
		const userWh = validateOptionalUrl(ctx.exec.getNodeParameter('monitorWebhookUrl', i, ''), 'monitor webhook URL');
		if (clearWh) {
			body.webhook_url = '';
		} else if (userWh) {
			body.webhook_url = userWh;
		}
		const clearSa = ctx.exec.getNodeParameter('clearSheetsAppend', i, false) as boolean;
		if (clearSa) {
			body.sheets_append = false;
		} else if (ctx.exec.getNodeParameter('sheetsAppend', i)) {
			body.sheets_append = true;
		}
		// Explicit clear toggles for the lifted request_config values that
		// applyRequestOptions wouldn't otherwise touch when empty. Without
		// these, a user has no way to REMOVE headers/cookies on update once
		// they were set on create.
		const clearHeaders = ctx.exec.getNodeParameter('clearHeaders', i, false) as boolean;
		const clearCookies = ctx.exec.getNodeParameter('clearCookies', i, false) as boolean;
		if (clearHeaders) body.headers = {};
		if (clearCookies) body.cookies = '';
		// Additional Request Options OVERRIDE the lifted request_config values
		// for any field the user provided (so a user can change headers/cookies
		// without losing the rest of the request_config). Runs AFTER the
		// clear toggles so a user supplying new headers/cookies plus a clear
		// toggle gets the new values (the clear toggle is a no-op in that case).
		applyRequestOptions(body, ctx.exec.getNodeParameter('monitorAdditional', i, {}), { allowBasicAuth: false });

		return { result: await ctx.api('PUT', `/v1/monitors/${encId(id, 'monitor ID')}`, body) };
	},

	async delete(ctx, i) {
		const id = ctx.exec.getNodeParameter('monitorId', i) as string;
		return { result: await ctx.api('DELETE', `/v1/monitors/${encId(id, 'monitor ID')}`) };
	},

	async pause(ctx, i) {
		const id = ctx.exec.getNodeParameter('monitorId', i) as string;
		return { result: await ctx.api('POST', `/v1/monitors/${encId(id, 'monitor ID')}/pause`) };
	},

	async resume(ctx, i) {
		const id = ctx.exec.getNodeParameter('monitorId', i) as string;
		return { result: await ctx.api('POST', `/v1/monitors/${encId(id, 'monitor ID')}/resume`) };
	},

	async trigger(ctx, i) {
		const id = ctx.exec.getNodeParameter('monitorId', i) as string;
		return { result: await ctx.api('POST', `/v1/monitors/${encId(id, 'monitor ID')}/trigger`) };
	},

	async getRuns(ctx, i) {
		const id = ctx.exec.getNodeParameter('monitorId', i) as string;
		const qs: Record<string, string> = {};
		if (ctx.exec.getNodeParameter('includeChanges', i, false)) qs.include_changes = 'true';
		return { result: await ctx.api('GET', `/v1/monitors/${encId(id, 'monitor ID')}/runs`, undefined, qs) };
	},
};

// Silence unused-import warning if the file is read but no operation throws.
void NodeOperationError;

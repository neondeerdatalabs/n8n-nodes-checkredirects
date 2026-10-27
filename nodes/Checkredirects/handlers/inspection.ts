import { applyRequestOptions, assertHttpUrl } from '../helpers';
import { ResourceHandlers } from './types';

// Wrap the raw user input from getNodeParameter through assertHttpUrl. Mirrors
// the validation that bulk URL paths (parseBulkUrls/validateOptionalUrl) already
// do — single-URL inspect paths were the inconsistency.
function requireHttpUrl(raw: unknown, kind: string): string {
	if (typeof raw !== 'string') throw new Error(`${kind} must be a string.`);
	const trimmed = raw.trim();
	if (trimmed.length === 0) throw new Error(`${kind} is required.`);
	assertHttpUrl(trimmed, kind);
	return trimmed;
}

export const inspectionHandlers: ResourceHandlers = {
	async inspect(ctx, i) {
		const url = requireHttpUrl(ctx.exec.getNodeParameter('url', i), 'URL');
		const body: any = { url };
		const method = ctx.exec.getNodeParameter('method', i) as string;
		if (method) body.method = method;
		if (!ctx.exec.getNodeParameter('followRedirects', i)) body.follow_redirects = false;
		const max = ctx.exec.getNodeParameter('maxRedirects', i) as number;
		if (max !== 10) body.max_redirects = max;
		// Preset selector wins over custom text when set. Both are sent in the
		// same `user_agent` field — the API treats unknown keys as literal UA
		// strings (see useragents.ResolveKey in the server).
		const uaKey = ctx.exec.getNodeParameter('userAgentKey', i, '') as string;
		const uaCustom = ctx.exec.getNodeParameter('userAgent', i, '') as string;
		const ua = uaKey || uaCustom;
		if (ua) body.user_agent = ua;
		if (ctx.exec.getNodeParameter('retrieveBody', i)) body.retrieve_body = true;
		const preset = ctx.exec.getNodeParameter('inspectPresetId', i) as string;
		if (preset) body.preset_id = preset;
		applyRequestOptions(body, ctx.exec.getNodeParameter('inspectAdditional', i, {}));
		return { result: await ctx.api('POST', '/v1/inspect', body) };
	},

	async compareAgents(ctx, i) {
		const url = requireHttpUrl(ctx.exec.getNodeParameter('url', i), 'URL');
		const body: any = { url };
		const pack = ctx.exec.getNodeParameter('pack', i) as string;
		if (pack) {
			body.pack = pack;
		} else {
			const agents = (ctx.exec.getNodeParameter('userAgents', i) as string)
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			body.user_agents = agents;
		}
		return { result: await ctx.api('POST', '/v1/compare-agents', body) };
	},

	async importSitemap(ctx, i) {
		const sitemapUrl = requireHttpUrl(ctx.exec.getNodeParameter('sitemapUrl', i), 'Sitemap URL');
		// Cap the emitted items. Sitemaps can legitimately have 50k+ URLs per
		// sitemap.org standard — fanning all of them out into n8n workflow data
		// can flood downstream nodes and exhaust worker memory. UI-clamped to
		// [1, 100000]; runtime clamp here is defense-in-depth (handles string
		// inputs from n8n expressions correctly).
		const rawCap = ctx.exec.getNodeParameter('sitemapMaxUrls', i, 5000);
		const parsedCap = Number(rawCap);
		const maxUrls = Math.min(Math.max(Number.isFinite(parsedCap) ? parsedCap : 5000, 1), 100000);
		const data = await ctx.api('GET', '/v1/sitemap/parse', undefined, { url: sitemapUrl });
		const urls = Array.isArray(data.urls) ? data.urls : [];
		const emit = urls.slice(0, maxUrls);
		// Every emitted item is URL-shaped to preserve the operation's output
		// contract (downstream nodes can rely on $json.url everywhere). When
		// truncation occurs, attach the same metadata to EVERY item via _meta
		// so downstream nodes can detect it via $json._meta?.truncated without
		// breaking on a non-URL marker item.
		const truncated = urls.length > maxUrls;
		const meta = truncated
			? { truncated: true, total: urls.length, emitted: emit.length, cap: maxUrls }
			: undefined;
		for (const url of emit) {
			ctx.pushItem(meta ? { url, _meta: meta } : { url }, i);
		}
		return { handled: true };
	},
};

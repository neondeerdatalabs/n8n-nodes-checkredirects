import {
	IHookFunctions,
	IWebhookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
	NodeConnectionTypes,
} from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'crypto';
import { WEBHOOK_EVENTS, KNOWN_EVENT_VALUES, eventOptions } from './webhookEvents';

export class CheckredirectsTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Checkredirects.io Trigger',
		name: 'checkredirectsTrigger',
		icon: 'file:checkredirects.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts a workflow when a batch completes or a monitor detects changes. At-least-once delivery: senders / proxies / n8n retry may redeliver an identical signed POST. Downstream actions must be idempotent or maintain their own dedup (e.g., key by `job_id`).',
		defaults: {
			name: 'Checkredirects.io Trigger',
		},
		inputs: [],
		outputs: [{ type: NodeConnectionTypes.Main }],
		credentials: [
			{
				name: 'checkredirectsApi',
				required: false,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				options: eventOptions(),
				default: 'monitor.change_detected',
				description: 'Which event should trigger this workflow',
			},
			{
				displayName: 'Verify Signature',
				name: 'verifySignature',
				type: 'boolean',
				default: true,
				description: 'Whether to verify the X-Signature HMAC header using the webhook secret from your Checkredirects.io settings',
			},
			{
				displayName: 'Webhook Secret',
				name: 'webhookSecret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				displayOptions: { show: { verifySignature: [true] } },
				description: 'The webhook signing secret from your Checkredirects.io Settings page. Required when signature verification is enabled. Note: verification requires the n8n webhook endpoint to expose the raw request body. If your n8n setup runs behind a proxy or body parser that strips raw bytes, signed deliveries will fail closed (silently dropped). Send one test event before relying on this trigger.',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookNotice',
				type: 'notice',
				default: '',
				description: 'Copy the webhook URL shown above and paste it as the webhook_url when creating batches or monitors (via the API, UI, or another n8n node). The API will POST to this URL when the event occurs. Enable "Verify Signature" above and provide your webhook secret to cryptographically verify payloads.',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const body = this.getBodyData() as any;
		const event = this.getNodeParameter('event') as string;
		// Default MUST match the UI default (true) — a missing parameter on hand-
		// authored / imported workflows would otherwise fail open (silently bypass
		// HMAC verification). Only an explicit saved `false` disables verification.
		const verifySignature = this.getNodeParameter('verifySignature', true) as boolean;

		if (verifySignature) {
			const webhookSecret = this.getNodeParameter('webhookSecret', '') as string;
			if (!webhookSecret) {
				return { workflowData: [] };
			}

			// X-Signature must be a string. Duplicate headers come through as an
			// array, and a misbehaving proxy could inject anything — guard before
			// Buffer.from to keep the fail-closed silent path (R3) intact.
			const rawSignature = req.headers['x-signature'];
			if (typeof rawSignature !== 'string' || rawSignature.length === 0 || rawSignature.indexOf(',') !== -1) {
				return { workflowData: [] };
			}
			const signature = rawSignature;

			// The API signs the byte-exact POST body. If rawBody isn't exposed by
			// the n8n deployment (proxy/body-parser config), we cannot reconstruct
			// the same bytes — fail closed rather than synthesize via JSON.stringify
			// (key reordering, whitespace, numeric formatting all change the hash).
			let rawBody: string;
			if (typeof req.rawBody === 'string') {
				rawBody = req.rawBody;
			} else if (req.rawBody instanceof Buffer) {
				rawBody = req.rawBody.toString('utf8');
			} else {
				return { workflowData: [] };
			}

			const expected = 'sha256=' + createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

			const sigBuf = Buffer.from(signature, 'utf8');
			const expBuf = Buffer.from(expected, 'utf8');
			if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
				return { workflowData: [] };
			}
		}

		const incomingEvent = body.event as string | undefined;

		if (!incomingEvent || !KNOWN_EVENT_VALUES.has(incomingEvent)) {
			return { workflowData: [] };
		}

		// Dispatch through the WEBHOOK_EVENTS single source of truth.
		const selected = WEBHOOK_EVENTS.find((e) => e.value === event);
		if (!selected || !selected.matches(incomingEvent, body)) {
			return { workflowData: [] };
		}

		return {
			workflowData: [
				this.helpers.returnJsonArray(body),
			],
		};
	}
}

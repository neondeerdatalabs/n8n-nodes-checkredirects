import {
	IHookFunctions,
	IWebhookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
	NodeConnectionTypes,
} from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'crypto';

const KNOWN_EVENTS = new Set(['batch.completed', 'monitor.completed', 'monitor.change_detected']);

export class CheckredirectsTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Checkredirects.io Trigger',
		name: 'checkredirectsTrigger',
		icon: 'file:checkredirects.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts a workflow when a batch completes or a monitor detects changes',
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
				options: [
					{
						name: 'Batch Completed',
						value: 'batch.completed',
						description: 'Fires when any batch job finishes',
					},
					{
						name: 'Monitor Completed',
						value: 'monitor.completed',
						description: 'Fires when a monitor run finishes',
					},
					{
						name: 'Monitor Change Detected',
						value: 'monitor.change_detected',
						description: 'Fires only when a monitor run detects changes vs the previous run',
					},
				],
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
				description: 'The webhook signing secret from your Checkredirects.io Settings page. Required when signature verification is enabled.',
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
		const verifySignature = this.getNodeParameter('verifySignature', false) as boolean;

		if (verifySignature) {
			const webhookSecret = this.getNodeParameter('webhookSecret', '') as string;
			if (!webhookSecret) {
				return { workflowData: [] };
			}

			const signature = req.headers['x-signature'] as string | undefined;
			if (!signature) {
				return { workflowData: [] };
			}

			const rawBody = typeof req.rawBody === 'string'
				? req.rawBody
				: (req.rawBody instanceof Buffer ? req.rawBody.toString('utf8') : JSON.stringify(body));
			const expected = 'sha256=' + createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

			const sigBuf = Buffer.from(signature, 'utf8');
			const expBuf = Buffer.from(expected, 'utf8');
			if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
				return { workflowData: [] };
			}
		}

		const incomingEvent = body.event as string | undefined;

		if (!incomingEvent || !KNOWN_EVENTS.has(incomingEvent)) {
			return { workflowData: [] };
		}

		if (event === 'monitor.change_detected') {
			if (incomingEvent !== 'monitor.completed' || !body.has_changes) {
				return { workflowData: [] };
			}
		} else if (event === 'monitor.completed') {
			if (incomingEvent !== 'monitor.completed') {
				return { workflowData: [] };
			}
		} else if (event === 'batch.completed') {
			if (incomingEvent !== 'batch.completed') {
				return { workflowData: [] };
			}
		}

		return {
			workflowData: [
				this.helpers.returnJsonArray(body),
			],
		};
	}
}

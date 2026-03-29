import {
	IHookFunctions,
	IWebhookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
} from 'n8n-workflow';

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
		outputs: ['main'],
		credentials: [
			{
				name: 'checkredirectsApi',
				required: true,
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
				displayName: 'Webhook URL',
				name: 'webhookNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { event: ['batch.completed', 'monitor.completed', 'monitor.change_detected'] } },
				// eslint-disable-next-line
				description: 'Copy the webhook URL shown above and paste it as the webhook_url when creating batches or monitors (via the API, UI, or another n8n node). The API will POST to this URL when the event occurs.',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				// Webhooks are registered by the user when creating batches/monitors.
				// We just need the n8n webhook endpoint to exist.
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				// Nothing to register server-side — the user pastes the webhook URL
				// into their batch/monitor configuration.
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				// Nothing to clean up.
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as any;
		const event = this.getNodeParameter('event') as string;

		// Filter by event type.
		if (event === 'monitor.change_detected') {
			// Only fire if the webhook payload indicates changes.
			if (body.event !== 'monitor.completed' || !body.has_changes) {
				return { noWebhookResponse: true };
			}
		} else if (event === 'monitor.completed') {
			if (body.event !== 'monitor.completed') {
				return { noWebhookResponse: true };
			}
		} else if (event === 'batch.completed') {
			if (body.event !== 'batch.completed') {
				return { noWebhookResponse: true };
			}
		}

		return {
			workflowData: [
				this.helpers.returnJsonArray(body),
			],
		};
	}
}

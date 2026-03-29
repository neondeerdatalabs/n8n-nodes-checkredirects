import {
	IPollFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';

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
		const baseUrl = credentials.baseUrl as string;
		const monitorId = this.getNodeParameter('monitorId') as string;
		const includeChanges = this.getNodeParameter('includeChanges') as boolean;

		let url = `${baseUrl}/v1/monitors/${monitorId}/runs`;
		if (includeChanges) url += '?include_changes=true';

		let runs: any[];
		try {
			const response = await this.helpers.httpRequestWithAuthentication.call(
				this,
				'checkredirectsApi',
				{ method: 'GET', url, json: true },
			);
			runs = response.data || [];
		} catch (error: any) {
			const status = error?.response?.status || error?.statusCode;
			if (status === 401) {
				throw new NodeOperationError(this.getNode(), 'Invalid API key. Check your Checkredirects.io credentials.');
			}
			if (status === 404) {
				throw new NodeOperationError(this.getNode(), `Monitor "${monitorId}" not found. Verify the Monitor ID.`);
			}
			throw new NodeOperationError(this.getNode(), `Failed to fetch monitor runs: ${error.message}`);
		}

		if (runs.length === 0) return null;

		runs.sort((a: any, b: any) => {
			if (a.created_at > b.created_at) return -1;
			if (a.created_at < b.created_at) return 1;
			return 0;
		});

		const staticData = this.getWorkflowStaticData('node');
		const lastSeen = staticData.lastSeen as string | undefined;

		const newRuns = lastSeen
			? runs.filter((r: any) => r.created_at > lastSeen)
			: [runs[0]];

		if (newRuns.length === 0) return null;

		staticData.lastSeen = newRuns[0].created_at;

		return [newRuns.map((run: any) => ({ json: run }))];
	}
}

import {
	IAuthenticateGeneric,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	INodeProperties,
} from 'n8n-workflow';
import { assertAllowedBaseUrl, assertApiKeyPresent } from '../nodes/Checkredirects/baseUrl';

export class CheckredirectsApi implements ICredentialType {
	name = 'checkredirectsApi';
	displayName = 'Checkredirects.io API';
	documentationUrl = 'https://checkredirects.io/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Paste your Checkredirects.io API key from Settings > API Keys.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.checkredirects.io',
			description:
				'API base URL. By default, restricted at runtime to https://api.checkredirects.io (and single-label subdomains like staging.checkredirects.io), or http://localhost for development. Enable "Allow Custom Host" below to point at any HTTPS host (still rejects embedded credentials, query strings, and fragments).',
		},
		{
			displayName:
				'Legacy upgrade note: credentials created before this toggle existed kept their custom Base URL automatically. When you OPEN and SAVE such a credential, n8n persists "Allow Custom Host" with its default value (OFF). If your Base URL is a non-Checkredirects host, tick the toggle BELOW before clicking Save or the next run will fail with a host-allowlist error.',
			name: 'allowCustomHostNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Allow Custom Host',
			name: 'allowCustomHost',
			type: 'boolean',
			default: false,
			description:
				'When OFF (default), the Base URL is restricted to checkredirects.io hosts + localhost — protects the Bearer token from being exfiltrated by accidental or hostile edits to this credential. Turn ON if you self-host the API at a different domain. HTTPS + no embedded credentials + no query/fragment are still enforced.',
		},
	];

	// preAuthentication runs before every authenticated request (including the
	// credential test). Validating here closes the test-time exfiltration path
	// that the declarative test request would otherwise expose, since editing
	// `baseUrl` to an attacker host can no longer route the Bearer token
	// anywhere — the assertion throws before the request is constructed.
	async preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject): Promise<IDataObject> {
		assertApiKeyPresent(credentials.apiKey);
		assertAllowedBaseUrl(credentials.baseUrl, { allowCustomHost: credentials.allowCustomHost as boolean | undefined });
		return credentials as IDataObject;
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/usage',
			method: 'GET',
		},
	};
}

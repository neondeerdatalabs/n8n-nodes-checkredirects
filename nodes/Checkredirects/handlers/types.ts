import { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

// HandlerContext is everything a per-operation handler needs without coupling
// to the rest of the node's internals. The main execute() builds this once per
// item and passes it in.
export interface HandlerContext {
	exec: IExecuteFunctions;
	// Authenticated, host-validated, retry+map-error-wrapped HTTP helper.
	api(method: string, path: string, body?: object, qs?: Record<string, string>, retries?: number): Promise<any>;
	// Authenticated GET that returns the raw response Buffer — for binary
	// endpoints like /v1/batch/{id}/export/csv.
	binaryGet(path: string): Promise<Buffer>;
	sleep(ms: number): Promise<void>;
	// For operations that fan out (importSitemap, batch split, compare split):
	// push items directly and return `{ handled: true }` from the handler.
	pushItem(json: any, pairedItem: number): void;
	// For operations that need to attach binary data (file downloads etc.):
	// build the INodeExecutionData yourself and push it directly.
	pushExecution(data: INodeExecutionData): void;
}

// Each operation returns either:
//   - { result: any }   — main loop will unwrap + push the result for you
//   - { handled: true } — handler already pushed items via pushItem(); skip
export type HandlerResult = { result: any } | { handled: true };

export type OperationHandler = (ctx: HandlerContext, i: number) => Promise<HandlerResult>;

export type ResourceHandlers = Record<string, OperationHandler>;

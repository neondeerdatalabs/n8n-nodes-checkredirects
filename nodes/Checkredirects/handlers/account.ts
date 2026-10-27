import { ResourceHandlers } from './types';

export const accountHandlers: ResourceHandlers = {
	async getUsage(ctx, _i) {
		return { result: await ctx.api('GET', '/v1/usage') };
	},
};

import rewriteRequest from "./rewrite-request";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const relaySecretKey = request.headers.get("x-relay-secret-key")

		return rewriteRequest(request, {
			rewrittenHosts: typeof env.REWRITTEN_HOSTS === "string" ? JSON.parse(env.REWRITTEN_HOSTS) : env.REWRITTEN_HOSTS,
			proxyHost: env.PROXY_HOST,
			relaySecretKey: env.RELAY_SECRET_KEY,
		});
	},
} satisfies ExportedHandler<Env>;

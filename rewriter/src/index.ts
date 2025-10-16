import rewriteRequest, { RewrittenHost } from "./rewrite-request";

const parseRewrittenHosts = (hosts: (string | RewrittenHost)[]): RewrittenHost[] => {
	return hosts.map((host) => {
		if (typeof host === "string") {
			return [host, undefined];
		}

		// that's temporairly until changes propagate to the CDN
		return host;
	});
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const relaySecretKey = request.headers.get("x-relay-secret-key")

		if (relaySecretKey !== env.RELAY_SECRET_KEY) {
			return new Response("Unauthorized", { status: 401 });
		}

		return rewriteRequest(request, {
			rewrittenHosts: parseRewrittenHosts(typeof env.REWRITTEN_HOSTS === "string" ? JSON.parse(env.REWRITTEN_HOSTS) : env.REWRITTEN_HOSTS),
			proxyHost: env.PROXY_HOST,
			relaySecretKey: env.RELAY_SECRET_KEY,
		}, env);
	},
} satisfies ExportedHandler<Env>;

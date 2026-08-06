/**
 * Bedrock "mantle" models (GPT-5.x, Grok) for pi.
 *
 * Why this exists
 * ---------------
 * pi's bundled catalog maps `openai.gpt-5.6-terra` (and siblings) to
 * `bedrock-converse-stream` on `https://bedrock-runtime.<region>.amazonaws.com`.
 * Those models are NOT served by Converse — AWS serves them from a separate
 * OpenAI-compatible endpoint:
 *
 *     https://bedrock-mantle.<region>.api.aws/openai/v1   (Responses shape)
 *
 * Calling Converse with those ids fails with:
 *     ValidationException: The provided model identifier is invalid.
 *
 * pi's `openai-responses` API can talk that shape, but it only sends a static
 * `Authorization: Bearer <apiKey>`, while mantle requires per-request SigV4
 * (service `bedrock`). Bedrock short-term bearer keys are rejected by mantle
 * ("Invalid bearer token").
 *
 * So: run a tiny loopback proxy that SigV4-signs each request with the current
 * AWS credentials from process.env (kept fresh by bedrock-sso.ts), and register
 * a `bedrock-mantle` provider whose baseUrl points at the proxy.
 */

import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SERVICE = "bedrock";
const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"content-encoding",
	"content-length",
]);

type Creds = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

function getRegion(): string {
	return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
}

function upstreamHost(region: string): string {
	return `bedrock-mantle.${region}.api.aws`;
}

function getCreds(): Creds | undefined {
	const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
	const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
	if (!accessKeyId || !secretAccessKey) return undefined;
	return { accessKeyId, secretAccessKey, sessionToken: process.env.AWS_SESSION_TOKEN };
}

const sha256hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** Minimal SigV4 (header auth, no query signing, no unsigned payloads). */
function signV4(opts: {
	method: string;
	host: string;
	path: string;
	query: string;
	body: Buffer;
	region: string;
	contentType: string;
	creds: Creds;
}): Record<string, string> {
	const now = new Date();
	const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
	const dateStamp = amzDate.slice(0, 8);
	const payloadHash = sha256hex(opts.body);

	const headers: Record<string, string> = {
		"content-type": opts.contentType,
		host: opts.host,
		"x-amz-content-sha256": payloadHash,
		"x-amz-date": amzDate,
	};
	if (opts.creds.sessionToken) headers["x-amz-security-token"] = opts.creds.sessionToken;

	const signedHeaderNames = Object.keys(headers).sort();
	const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
	const signedHeaders = signedHeaderNames.join(";");

	// Canonical query string: sort by key, values already percent-encoded by the caller.
	const canonicalQuery = opts.query
		? opts.query
				.split("&")
				.filter(Boolean)
				.map((pair) => {
					const [k, v = ""] = pair.split("=");
					return [k, v] as [string, string];
				})
				.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
				.map(([k, v]) => `${k}=${v}`)
				.join("&")
		: "";

	const canonicalRequest = [
		opts.method,
		opts.path,
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join("\n");

	const scope = `${dateStamp}/${opts.region}/${SERVICE}/aws4_request`;
	const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");

	const kDate = hmac(`AWS4${opts.creds.secretAccessKey}`, dateStamp);
	const kRegion = hmac(kDate, opts.region);
	const kService = hmac(kRegion, SERVICE);
	const kSigning = hmac(kService, "aws4_request");
	const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

	headers.authorization = `AWS4-HMAC-SHA256 Credential=${opts.creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
	return headers;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
	const region = getRegion();
	const host = upstreamHost(region);
	const [rawPath, rawQuery = ""] = (req.url || "/").split("?");

	if (rawPath === "/__health") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: true, region, upstream: host }));
		return;
	}

	const creds = getCreds();
	if (!creds) {
		res.writeHead(401, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				error: {
					type: "authentication_error",
					message:
						"No AWS credentials in process.env (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY). Run /bedrock-login.",
				},
			}),
		);
		return;
	}

	const body = await readBody(req);
	const contentType = (req.headers["content-type"] as string) || "application/json";
	const signed = signV4({
		method: req.method || "POST",
		host,
		path: rawPath,
		query: rawQuery,
		body,
		region,
		contentType,
		creds,
	});

	const outHeaders: Record<string, string> = { ...signed };
	if (req.headers.accept) outHeaders.accept = req.headers.accept as string;

	let upstream: Response;
	try {
		upstream = await fetch(`https://${host}${rawPath}${rawQuery ? `?${rawQuery}` : ""}`, {
			method: req.method || "POST",
			headers: outHeaders,
			body: body.length > 0 ? body : undefined,
		});
	} catch (error) {
		res.writeHead(502, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				error: { type: "api_error", message: `bedrock-mantle proxy upstream failure: ${String(error)}` },
			}),
		);
		return;
	}

	const respHeaders: Record<string, string> = {};
	upstream.headers.forEach((value, key) => {
		if (!HOP_BY_HOP.has(key.toLowerCase())) respHeaders[key] = value;
	});
	res.writeHead(upstream.status, respHeaders);

	if (!upstream.body) {
		res.end();
		return;
	}
	// Stream SSE straight through, chunk by chunk.
	Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
}

let server: Server | undefined;

async function startProxy(): Promise<number> {
	if (server) {
		const addr = server.address();
		if (addr && typeof addr === "object") return addr.port;
	}
	server = createServer((req, res) => {
		void handle(req, res).catch((error) => {
			if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { type: "api_error", message: String(error) } }));
		});
	});
	server.keepAliveTimeout = 120_000;
	server.headersTimeout = 125_000;
	await new Promise<void>((resolve, reject) => {
		server!.once("error", reject);
		server!.listen(0, "127.0.0.1", () => resolve());
	});
	server.unref();
	const addr = server.address();
	if (!addr || typeof addr !== "object") throw new Error("bedrock-mantle proxy failed to bind");
	return addr.port;
}

type Cost = { input: number; output: number; cacheRead: number; cacheWrite: number };
type ThinkingMap = Partial<
	Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>
>;

const FULL_EFFORT: ThinkingMap = {
	off: "none",
	minimal: "low",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};
const NO_MAX: ThinkingMap = { ...FULL_EFFORT, max: null };
const NO_XHIGH: ThinkingMap = { ...FULL_EFFORT, xhigh: null, max: null };

type MantleModel = {
	id: string;
	name: string;
	cost: Cost;
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap: ThinkingMap;
	input?: ("text" | "image")[];
	/** gpt-oss models live under /v1 instead of /openai/v1 */
	pathPrefix?: string;
};

const MODELS: MantleModel[] = [
	{
		id: "openai.gpt-5.6-terra",
		name: "GPT-5.6 Terra (Bedrock)",
		cost: { input: 2.2, output: 13.2, cacheRead: 0.22, cacheWrite: 2.75 },
		contextWindow: 272_000,
		maxTokens: 128_000,
		thinkingLevelMap: FULL_EFFORT,
	},
	{
		id: "openai.gpt-5.6-sol",
		name: "GPT-5.6 Sol (Bedrock)",
		cost: { input: 5.5, output: 33, cacheRead: 0.55, cacheWrite: 6.88 },
		contextWindow: 272_000,
		maxTokens: 128_000,
		thinkingLevelMap: FULL_EFFORT,
	},
	{
		id: "openai.gpt-5.6-luna",
		name: "GPT-5.6 Luna (Bedrock)",
		cost: { input: 0.22, output: 1.32, cacheRead: 0.022, cacheWrite: 0.275 },
		contextWindow: 272_000,
		maxTokens: 128_000,
		thinkingLevelMap: FULL_EFFORT,
	},
	{
		id: "openai.gpt-5.5",
		name: "GPT-5.5 (Bedrock)",
		cost: { input: 5.5, output: 33, cacheRead: 0.55, cacheWrite: 0 },
		contextWindow: 272_000,
		maxTokens: 128_000,
		thinkingLevelMap: NO_MAX,
	},
	{
		id: "openai.gpt-5.4",
		name: "GPT-5.4 (Bedrock)",
		cost: { input: 2.75, output: 16.5, cacheRead: 0.275, cacheWrite: 0 },
		contextWindow: 272_000,
		maxTokens: 128_000,
		thinkingLevelMap: NO_MAX,
	},
	{
		id: "xai.grok-4.3",
		name: "Grok 4.3 (Bedrock)",
		cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 131_072,
		thinkingLevelMap: NO_XHIGH,
	},
];

export default async function bedrockMantleExtension(pi: ExtensionAPI) {
	const port = await startProxy();
	const base = `http://127.0.0.1:${port}`;

	pi.registerProvider("bedrock-mantle", {
		name: "Amazon Bedrock (mantle)",
		baseUrl: `${base}/openai/v1`,
		// Proxy injects SigV4; the bearer value is never used upstream, but
		// registerProvider requires a non-empty apiKey.
		apiKey: "sigv4-via-local-proxy",
		api: "openai-responses",
		models: MODELS.map((model) => ({
			id: model.id,
			name: model.name,
			reasoning: true,
			input: model.input ?? ["text", "image"],
			cost: model.cost,
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			thinkingLevelMap: model.thinkingLevelMap,
			baseUrl: model.pathPrefix ? `${base}${model.pathPrefix}` : undefined,
			compat: { supportsStrictMode: true, supportsStore: false },
		})),
	});

	pi.registerCommand("bedrock-mantle-status", {
		description: "Show the local Bedrock mantle SigV4 proxy status",
		handler: async (_args, ctx) => {
			const region = getRegion();
			const creds = getCreds();
			ctx.ui.notify(
				`proxy ${base} -> https://${upstreamHost(region)} | creds: ${
					creds ? `${creds.accessKeyId.slice(0, 8)}… (session token: ${creds.sessionToken ? "yes" : "no"})` : "MISSING"
				}`,
				creds ? "info" : "warning",
			);
		},
	});
}

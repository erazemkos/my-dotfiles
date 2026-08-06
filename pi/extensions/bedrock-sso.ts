import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type FoundationModelSummary = {
	modelId?: string;
	modelName?: string;
	providerName?: string;
	inputModalities?: string[];
	outputModalities?: string[];
	responseStreamingSupported?: boolean;
	inferenceTypesSupported?: string[];
};

type ListFoundationModelsResponse = {
	modelSummaries?: FoundationModelSummary[];
};

const STATUS_KEY = "bedrock-sso";
// Refresh credentials when fewer than this many ms remain before expiry.
const EXPIRY_BUFFER_MS = 2 * 60 * 1000;
// Safety-net TTL for re-validating creds that don't report an Expiration
// (static-ish session tokens written by getaws, long-lived IAM keys, ...).
const VALIDATION_TTL_MS = 5 * 60 * 1000;
const AWS_STS_TIMEOUT_MS = 15_000;
const AWS_EXPORT_TIMEOUT_MS = 10_000;
const AWS_BEDROCK_LIST_TIMEOUT_MS = 30_000;
// getaws may run `aws sso login`, which blocks waiting for the browser
// callback. Give the user plenty of time to complete the SSO flow.
const AWS_REFRESH_TIMEOUT_MS = 10 * 60 * 1000;

// Next time (ms epoch) we're allowed to skip the refresh check. Derived from the
// real credential Expiration returned by `aws configure export-credentials`, so
// we refresh ahead of actual STS session-token expiry instead of only on failure.
let credsValidUntil = 0;
let inflightValidation: Promise<void> | null = null;

// Proactive refresh timer + the most recent extension ctx.
//
// Why this exists: pi's Bedrock provider (pi-ai bedrock-converse-stream)
// resolves credentials from process.env and constructs the BedrockRuntimeClient
// *before* it fires before_provider_request (it runs as the SDK `onPayload`
// hook). So refreshing creds inside before_provider_request is always one
// request too late: the client for THAT request already captured the expired
// token, and ExpiredTokenException is not in pi's retryable-error list, so pi
// won't rebuild the client and retry. The only way to keep requests working is
// to guarantee process.env already holds valid creds *before* the next client
// is built. We do that by (a) refreshing on a timer that fires ahead of the
// real STS expiry and (b) eagerly refreshing the moment a Bedrock response
// comes back 401/403.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let lastCtx: ExtensionContext | null = null;

// The profile the user originally had in the shell. We capture it at extension
// init time, then DELETE process.env.AWS_PROFILE so the AWS SDK inside pi takes
// the fromEnv branch of its default credential chain. Subprocess `aws` calls
// still pass `--profile ${originalProfile}` explicitly, so they're unaffected.
let originalProfile = "default";

function getProfile(): string {
	return originalProfile;
}

function getRegion(fallback = "us-east-1"): string {
	return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || fallback;
}

function hasBearerToken(): boolean {
	return Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK);
}

/**
 * Set up AWS_REGION / AWS_DEFAULT_REGION / AWS_SDK_LOAD_CONFIG and DROP
 * AWS_PROFILE from the environment.
 *
 * Why drop AWS_PROFILE?
 *   pi's Bedrock provider uses @aws-sdk/credential-provider-node's
 *   `defaultProvider`, which reads credentials through a chain. Two caches in
 *   that chain bite us:
 *     1. @smithy/shared-ini-file-loader memoizes ~/.aws/credentials at module
 *        level for the whole process lifetime. Once pi reads the file, later
 *        rewrites by `getaws` are invisible to the SDK.
 *     2. defaultProvider explicitly SKIPS fromEnv when AWS_PROFILE is set, so
 *        we can't just overlay fresh credentials via env vars while a profile
 *        is present.
 *   By unsetting AWS_PROFILE and injecting AWS_ACCESS_KEY_ID/SECRET/SESSION via
 *   `applyEnvCredentials`, we force the SDK onto the fromEnv branch, which
 *   reads process.env on every resolve — no file caching involved.
 *
 * pi's built-in `amazon-bedrock` auth detection accepts
 * AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY as a valid credential source, so
 * the provider still reports as authenticated in `/model`.
 */
function ensureAwsEnv(region?: string) {
	if (process.env.AWS_PROFILE) {
		if (!originalProfile || originalProfile === "default") {
			originalProfile = process.env.AWS_PROFILE;
		}
		delete process.env.AWS_PROFILE;
	}
	const effectiveRegion = region || getRegion();
	if (!process.env.AWS_REGION) {
		process.env.AWS_REGION = effectiveRegion;
	}
	if (!process.env.AWS_DEFAULT_REGION) {
		process.env.AWS_DEFAULT_REGION = effectiveRegion;
	}
	if (!process.env.AWS_SDK_LOAD_CONFIG) {
		process.env.AWS_SDK_LOAD_CONFIG = "1";
	}
}

function formatExecFailure(result: { code?: number | null; stdout?: string; stderr?: string; killed?: boolean }): string {
	const parts = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean);
	const message = parts.join("\n");
	if (message) return message;
	if (result.killed) return "Command was killed or timed out";
	if (typeof result.code === "number") return `Command exited with code ${result.code}`;
	return "Command failed";
}

function shQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function runAws(pi: ExtensionAPI, args: string[], timeout?: number) {
	const command = ["aws", ...args, "--no-cli-pager"].map(shQuote).join(" ");
	return pi.exec("bash", ["-lc", command], timeout ? { timeout } : undefined);
}

async function validateAwsIdentity(pi: ExtensionAPI, profile: string) {
	return runAws(pi, ["sts", "get-caller-identity", "--profile", profile, "--output", "json"], AWS_STS_TIMEOUT_MS);
}

async function loginAwsSso(pi: ExtensionAPI, profile: string) {
	return runAws(pi, ["sso", "login", "--profile", profile]);
}

/**
 * Resolve current credentials for the profile and parse the Expiration field.
 * Works for both SSO-resolved and static (session-token) credentials, because
 * `aws configure export-credentials` runs the same resolution chain the SDK
 * inside pi will use when it creates the BedrockRuntimeClient.
 *
 * Returns `{ expiresAt }` on success (0 means no expiry reported, i.e. static
 * keys). Returns `{ error }` on any failure — including "Token has expired" —
 * which signals the caller to run the refresh flow.
 */
async function exportCredentials(
	pi: ExtensionAPI,
	profile: string,
): Promise<{ expiresAt?: number; error?: string; raw?: ParsedExportedCredentials }> {
	const result = await runAws(
		pi,
		["configure", "export-credentials", "--profile", profile, "--format", "process"],
		AWS_EXPORT_TIMEOUT_MS,
	).catch((error) => ({ code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) }));
	if (result.code !== 0) {
		return { error: formatExecFailure(result) };
	}
	try {
		const parsed = JSON.parse(result.stdout || "{}") as ParsedExportedCredentials;
		if (!parsed.AccessKeyId || !parsed.SecretAccessKey) {
			return { error: "export-credentials returned no AccessKeyId/SecretAccessKey" };
		}
		let expiresAt = 0;
		if (parsed.Expiration) {
			const ts = Date.parse(parsed.Expiration);
			if (!Number.isNaN(ts)) expiresAt = ts;
		}
		return { expiresAt, raw: parsed };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

type ParsedExportedCredentials = {
	AccessKeyId?: string;
	SecretAccessKey?: string;
	SessionToken?: string;
	Expiration?: string;
};

/**
 * Copy freshly-resolved credentials into `process.env` so the AWS SDK inside
 * pi picks them up via its fromEnv provider on the next request. This is the
 * ONLY way to defeat @smithy/shared-ini-file-loader's module-level file cache,
 * which otherwise keeps serving the credentials pi read at startup even after
 * `getaws` rewrites ~/.aws/credentials on disk.
 */
function applyEnvCredentials(creds: ParsedExportedCredentials) {
	if (!creds.AccessKeyId || !creds.SecretAccessKey) return;
	process.env.AWS_ACCESS_KEY_ID = creds.AccessKeyId;
	process.env.AWS_SECRET_ACCESS_KEY = creds.SecretAccessKey;
	if (creds.SessionToken) {
		process.env.AWS_SESSION_TOKEN = creds.SessionToken;
	} else {
		delete process.env.AWS_SESSION_TOKEN;
	}
	// Make doubly sure AWS_PROFILE is not in env — defaultProvider skips
	// fromEnv whenever it's set, which would route the SDK back through the
	// cached ini file we're trying to bypass.
	delete process.env.AWS_PROFILE;
}

async function hasCommand(pi: ExtensionAPI, name: string): Promise<boolean> {
	const result = await pi
		.exec("bash", ["-lc", `command -v ${shQuote(name)}`], { timeout: 3_000 })
		.catch(() => ({ code: 1 } as { code: number }));
	return result.code === 0;
}

/**
 * Run the user's `getaws` helper, which (a) calls `aws sso login` if the SSO
 * token is expired and (b) rewrites `~/.aws/credentials` with fresh static
 * session credentials. That file is required because for the `default` profile
 * the AWS SDK reads `~/.aws/credentials` before falling back to the SSO config
 * in `~/.aws/config` — so refreshing the SSO cache alone leaves stale/expired
 * session creds in place and Bedrock keeps failing with ExpiredTokenException.
 */
async function runGetaws(pi: ExtensionAPI) {
	return pi.exec("bash", ["-lc", "getaws"], { timeout: AWS_REFRESH_TIMEOUT_MS });
}

/**
 * Resolve fresh credentials via the SSO chain, bypassing the stale
 * ~/.aws/credentials file. Relies on AWS_SHARED_CREDENTIALS_FILE=/dev/null
 * to force the CLI onto the SSO config in ~/.aws/config, which (after a
 * successful `aws sso login`) will return freshly-minted STS credentials.
 */
async function exportCredentialsViaSso(
	pi: ExtensionAPI,
	profile: string,
): Promise<ParsedExportedCredentials> {
	const cmd = [
		"AWS_SHARED_CREDENTIALS_FILE=/dev/null",
		"aws",
		"configure",
		"export-credentials",
		"--profile",
		shQuote(profile),
		"--format",
		"process",
		"--no-cli-pager",
	].join(" ");
	const result = await pi
		.exec("bash", ["-lc", cmd], { timeout: AWS_EXPORT_TIMEOUT_MS })
		.catch((error) => ({ code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) }));
	if (result.code !== 0) {
		throw new Error(`export-credentials via SSO failed: ${formatExecFailure(result)}`);
	}
	let parsed: ParsedExportedCredentials;
	try {
		parsed = JSON.parse(result.stdout || "{}");
	} catch (error) {
		throw new Error(`Could not parse SSO export-credentials output: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!parsed.AccessKeyId || !parsed.SecretAccessKey) {
		throw new Error("SSO export-credentials returned no AccessKeyId/SecretAccessKey");
	}
	return parsed;
}

/**
 * Write refreshed credentials to ~/.aws/credentials so other tools (and future
 * pi restarts that read env from shell init) see them. The format matches what
 * `getaws` writes, minimising surprise.
 */
async function writeCredentialsFile(profile: string, creds: ParsedExportedCredentials) {
	const fsPromises = await import("node:fs/promises");
	const pathMod = await import("node:path");
	const osMod = await import("node:os");
	const credPath = pathMod.join(osMod.homedir(), ".aws", "credentials");
	const lines = [
		`[${profile}]`,
		`aws_access_key_id=${creds.AccessKeyId}`,
		`aws_secret_access_key=${creds.SecretAccessKey}`,
		...(creds.SessionToken ? [`aws_session_token=${creds.SessionToken}`] : []),
	];
	await fsPromises.writeFile(credPath, lines.join("\n") + "\n", "utf8");
}

async function performRefresh(pi: ExtensionAPI, ctx: ExtensionContext, profile: string, reason: string) {
	ctx.ui.setStatus(STATUS_KEY, `Refreshing AWS creds (${profile}) for ${reason}...`);

	// Step 1: ensure the SSO cache has a fresh token. `aws sso login` is a
	// no-op (~1s) when the cached token is still valid and opens the browser
	// when it isn't. Doing this unconditionally sidesteps bugs in detection
	// heuristics (including the one in the user's getaws script, which only
	// runs sso login when the FIRST export-credentials call errors — but
	// export-credentials silently returns already-expired static session
	// tokens from ~/.aws/credentials without erroring).
	ctx.ui.notify(`Running aws sso login --profile ${profile} (browser may open)...`, "info");
	const login = await loginAwsSso(pi, profile).catch((error) => ({
		code: 1,
		stdout: "",
		stderr: error instanceof Error ? error.message : String(error),
	}));
	if (login.code !== 0) {
		throw new Error(`aws sso login failed: ${formatExecFailure(login)}`);
	}

	// Step 2: resolve fresh credentials via SSO, bypassing the stale creds
	// file. The AWS SDK's ini file cache and the AWS CLI's preference for the
	// credentials file both lose to AWS_SHARED_CREDENTIALS_FILE=/dev/null.
	ctx.ui.notify("Fetching fresh credentials from SSO...", "info");
	const fresh = await exportCredentialsViaSso(pi, profile);

	// Step 3: mirror them to ~/.aws/credentials so other tools (and future
	// sessions) see the fresh values. Best-effort — if the write fails we can
	// still succeed within this pi session because step 4 populates env vars.
	try {
		await writeCredentialsFile(profile, fresh);
	} catch (error) {
		ctx.ui.notify(
			`Warning: could not write ~/.aws/credentials (${error instanceof Error ? error.message : String(error)})`,
			"warning",
		);
	}

	// Step 4: push into process.env so the AWS SDK *inside pi* uses them on
	// the next request. Without this, the SDK keeps serving the credentials
	// it cached from the file at startup (see @smithy/shared-ini-file-loader
	// filePromises), even after the file has been rewritten.
	applyEnvCredentials(fresh);

	// Update validity window from the real Expiration if the SSO provider
	// gave us one, otherwise use the conservative TTL.
	if (fresh.Expiration) {
		const ts = Date.parse(fresh.Expiration);
		if (!Number.isNaN(ts)) credsValidUntil = ts;
		else credsValidUntil = Date.now() + VALIDATION_TTL_MS;
	} else {
		credsValidUntil = Date.now() + VALIDATION_TTL_MS;
	}
}

async function ensureBedrockAuth(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	reason: string,
	forceLogin = false,
) {
	ensureAwsEnv();
	if (hasBearerToken()) return;
	// Fast path: we know (from the previous export-credentials call) the creds
	// are still valid — skip the subprocess round-trip entirely.
	if (!forceLogin && Date.now() < credsValidUntil - EXPIRY_BUFFER_MS) return;
	if (inflightValidation) return inflightValidation;

	const profile = getProfile();
	inflightValidation = (async () => {
		let needsRefresh = forceLogin;
		let knownExpiresAt = 0;

		if (!forceLogin) {
			const current = await exportCredentials(pi, profile);
			if (current.error !== undefined) {
				needsRefresh = true;
				ctx.ui.notify(`AWS credentials unresolvable (${current.error.split("\n")[0]}) — refreshing`, "info");
			} else {
				knownExpiresAt = current.expiresAt ?? 0;
				if (knownExpiresAt > 0 && knownExpiresAt <= Date.now() + EXPIRY_BUFFER_MS) {
					needsRefresh = true;
					ctx.ui.notify(
						`AWS credentials for ${profile} expire at ${new Date(knownExpiresAt).toISOString()} — refreshing now`,
						"info",
					);
				} else {
					// Either a real Expiration that's still in the future, OR no
					// Expiration at all (the common case for session-token creds
					// that getaws writes to ~/.aws/credentials — the file format
					// has no expiration field). We cannot trust the absence of an
					// Expiration: those tokens silently expire after ~1h. Actually
					// call STS to prove the creds work before letting the request
					// through.
					const identity = await validateAwsIdentity(pi, profile).catch((error) => ({
						code: 1,
						stdout: "",
						stderr: error instanceof Error ? error.message : String(error),
					}));
					if (identity.code !== 0) {
						needsRefresh = true;
						const failure = formatExecFailure(identity).split("\n")[0];
						ctx.ui.notify(`AWS sts get-caller-identity failed (${failure}) — refreshing`, "info");
					}
				}
			}
		}

		if (!needsRefresh) {
			credsValidUntil = knownExpiresAt > 0 ? knownExpiresAt : Date.now() + VALIDATION_TTL_MS;
			// On the happy path we still need to sync env vars so the SDK's
			// fromEnv branch has them available (e.g. on the first request after
			// startup when no refresh was triggered).
			const fresh = await exportCredentials(pi, profile);
			if (fresh.raw) applyEnvCredentials(fresh.raw);
			return;
		}

		await performRefresh(pi, ctx, profile, reason);

		// performRefresh already set env vars and credsValidUntil. Sanity-check
		// that process.env actually looks populated before we let the request
		// through — if something stripped the env vars (a racing ensureAwsEnv
		// call, a concurrent extension, etc.) we'd rather fail loudly than hit
		// ExpiredTokenException again.
		if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
			throw new Error("AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not populated after refresh");
		}
		if (process.env.AWS_PROFILE) {
			throw new Error("AWS_PROFILE is still set after refresh — SDK will skip fromEnv and read cached ini file");
		}

		// Confirm end-to-end with STS, this time using the env-var creds we
		// just injected (no --profile flag, so the CLI uses env vars too).
		const retryIdentity = await pi
			.exec("bash", ["-lc", "aws sts get-caller-identity --output json --no-cli-pager"], {
				timeout: AWS_STS_TIMEOUT_MS,
			})
			.catch((error) => ({ code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) }));
		if (retryIdentity.code !== 0) {
			throw new Error(`STS check with fresh env creds still failing: ${formatExecFailure(retryIdentity)}`);
		}
		ctx.ui.notify(`AWS credentials refreshed for profile ${profile} (AKID=${process.env.AWS_ACCESS_KEY_ID?.slice(0, 8)}…)`, "success");
	})()
		.catch((error) => {
			// Force the next request to retry the whole flow instead of sitting
			// on stale credsValidUntil.
			credsValidUntil = 0;
			throw error;
		})
		.finally(() => {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			inflightValidation = null;
		});

	return inflightValidation;
}

/**
 * Schedule a background refresh that fires *before* the current credentials
 * expire, so process.env is repopulated ahead of the next Bedrock request. This
 * is what actually defeats the provider's "build client, then fire
 * before_provider_request" ordering: by the time a request builds its client,
 * the env already holds fresh creds.
 *
 * Keyed off `credsValidUntil`, which performRefresh sets from the real STS/SSO
 * Expiration when available (falling back to a conservative TTL otherwise).
 */
function scheduleProactiveRefresh(pi: ExtensionAPI, ctx: ExtensionContext) {
	lastCtx = ctx;
	if (refreshTimer) {
		clearTimeout(refreshTimer);
		refreshTimer = null;
	}
	if (hasBearerToken()) return;
	if (credsValidUntil <= 0) return;

	// Fire a little earlier than the request-time buffer so the refresh has
	// completed (and env is repopulated) before any client is constructed.
	const fireAt = credsValidUntil - EXPIRY_BUFFER_MS - 30_000;
	const delay = Math.max(5_000, fireAt - Date.now());
	refreshTimer = setTimeout(() => {
		refreshTimer = null;
		const activeCtx = lastCtx ?? ctx;
		void ensureBedrockAuth(pi, activeCtx, "proactive pre-expiry refresh")
			.then(() => scheduleProactiveRefresh(pi, activeCtx))
			.catch(() => {
				// Force the next request-time hook to retry the whole flow.
				credsValidUntil = 0;
			});
	}, delay);
	// Don't keep the event loop alive just for the refresh timer.
	(refreshTimer as { unref?: () => void }).unref?.();
}

/**
 * Invalidate cached credentials and eagerly re-auth. Used when a Bedrock
 * response comes back 401/403 (expired/invalid creds): the failing request's
 * client already captured the stale token and can't be salvaged, but by
 * refreshing env *now* we ensure the user's next request builds its client with
 * valid creds instead of needing a full session restart.
 */
async function forceReauth(pi: ExtensionAPI, ctx: ExtensionContext, reason: string) {
	credsValidUntil = 0;
	try {
		// forceLogin=false: credsValidUntil=0 already forces a full re-validation
		// (export + STS). ensureBedrockAuth only runs `aws sso login` if STS proves
		// the creds are actually dead, so a false-positive error match won't pop a
		// browser.
		await ensureBedrockAuth(pi, ctx, reason, false);
		scheduleProactiveRefresh(pi, ctx);
	} catch {
		// Leave credsValidUntil at 0 so the next request retries.
	}
}

function getBedrockEndpoint(region: string): string {
	return `https://bedrock-runtime.${region}.amazonaws.com`;
}

function getInferenceProfilePrefix(region: string): string | undefined {
	if (region.startsWith("us-gov-")) return "us-gov.";
	if (region.startsWith("us-")) return "us.";
	if (region.startsWith("eu-")) return "eu.";
	if (region.startsWith("ap-") || region.startsWith("me-") || region.startsWith("sa-") || region.startsWith("ca-")) {
		return "apac.";
	}
	return undefined;
}

function resolvePiBedrockModelId(model: FoundationModelSummary, region: string): string {
	const rawId = (model.modelId || "").trim();
	if (!rawId) return rawId;
	if (rawId.startsWith("arn:")) return rawId;
	if (rawId.startsWith("us.") || rawId.startsWith("eu.") || rawId.startsWith("apac.") || rawId.startsWith("us-gov.")) {
		return rawId;
	}
	const inferenceTypes = model.inferenceTypesSupported || [];
	if (inferenceTypes.includes("ON_DEMAND")) return rawId;
	if (inferenceTypes.includes("INFERENCE_PROFILE")) {
		const prefix = getInferenceProfilePrefix(region);
		if (prefix) return `${prefix}${rawId}`;
	}
	return rawId;
}

/**
 * Claude families that support a 1M-token context window on Bedrock when the
 * `context-1m-2025-08-07` beta is requested via additionalModelRequestFields.
 * Older Claude 3.x models stay at 200k; non-Claude models fall through to the
 * default 128k below.
 */
function supportsClaude1MContext(modelId: string): boolean {
	const id = modelId.toLowerCase();
	if (!id.includes("claude")) return false;
	// Claude Sonnet 4 / 4.5 and Opus 4 / 4.5 / 4.7 all support 1M with the beta.
	return /claude[-_.]?(sonnet|opus)[-_.]?4/.test(id);
}

function inferReasoning(model: FoundationModelSummary): boolean {
	const text = `${model.providerName || ""} ${model.modelId || ""} ${model.modelName || ""}`.toLowerCase();
	return (
		text.includes("anthropic") ||
		text.includes("claude") ||
		text.includes("deepseek") ||
		text.includes("reason") ||
		text.includes("qwen3") ||
		text.includes("kimi")
	);
}

function toPiProviderModel(model: FoundationModelSummary, region: string) {
	const input = (model.inputModalities || [])
		.map((modality) => modality.toLowerCase())
		.filter((modality): modality is "text" | "image" => modality === "text" || modality === "image");
	const piModelId = resolvePiBedrockModelId(model, region);
	return {
		id: piModelId,
		name: model.modelName || model.modelId || piModelId,
		reasoning: inferReasoning(model),
		input: input.length > 0 ? input : (["text"] as ("text" | "image")[]),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: supportsClaude1MContext(piModelId)
			? 1_000_000
			: piModelId.includes("claude")
				? 200_000
				: 128_000,
		maxTokens: piModelId.includes("claude") ? 64000 : 16384,
	};
}

async function fetchBedrockModels(pi: ExtensionAPI, region: string): Promise<FoundationModelSummary[]> {
	const profile = getProfile();
	const result = await runAws(
		pi,
		["bedrock", "list-foundation-models", "--profile", profile, "--region", region, "--output", "json"],
		AWS_BEDROCK_LIST_TIMEOUT_MS,
	);
	if (result.code !== 0) {
		throw new Error(formatExecFailure(result));
	}
	if (result.stdout?.trim()) {
		const parsed = JSON.parse(result.stdout) as ListFoundationModelsResponse;
		const models = [...(parsed.modelSummaries || [])]
			.filter((model) => model.modelId)
			.sort((a, b) => (a.modelId || "").localeCompare(b.modelId || ""));
		if (models.length > 0) return models;
	}

	const fallback = await runAws(
		pi,
		[
			"bedrock",
			"list-foundation-models",
			"--profile",
			profile,
			"--region",
			region,
			"--query",
			"modelSummaries[].modelId",
			"--output",
			"text",
		],
		AWS_BEDROCK_LIST_TIMEOUT_MS,
	);
	if (fallback.code !== 0) {
		throw new Error(formatExecFailure(fallback));
	}
	const ids = (fallback.stdout || "")
		.split(/\s+/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((modelId) => ({ modelId })) as FoundationModelSummary[];
	if (ids.length === 0) {
		throw new Error(`aws returned no Bedrock models for profile ${profile} in ${region}`);
	}
	return ids.sort((a, b) => (a.modelId || "").localeCompare(b.modelId || ""));
}

async function syncBedrockModels(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	region: string,
	models: FoundationModelSummary[],
) {
	const providerModels = models.map((model) => toPiProviderModel(model, region));
	ensureAwsEnv(region);
	// apiKey is required by registerProvider's validator, but pi's Bedrock provider
	// does not actually use it — the AWS SDK resolves credentials via the default
	// credential chain (fromEnv, which we keep populated). Pass a placeholder the
	// validator accepts.
	pi.registerProvider("amazon-bedrock", {
		baseUrl: getBedrockEndpoint(region),
		apiKey: "AWS_ACCESS_KEY_ID",
		api: "bedrock-converse-stream",
		models: providerModels,
	});
	ctx.ui.notify(`Synced ${providerModels.length} Bedrock models into /model for ${region}`, "info");
}

export default function bedrockSsoExtension(pi: ExtensionAPI) {
	// Capture the original AWS_PROFILE before ensureAwsEnv() strips it, so
	// subprocess `aws` calls can still target the user's configured profile.
	if (process.env.AWS_PROFILE) {
		originalProfile = process.env.AWS_PROFILE;
	}

	// Move the user's credentials from the ini file into process.env *now*, so
	// pi's very first Bedrock request uses env-var creds and never touches the
	// @smithy/shared-ini-file-loader cache (which, once populated, is locked
	// for the process lifetime). ensureAwsEnv() then drops AWS_PROFILE so the
	// SDK takes the fromEnv branch of its credential chain.
	void (async () => {
		try {
			const fresh = await exportCredentials(pi, originalProfile);
			if (fresh.raw) applyEnvCredentials(fresh.raw);
		} catch {
			// Best-effort only. The session_start handler below (awaited by pi
			// during startup) does the authoritative refresh, incl. sso login.
		}
		ensureAwsEnv();
	})();

	// Refresh (and, if needed, `aws sso login`) BEFORE pi accepts the first
	// prompt. pi AWAITS session_start handlers during startup
	// (agent-session.ts: `await this._extensionRunner.emit(this._sessionStartEvent)`).
	// This matters because pi's prompt path gates on hasConfiguredAuth(model)
	// *before* it ever fires before_provider_request — and for amazon-bedrock
	// that gate only checks whether AWS_ACCESS_KEY_ID/SECRET (or
	// AWS_BEARER_TOKEN_BEDROCK) are present in process.env. So the request-time
	// hook is too late on a cold session whose SSO token expired overnight:
	// the user would see "No API key found for amazon-bedrock" and have to run
	// /bedrock-login by hand. Refreshing here populates env in time for the gate.
	pi.on("session_start", async (_event, ctx) => {
		if (hasBearerToken()) return;
		try {
			await ensureBedrockAuth(pi, ctx, "session start");
			scheduleProactiveRefresh(pi, ctx);
		} catch (error) {
			const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
			ctx.ui.notify(
				`Bedrock auto-login at startup failed (${detail}). Run /bedrock-login to retry.`,
				"warning",
			);
		}
	});

	pi.on("before_provider_request", async (event, ctx) => {
		if (ctx.model?.provider !== "amazon-bedrock") return;
		await ensureBedrockAuth(pi, ctx, `Bedrock request (${ctx.model.id})`);
		// Keep the pre-expiry refresh timer aligned with the latest validity
		// window and ctx, so env is repopulated before the client is built.
		scheduleProactiveRefresh(pi, ctx);

		// Inject the 1M-context beta for Claude families that support it.
		// pi's pi-ai bedrock provider only auto-adds interleaved-thinking; the
		// 1M beta has to come from us, otherwise Bedrock rejects requests whose
		// input exceeds 200k tokens. The payload here is the Converse(Stream)
		// CommandInput, mutated in place and returned.
		if (!supportsClaude1MContext(ctx.model.id)) return;
		const payload = event.payload as
			| { additionalModelRequestFields?: Record<string, unknown> }
			| undefined;
		if (!payload || typeof payload !== "object") return;
		const fields = (payload.additionalModelRequestFields ??= {}) as Record<string, unknown>;
		const existing = Array.isArray(fields.anthropic_beta) ? (fields.anthropic_beta as string[]) : [];
		if (!existing.includes("context-1m-2025-08-07")) {
			fields.anthropic_beta = [...existing, "context-1m-2025-08-07"];
		}
		return payload;
	});

	// A failed Bedrock request due to expired/invalid creds surfaces as an
	// assistant message with stopReason "error" (ExpiredTokenException / 403).
	// after_provider_response can't help here: it only fires on a *successful*
	// send, whereas an expired token makes client.send() throw. And the failing
	// request's client already captured the stale token (the before_provider_request
	// refresh runs AFTER the client is built), so it can't be salvaged. Eagerly
	// re-auth here so the user's next request builds its client with fresh env
	// creds — no session restart needed. ExpiredTokenException is not in pi's
	// retryable-error list, so pi won't auto-retry it for us.
	pi.on("message_end", async (event, ctx) => {
		if (ctx.model?.provider !== "amazon-bedrock") return;
		if (hasBearerToken()) return;
		const message = event.message as { role?: string; stopReason?: string; errorMessage?: string };
		if (message.role !== "assistant" || message.stopReason !== "error") return;
		const text = message.errorMessage ?? "";
		const looksLikeAuthExpiry =
			/expiredtoken|the security token included in the request is expired|expired token|403|unrecognizedclient|invalidsignature|forbidden/i.test(
				text,
			);
		if (!looksLikeAuthExpiry) return;
		ctx.ui.notify("Bedrock request failed on expired credentials — refreshing for the next request…", "info");
		await forceReauth(pi, ctx, "expired-credential request failure");
	});

	pi.registerCommand("bedrock-login", {
		description: "Force-refresh AWS SSO, then sync Bedrock models into /model",
		handler: async (args, ctx) => {
			const region = args.trim() || getRegion();
			await ensureBedrockAuth(pi, ctx, "manual refresh", true);
			scheduleProactiveRefresh(pi, ctx);
			const models = await fetchBedrockModels(pi, region);
			await syncBedrockModels(pi, ctx, region, models);
			ctx.ui.notify(`AWS auth looks good for profile ${getProfile()}`, "success");
			ctx.ui.notify(`Open /model and search for the Bedrock model you want.`, "info");
		},
	});
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataRoot = path.resolve(process.env.T2I_DATA_ROOT ?? path.join(repositoryRoot, "data/datasets"));
const scoringRoot = path.resolve(process.env.T2I_SCORING_ROOT ?? path.join(repositoryRoot, "data/scoring"));
const redirectHosts = (process.env.COVIS_REDIRECT_HOSTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const canonicalOrigin = process.env.COVIS_CANONICAL_ORIGIN?.trim() || undefined;
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";
const networkEnabled = process.env.T2I_ALLOW_NETWORK === "true";
const configuredHosts = (process.env.T2I_ALLOWED_HOSTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);

if (host !== "127.0.0.1" && !networkEnabled) {
  throw new Error("Non-loopback binding requires T2I_ALLOW_NETWORK=true and an authenticated TLS reverse proxy.");
}
if (networkEnabled && !configuredHosts.length) throw new Error("Network binding requires a non-empty T2I_ALLOWED_HOSTS allowlist.");

if (redirectHosts.length && !canonicalOrigin) throw new Error("COVIS_REDIRECT_HOSTS requires COVIS_CANONICAL_ORIGIN.");

const app = await buildApp({ dataRoot, scoringRoot, redirectHosts, canonicalOrigin, allowedHosts: networkEnabled ? configuredHosts : undefined });
await app.listen({ host, port });

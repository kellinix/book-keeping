import crypto from "crypto";

const AUTH_URL = process.env.TRUELAYER_AUTH_URL || "https://auth.truelayer-sandbox.com";
const API_URL = process.env.TRUELAYER_API_URL || "https://api.truelayer-sandbox.com";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function encryptionKey() {
  return crypto.createHash("sha256").update(required("BANK_TOKEN_ENCRYPTION_KEY")).digest();
}

export function encryptToken(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptToken(value: string) {
  const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function createState(userId: string) {
  const payload = Buffer.from(JSON.stringify({ userId, nonce: crypto.randomUUID(), expires: Date.now() + 10 * 60_000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", required("BANK_TOKEN_ENCRYPTION_KEY")).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readState(state: string) {
  const [payload, signature] = state.split(".");
  const expected = crypto.createHmac("sha256", required("BANK_TOKEN_ENCRYPTION_KEY")).update(payload).digest();
  const actual = Buffer.from(signature || "", "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Invalid connection state");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!parsed.userId || parsed.expires < Date.now()) throw new Error("Connection state expired");
  return parsed as { userId: string };
}

export function authorizationUrl(state: string) {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", required("TRUELAYER_CLIENT_ID"));
  url.searchParams.set("redirect_uri", required("TRUELAYER_REDIRECT_URI"));
  url.searchParams.set("scope", "info accounts balance cards transactions offline_access");
  const sandbox = AUTH_URL.includes("sandbox") || required("TRUELAYER_CLIENT_ID").startsWith("sandbox-");
  url.searchParams.set("providers", process.env.TRUELAYER_PROVIDERS || (sandbox ? "mock" : "uk-ob-all uk-oauth-all"));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(code: string) {
  const response = await fetch(`${AUTH_URL}/connect/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
    grant_type: "authorization_code", client_id: required("TRUELAYER_CLIENT_ID"), client_secret: required("TRUELAYER_CLIENT_SECRET"), redirect_uri: required("TRUELAYER_REDIRECT_URI"), code
  }) });
  if (!response.ok) throw new Error(`TrueLayer token exchange failed (${response.status})`);
  return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const response = await fetch(`${AUTH_URL}/connect/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
    grant_type: "refresh_token", client_id: required("TRUELAYER_CLIENT_ID"), client_secret: required("TRUELAYER_CLIENT_SECRET"), refresh_token: refreshToken
  }) });
  if (!response.ok) throw new Error(`TrueLayer token refresh failed (${response.status})`);
  return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number }>;
}

export async function trueLayerGet<T>(path: string, accessToken: string) {
  const response = await fetch(`${API_URL}/data/v1${path}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`TrueLayer request failed (${response.status})`);
  return response.json() as Promise<{ results: T[] }>;
}

export function isTrueLayerConfigured() {
  return Boolean(process.env.TRUELAYER_CLIENT_ID && process.env.TRUELAYER_CLIENT_SECRET && process.env.TRUELAYER_REDIRECT_URI && process.env.BANK_TOKEN_ENCRYPTION_KEY);
}

export function isTrueLayerSandbox() {
  return AUTH_URL.includes("sandbox") || API_URL.includes("sandbox") || String(process.env.TRUELAYER_CLIENT_ID || "").startsWith("sandbox-");
}

export function trueLayerAccountRef(providerAccountId: string) {
  return `truelayer:${String(providerAccountId).trim()}`;
}

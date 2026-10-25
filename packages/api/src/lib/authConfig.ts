export type AuthConfig = {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  allowedDomains: string[];
  publicBaseUrl: string | null;
};

// 呼び出しごとに env を読む（キャッシュしない）。テストで env を差し替えられるようにするため。
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const allowedDomains = (env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d !== "");
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const sessionSecret = env.SESSION_SECRET?.trim() ?? "";

  const missing: string[] = [];
  if (allowedDomains.length === 0) missing.push("ALLOWED_EMAIL_DOMAINS");
  if (!clientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!sessionSecret) missing.push("SESSION_SECRET");
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const base = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  return {
    clientId,
    clientSecret,
    sessionSecret,
    allowedDomains,
    publicBaseUrl: base ? base : null,
  };
}

// 起動時に設定漏れを検出するための呼び出し口
export function assertAuthConfig(): void {
  loadAuthConfig();
}

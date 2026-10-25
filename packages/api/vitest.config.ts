import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    env: {
      GOOGLE_OAUTH_CLIENT_ID: "test-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "test-secret",
      SESSION_SECRET: "test-session-secret",
      ALLOWED_EMAIL_DOMAINS: "example.com",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/routes/**"],
      exclude: ["src/routes/**/*.test.ts", "src/routes/**/*.integration.test.ts"],
      thresholds: {
        lines: 80,
        functions: 50,
        branches: 80,
        statements: 80,
      },
    },
  },
});

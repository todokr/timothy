import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    // 埋め込みモデルのロードはマシンとページキャッシュの状態で
    // 1秒から十数秒まで振れる。既定の5秒では落ちる。
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      FIRESTORE_EMULATOR_HOST: "localhost:8080",
      FIREBASE_STORAGE_EMULATOR_HOST: "localhost:9199",
      STORAGE_EMULATOR_HOST: "http://localhost:9199",
      FIREBASE_PROJECT_ID: "demo-test",
      FIREBASE_STORAGE_BUCKET: "demo-test.example.com",
    },
  },
});

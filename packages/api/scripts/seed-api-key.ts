#!/usr/bin/env tsx
/**
 * ローカル開発用APIキーをFirestoreに登録するスクリプト。
 *
 * エミュレーター:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 tsx scripts/seed-api-key.ts
 *
 * 本番Firestore (ADC / `gcloud auth application-default login` 済みの場合):
 *   FIREBASE_PROJECT_ID=... tsx scripts/seed-api-key.ts
 *
 * 本番Firestore (サービスアカウントキーを明示指定する場合):
 *   FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
 *   tsx scripts/seed-api-key.ts
 *
 * (default) 以外の名前付きデータベースを使う場合は FIRESTORE_DATABASE_ID を追加で指定する。
 */
import { db } from "../src/lib/firebase.js";
import { Timestamp } from "firebase-admin/firestore";

const API_KEY = process.env.API_KEY ?? "localtest";
const USER_ID = process.env.USER_ID ?? "local@example.com";

db.collection("apiKeys").where("key", "==", API_KEY).limit(1).get().then((snapshot) => {
	if (!snapshot.empty) {
		process.stdout.write(`API key already exists: ${API_KEY}\n`);
		process.exit(0);
	}
	db.collection("apiKeys").add({
		key: API_KEY,
		userId: USER_ID,
		createdAt: Timestamp.now(),
	}).then(() => {
		process.stdout.write(`✓ Created API key: ${API_KEY}  (userId: ${USER_ID})\n`);
	});
});





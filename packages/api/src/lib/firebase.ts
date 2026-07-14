import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

if (getApps().length === 0) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID ?? "demo-test",
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? "demo-test.example.com",
    });
  } else {
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_STORAGE_BUCKET } =
      process.env;

    // FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY が未設定の場合は、
    // Cloud Run 等の実行環境に紐づくサービスアカウント(ADC)で認証する。
    initializeApp({
      credential:
        FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY
          ? cert({
              projectId: FIREBASE_PROJECT_ID,
              clientEmail: FIREBASE_CLIENT_EMAIL,
              privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
            })
          : applicationDefault(),
      projectId: FIREBASE_PROJECT_ID,
      storageBucket: FIREBASE_STORAGE_BUCKET,
    });
  }
}

export const db = getFirestore();
export const storage = getStorage();

import admin from "firebase-admin";

let app: admin.app.App;

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);

  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  app = admin.app();
}

export const firebaseApp = app;
export const firebaseMessaging = admin.messaging();
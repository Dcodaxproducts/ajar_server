import admin from "firebase-admin";

let app: admin.app.App;

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  app = admin.app(); 
}

export const firebaseApp = app;
export const firebaseMessaging = admin.messaging();

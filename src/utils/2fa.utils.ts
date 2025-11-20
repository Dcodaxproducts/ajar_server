import "dotenv/config";
import dotenv from "dotenv";
dotenv.config();
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.TWOFA_ENC_KEY || "".trim(); // 32 bytes hex/base64
const IV_LENGTH = 16;

console.log("TWOFA_ENC_KEY:", process.env.TWOFA_ENC_KEY);
console.log("ENCRYPTION_KEY:", ENCRYPTION_KEY);

console.log("Key length in bytes:", Buffer.from(ENCRYPTION_KEY, 'hex').length);

export function encrypt(text: string): string {
  console.log("TWOFA_ENC_KEY:", process.env.TWOFA_ENC_KEY);
console.log("ENCRYPTION_KEY:", ENCRYPTION_KEY);

  if (!ENCRYPTION_KEY) throw new Error("TWOFA_ENC_KEY not set");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(data: string): string {
  if (!ENCRYPTION_KEY) throw new Error("TWOFA_ENC_KEY not set");
  const parts = data.split(":");
  const iv = Buffer.from(parts.shift()!, "hex");
  const encryptedText = Buffer.from(parts.join(":"), "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

export async function generateTempSecret(name: string, email: string) {
  const secret = speakeasy.generateSecret({
    name: `${name || "YourApp"} (${email})`,
    length: 20,
  });
  const qrDataURL = await qrcode.toDataURL(secret.otpauth_url || "");
  return { ascii: secret.ascii, hex: secret.hex, base32: secret.base32, otpauth_url: secret.otpauth_url, qrDataURL };
}

export async function verifyTOTP(token: string, secret: string): Promise<boolean> {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1, // allow 1 step before or after
  });
}

export function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // 8-char alphanumeric codes
    const code = crypto.randomBytes(4).toString("hex"); // 8 hex chars
    codes.push(code);
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]) {
  const hashed = [];
  for (const code of codes) {
    const h = await bcrypt.hash(code, 10);
    hashed.push({ codeHash: h });
  }
  return hashed;
}

export async function verifyBackupCode(code: string, storedHashes: { codeHash: string }[]) {
  for (let i = 0; i < storedHashes.length; i++) {
    if (await bcrypt.compare(code, storedHashes[i].codeHash)) {
      return i; // index matched
    }
  }
  return -1;
}

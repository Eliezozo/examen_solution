import { FedaPay, Webhook } from "fedapay";

export function getFedapayBaseUrl() {
  const isLive = process.env.FEDAPAY_ENV === "live";
  return isLive ? "https://api.fedapay.com/v1" : "https://sandbox-api.fedapay.com/v1";
}

export function getFedapaySecretKey() {
  const key = process.env.FEDAPAY_SECRET_KEY;
  if (!key) {
    throw new Error("FEDAPAY_SECRET_KEY manquant");
  }
  return key;
}

export function getFedapayWebhookSecret() {
  const key = process.env.FEDAPAY_WEBHOOK_SECRET;
  if (!key) {
    throw new Error("FEDAPAY_WEBHOOK_SECRET manquant");
  }
  return key;
}

export function getFedapayAppBaseUrl() {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_APP_URL manquant");
  }
  return url.replace(/\/$/, "");
}

export function createFedapayClient() {
  const env = process.env.FEDAPAY_ENV === "live" ? "live" : "sandbox";
  FedaPay.setApiKey(getFedapaySecretKey());
  FedaPay.setEnvironment(env);
}

export function verifyFedapayWebhook(rawBody: string, signatureHeader: string) {
  createFedapayClient();
  return Webhook.constructEvent(rawBody, signatureHeader, getFedapayWebhookSecret());
}

export async function fedapayRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getFedapayBaseUrl();
  const secretKey = getFedapaySecretKey();
  const url = `${baseUrl}${path}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message = payload?.message || payload?.error || `FedaPay API error ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fedapayRequest, getFedapayAppBaseUrl } from "@/lib/fedapay";

type PlanId = "pass_monthly" | "pass_yearly";
type TutorGender = "female" | "male";

type PaymentRequest = {
  userId?: string;
  fullName?: string;
  phone?: string;
  classe?: string;
  plan?: PlanId;
  recommenderPhone?: string;
  tutorGender?: TutorGender;
};

type FedaPayTransactionCreateResponse = {
  "v1/transaction"?: {
    id?: number;
    reference?: string;
    payment_url?: string;
    payment_token?: string;
  };
  data?: {
    id?: number;
    reference?: string;
    payment_url?: string;
    payment_token?: string;
  };
  transaction?: {
    id?: number;
    reference?: string;
    payment_url?: string;
    payment_token?: string;
  };
  v1?: {
    id?: number;
    reference?: string;
    url?: string;
    token?: string;
    payment_url?: string;
    payment_token?: string;
  };
  id?: number;
  reference?: string;
  payment_url?: string;
  payment_token?: string;
};

type FedaPayTokenCreateResponse = {
  data?: {
    url?: string;
    token?: string;
  };
  payment_url?: string;
  url?: string;
  token?: string;
  v1?: {
    url?: string;
    token?: string;
  };
};

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AnyRecord;
}

function coerceTransactionId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function coerceString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function deepFindTransactionCandidate(
  input: unknown,
  depth = 0
): { id: number | null; reference: string | null; paymentUrl: string | null } | null {
  if (depth > 5) return null;
  const obj = asRecord(input);
  if (!obj) return null;

  const id = coerceTransactionId(obj.id);
  const reference = coerceString(obj.reference);
  const paymentUrl = coerceString(obj.payment_url) ?? coerceString(obj.url);

  if (id !== null || reference || paymentUrl) {
    return { id, reference: reference ?? null, paymentUrl: paymentUrl ?? null };
  }

  for (const value of Object.values(obj)) {
    const nested = deepFindTransactionCandidate(value, depth + 1);
    if (nested && (nested.id !== null || nested.reference || nested.paymentUrl)) {
      return nested;
    }
  }

  return null;
}

function pickTransactionId(payload: FedaPayTransactionCreateResponse) {
  const primary =
    payload?.["v1/transaction"]?.id ??
    payload?.v1?.id ??
    payload?.id ??
    payload?.data?.id ??
    payload?.transaction?.id ??
    null;
  const coercedPrimary = coerceTransactionId(primary);
  if (coercedPrimary !== null) return coercedPrimary;

  const deep = deepFindTransactionCandidate(payload);
  return deep?.id ?? null;
}

function pickTransactionReference(payload: FedaPayTransactionCreateResponse) {
  const primary =
    payload?.["v1/transaction"]?.reference ??
    payload?.v1?.reference ??
    payload?.reference ??
    payload?.data?.reference ??
    payload?.transaction?.reference ??
    null;
  if (primary) return primary;

  const deep = deepFindTransactionCandidate(payload);
  return deep?.reference ?? null;
}

function pickPaymentUrl(payload: FedaPayTokenCreateResponse) {
  return (
    payload?.url ??
    payload?.v1?.url ??
    payload?.payment_url ??
    payload?.data?.url ??
    null
  );
}

function pickPaymentUrlFromTransaction(payload: FedaPayTransactionCreateResponse) {
  const primary = (
    payload?.["v1/transaction"]?.payment_url ??
    payload?.payment_url ??
    payload?.v1?.payment_url ??
    payload?.v1?.url ??
    payload?.data?.payment_url ??
    payload?.transaction?.payment_url ??
    null
  );
  if (primary) return primary;

  const deep = deepFindTransactionCandidate(payload);
  return deep?.paymentUrl ?? null;
}

const TOGO_PHONE_REGEX = /^\+228 [0-9]{8}$/;

const PLAN_CONFIG: Record<PlanId, { label: string; amount: number; days: number }> = {
  pass_monthly: { label: "Pass Mensuel", amount: 500, days: 30 },
  pass_yearly: { label: "Pass Annuel", amount: 1000, days: 365 },
};

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          error:
            "Variables d'environnement manquantes: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 }
      );
    }

    const { userId, fullName, phone, classe, plan, recommenderPhone, tutorGender }: PaymentRequest = await req.json();

    if (!userId || !fullName?.trim() || !phone || !plan || !PLAN_CONFIG[plan]) {
      return NextResponse.json({ error: "Données paiement invalides." }, { status: 400 });
    }
    if (!TOGO_PHONE_REGEX.test(phone)) {
      return NextResponse.json(
        { error: "Numéro invalide. Format requis: +228 XXXXXXXX" },
        { status: 400 }
      );
    }
    if (recommenderPhone && !TOGO_PHONE_REGEX.test(recommenderPhone)) {
      return NextResponse.json(
        { error: "Numéro du parrain invalide. Format requis: +228 XXXXXXXX" },
        { status: 400 }
      );
    }
    if (recommenderPhone && recommenderPhone === phone) {
      return NextResponse.json(
        { error: "Tu ne peux pas te parrainer toi-même." },
        { status: 400 }
      );
    }

    const normalizedTutorGender: TutorGender = tutorGender === "male" ? "male" : "female";

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const profilePayload = {
      id: userId,
      full_name: fullName.trim(),
      phone,
      classe: classe ?? null,
      preferred_tutor_gender: normalizedTutorGender,
    };

    const { error: profileError } = await supabase.from("profiles").upsert(profilePayload, {
      onConflict: "id",
    });

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const planInfo = PLAN_CONFIG[plan];
    const callbackUrl = `${getFedapayAppBaseUrl()}/?payment=return`;

    const transactionBody = {
      description: `${planInfo.label} - Réussite Togo APC`,
      amount: planInfo.amount,
      callback_url: callbackUrl,
      currency: { iso: "XOF" },
      metadata: {
        app: "reussite-togo-apc",
        user_id: userId,
        full_name: fullName.trim(),
        phone,
        classe: classe ?? null,
        plan,
        tutor_gender: normalizedTutorGender,
        recommender_phone: recommenderPhone ?? null,
      },
    };

    const transactionResponse = await fedapayRequest<FedaPayTransactionCreateResponse>("/transactions", {
      method: "POST",
      body: JSON.stringify(transactionBody),
    });

    const fedapayTransactionId = pickTransactionId(transactionResponse);
    const fedapayReference = pickTransactionReference(transactionResponse);

    if (!fedapayTransactionId) {
      return NextResponse.json(
        {
          error:
            "Impossible de récupérer l'identifiant de transaction FedaPay depuis la réponse API.",
          diagnostics: {
            env: process.env.FEDAPAY_ENV === "live" ? "live" : "sandbox",
            hasSecretKey: Boolean(process.env.FEDAPAY_SECRET_KEY),
          },
          fedapayResponse: transactionResponse,
        },
        { status: 500 }
      );
    }

    let tokenResponse: FedaPayTokenCreateResponse | null = null;
    let paymentUrl = pickPaymentUrlFromTransaction(transactionResponse);
    if (!paymentUrl) {
      tokenResponse = await fedapayRequest<FedaPayTokenCreateResponse>(
        `/transactions/${fedapayTransactionId}/token`,
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );
      paymentUrl = pickPaymentUrl(tokenResponse);
    }

    if (!paymentUrl) {
      return NextResponse.json(
        {
          error: "Impossible de générer l'URL de paiement FedaPay (token invalide).",
          fedapayTokenResponse: tokenResponse ?? null,
          fedapayTransactionResponse: transactionResponse,
        },
        { status: 500 }
      );
    }

    const { error: transactionInsertError } = await supabase.from("payment_transactions").insert({
      user_id: userId,
      fedapay_transaction_id: fedapayTransactionId,
      fedapay_reference: fedapayReference,
      status: "pending",
      plan_id: plan,
      plan_amount: planInfo.amount,
      full_name: fullName.trim(),
      phone,
      classe: classe ?? null,
      tutor_gender: normalizedTutorGender,
      recommender_phone: recommenderPhone ?? null,
      raw_payload: {
        request: transactionBody,
        transaction_response: transactionResponse,
        token_response: tokenResponse,
      },
    });

    if (transactionInsertError) {
      return NextResponse.json({ error: transactionInsertError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      plan,
      planLabel: planInfo.label,
      amount: planInfo.amount,
      paymentProvider: "FedaPay",
      paymentUrl,
      transactionId: fedapayTransactionId,
      reference: fedapayReference,
      message: "Redirection vers FedaPay pour le paiement.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur serveur.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

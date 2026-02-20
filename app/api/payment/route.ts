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
  v1?: {
    id?: number;
    reference?: string;
  };
  id?: number;
  reference?: string;
};

type FedaPayTokenCreateResponse = {
  url?: string;
  token?: string;
  v1?: {
    url?: string;
    token?: string;
  };
};

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

    const fedapayTransactionId = transactionResponse?.v1?.id ?? transactionResponse?.id;
    const fedapayReference = transactionResponse?.v1?.reference ?? transactionResponse?.reference ?? null;

    if (!fedapayTransactionId) {
      return NextResponse.json(
        { error: "Impossible de créer la transaction FedaPay." },
        { status: 500 }
      );
    }

    const tokenResponse = await fedapayRequest<FedaPayTokenCreateResponse>(
      `/transactions/${fedapayTransactionId}/token`,
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );

    const paymentUrl = tokenResponse?.url ?? tokenResponse?.v1?.url;

    if (!paymentUrl) {
      return NextResponse.json(
        { error: "Impossible de générer l'URL de paiement FedaPay." },
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

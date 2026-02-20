import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyFedapayWebhook } from "@/lib/fedapay";

type PaymentTxRow = {
  id: string;
  user_id: string;
  fedapay_transaction_id: number;
  status: string;
  plan_id: "pass_monthly" | "pass_yearly";
  plan_amount: number;
  full_name: string;
  phone: string;
  classe: string | null;
  tutor_gender: "female" | "male";
  recommender_phone: string | null;
  premium_until: string | null;
};

const PLAN_DAYS: Record<"pass_monthly" | "pass_yearly", number> = {
  pass_monthly: 30,
  pass_yearly: 365,
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

    const signature = req.headers.get("x-fedapay-signature");
    if (!signature) {
      return NextResponse.json({ error: "Signature webhook manquante." }, { status: 400 });
    }

    const rawBody = await req.text();
    const event = verifyFedapayWebhook(rawBody, signature) as {
      name?: string;
      object_id?: number;
      entity?: { id?: number; status?: string };
      [k: string]: unknown;
    };

    const fedapayTransactionId = event?.entity?.id ?? event?.object_id;
    if (!fedapayTransactionId) {
      return NextResponse.json({ ok: true, ignored: true, reason: "no-transaction-id" });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: tx, error: txError } = await supabase
      .from("payment_transactions")
      .select(
        "id, user_id, fedapay_transaction_id, status, plan_id, plan_amount, full_name, phone, classe, tutor_gender, recommender_phone, premium_until"
      )
      .eq("fedapay_transaction_id", fedapayTransactionId)
      .maybeSingle<PaymentTxRow>();

    if (txError) {
      return NextResponse.json({ error: txError.message }, { status: 500 });
    }

    if (!tx) {
      return NextResponse.json({ ok: true, ignored: true, reason: "transaction-not-found" });
    }

    const status = (event?.entity?.status || "").toLowerCase();
    const eventName = (event?.name || "").toLowerCase();
    const approved = status === "approved" || eventName.includes("approved");

    if (!approved) {
      const nextStatus = status || "pending";
      await supabase
        .from("payment_transactions")
        .update({ status: nextStatus, raw_payload: event })
        .eq("id", tx.id);
      return NextResponse.json({ ok: true, status: nextStatus });
    }

    if (tx.status === "approved") {
      return NextResponse.json({ ok: true, idempotent: true });
    }

    const { data: profile, error: profileReadError } = await supabase
      .from("profiles")
      .select("premium_until")
      .eq("id", tx.user_id)
      .maybeSingle();

    if (profileReadError) {
      return NextResponse.json({ error: profileReadError.message }, { status: 500 });
    }

    const now = new Date();
    const currentPremiumUntil = profile?.premium_until ? new Date(profile.premium_until as string) : null;
    const baseDate = currentPremiumUntil && currentPremiumUntil > now ? currentPremiumUntil : now;

    const premiumUntil = new Date(baseDate);
    premiumUntil.setDate(premiumUntil.getDate() + PLAN_DAYS[tx.plan_id]);

    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .update({
        is_premium: true,
        premium_until: premiumUntil.toISOString(),
        preferred_tutor_gender: tx.tutor_gender,
      })
      .eq("id", tx.user_id);

    if (profileUpdateError) {
      return NextResponse.json({ error: profileUpdateError.message }, { status: 500 });
    }

    const { error: txUpdateError } = await supabase
      .from("payment_transactions")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        premium_until: premiumUntil.toISOString(),
        raw_payload: event,
      })
      .eq("id", tx.id);

    if (txUpdateError) {
      return NextResponse.json({ error: txUpdateError.message }, { status: 500 });
    }

    const { error: payerNotificationError } = await supabase.from("notifications").insert({
      user_id: tx.user_id,
      title: "Paiement confirmé",
      message: `Ton paiement ${tx.plan_amount}F est confirmé. Ton accès premium est actif.`,
      metadata: {
        plan_id: tx.plan_id,
        plan_amount: tx.plan_amount,
        premium_until: premiumUntil.toISOString(),
      },
    });

    if (payerNotificationError) {
      return NextResponse.json({ error: payerNotificationError.message }, { status: 500 });
    }

    if (tx.recommender_phone && tx.recommender_phone !== tx.phone) {
      const { data: referrerProfile, error: referrerError } = await supabase
        .from("profiles")
        .select("id, referral_balance, total_referral_earnings")
        .eq("phone", tx.recommender_phone)
        .maybeSingle();

      if (referrerError) {
        return NextResponse.json({ error: referrerError.message }, { status: 500 });
      }

      if (referrerProfile && referrerProfile.id !== tx.user_id) {
        const commissionAmount = Math.round(tx.plan_amount * 0.1);

        const { error: commissionInsertError } = await supabase
          .from("referral_commissions")
          .insert({
            payment_transaction_id: tx.id,
            referrer_user_id: referrerProfile.id,
            payer_user_id: tx.user_id,
            payer_phone: tx.phone,
            plan_id: tx.plan_id,
            plan_amount: tx.plan_amount,
            commission_amount: commissionAmount,
            payout_phone: tx.recommender_phone,
            payout_status: "paid",
          });

        if (!commissionInsertError) {
          const { error: referrerUpdateError } = await supabase
            .from("profiles")
            .update({
              referral_balance: (referrerProfile.referral_balance ?? 0) + commissionAmount,
              total_referral_earnings:
                (referrerProfile.total_referral_earnings ?? 0) + commissionAmount,
            })
            .eq("id", referrerProfile.id);

          if (referrerUpdateError) {
            return NextResponse.json({ error: referrerUpdateError.message }, { status: 500 });
          }

          const { error: referrerNotificationError } = await supabase.from("notifications").insert({
            user_id: referrerProfile.id,
            title: "Nouveau gain de parrainage",
            message: `Tu as reçu ${commissionAmount}F suite à un paiement confirmé.`,
            metadata: {
              payment_transaction_id: tx.id,
              payer_phone: tx.phone,
              plan_amount: tx.plan_amount,
              commission_amount: commissionAmount,
            },
          });

          if (referrerNotificationError) {
            return NextResponse.json({ error: referrerNotificationError.message }, { status: 500 });
          }
        }
      }
    }

    return NextResponse.json({ ok: true, approved: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur serveur.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type PlanId = "pass_monthly" | "pass_yearly";
type TutorGender = "female" | "male";

type ManualPremiumPayload = {
  userId?: string;
  adminKey?: string;
  plan?: PlanId;
  days?: number;
  amount?: number;
  note?: string;
};

const PLAN_CONFIG: Record<PlanId, { days: number; amount: number; label: string }> = {
  pass_monthly: { days: 30, amount: 500, label: "Pass Mensuel" },
  pass_yearly: { days: 365, amount: 1000, label: "Pass Annuel" },
};

function buildManualFedapayTransactionId() {
  const seed = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  return -seed;
}

function getAdminKey(req: Request, bodyAdminKey?: string) {
  const headerKey = req.headers.get("x-admin-key");
  if (headerKey?.trim()) return headerKey.trim();
  if (bodyAdminKey?.trim()) return bodyAdminKey.trim();
  return "";
}

export async function POST(req: Request) {
  try {
    const expectedAdminKey = process.env.MANUAL_PREMIUM_ADMIN_KEY;
    if (!expectedAdminKey) {
      return NextResponse.json(
        { error: "MANUAL_PREMIUM_ADMIN_KEY manquant." },
        { status: 500 }
      );
    }

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

    const payload: ManualPremiumPayload = await req.json();
    const adminKey = getAdminKey(req, payload.adminKey);
    if (adminKey !== expectedAdminKey) {
      return NextResponse.json({ error: "Accès refusé." }, { status: 401 });
    }

    if (!payload.userId) {
      return NextResponse.json({ error: "userId requis." }, { status: 400 });
    }

    const plan: PlanId = payload.plan === "pass_yearly" ? "pass_yearly" : "pass_monthly";
    const daysFromPlan = PLAN_CONFIG[plan].days;
    const manualDays =
      typeof payload.days === "number" && Number.isFinite(payload.days)
        ? Math.floor(payload.days)
        : daysFromPlan;
    if (manualDays <= 0) {
      return NextResponse.json({ error: "days doit être > 0." }, { status: 400 });
    }

    const manualAmount =
      typeof payload.amount === "number" && Number.isFinite(payload.amount)
        ? Math.max(0, Math.floor(payload.amount))
        : PLAN_CONFIG[plan].amount;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, phone, classe, preferred_tutor_gender, premium_until")
      .eq("id", payload.userId)
      .maybeSingle<{
        id: string;
        full_name: string | null;
        phone: string | null;
        classe: string | null;
        preferred_tutor_gender: TutorGender | null;
        premium_until: string | null;
      }>();

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ error: "Profil introuvable pour ce userId." }, { status: 404 });
    }

    const now = new Date();
    const currentPremiumUntil = profile.premium_until ? new Date(profile.premium_until) : null;
    const baseDate = currentPremiumUntil && currentPremiumUntil > now ? currentPremiumUntil : now;
    const premiumUntil = new Date(baseDate);
    premiumUntil.setDate(premiumUntil.getDate() + manualDays);
    const premiumUntilIso = premiumUntil.toISOString();

    const { error: premiumUpdateError } = await supabase
      .from("profiles")
      .update({
        is_premium: true,
        premium_until: premiumUntilIso,
      })
      .eq("id", payload.userId);

    if (premiumUpdateError) {
      return NextResponse.json({ error: premiumUpdateError.message }, { status: 500 });
    }

    let transactionInsertError: Error | null = null;
    let fedapayTransactionId = buildManualFedapayTransactionId();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { error } = await supabase.from("payment_transactions").insert({
        user_id: payload.userId,
        fedapay_transaction_id: fedapayTransactionId,
        fedapay_reference: `manual_${Date.now()}`,
        status: "approved",
        plan_id: plan,
        plan_amount: manualAmount,
        full_name: profile.full_name ?? "Activation manuelle",
        phone: profile.phone ?? "N/A",
        classe: profile.classe ?? null,
        tutor_gender: profile.preferred_tutor_gender ?? "female",
        recommender_phone: null,
        premium_until: premiumUntilIso,
        approved_at: new Date().toISOString(),
        raw_payload: {
          source: "manual-admin",
          note: payload.note ?? null,
          granted_days: manualDays,
        },
      });

      if (!error) {
        transactionInsertError = null;
        break;
      }

      transactionInsertError = new Error(error.message);
      fedapayTransactionId = buildManualFedapayTransactionId();
    }

    if (transactionInsertError) {
      return NextResponse.json({ error: transactionInsertError.message }, { status: 500 });
    }

    await supabase.from("notifications").insert({
      user_id: payload.userId,
      title: "Premium activé manuellement",
      message: `Ton premium est actif jusqu'au ${new Date(premiumUntilIso).toLocaleDateString("fr-FR")}.`,
      metadata: {
        source: "manual-admin",
        plan,
        days: manualDays,
      },
    });

    return NextResponse.json({
      ok: true,
      userId: payload.userId,
      plan,
      amount: manualAmount,
      daysAdded: manualDays,
      premiumUntil: premiumUntilIso,
      message: "Compte premium activé manuellement.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur serveur.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

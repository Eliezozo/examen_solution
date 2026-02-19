import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type PlanId = "pass_monthly" | "pass_yearly";

type PaymentRequest = {
  userId?: string;
  fullName?: string;
  phone?: string;
  classe?: string;
  plan?: PlanId;
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

    const { userId, fullName, phone, classe, plan }: PaymentRequest = await req.json();

    if (!userId || !fullName?.trim() || !phone || !plan || !PLAN_CONFIG[plan]) {
      return NextResponse.json({ error: "Données paiement invalides." }, { status: 400 });
    }
    if (!TOGO_PHONE_REGEX.test(phone)) {
      return NextResponse.json(
        { error: "Numéro invalide. Format requis: +228 XXXXXXXX" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const now = new Date();

    const { data: existingProfile, error: profileReadError } = await supabase
      .from("profiles")
      .select("id, premium_until")
      .eq("id", userId)
      .maybeSingle();

    if (profileReadError) {
      return NextResponse.json({ error: profileReadError.message }, { status: 500 });
    }

    const currentPremiumUntil = existingProfile?.premium_until
      ? new Date(existingProfile.premium_until as string)
      : null;

    const baseDate =
      currentPremiumUntil && currentPremiumUntil > now ? currentPremiumUntil : now;

    const premiumUntil = new Date(baseDate);
    premiumUntil.setDate(premiumUntil.getDate() + PLAN_CONFIG[plan].days);

    const payload = {
      id: userId,
      full_name: fullName.trim(),
      phone,
      classe: classe ?? null,
      is_premium: true,
      premium_until: premiumUntil.toISOString(),
    };

    const { error: upsertError } = await supabase.from("profiles").upsert(payload, {
      onConflict: "id",
    });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      paymentProvider: "FedaPay (Simulation)",
      method: "T-Money / Moov Money",
      plan,
      planLabel: PLAN_CONFIG[plan].label,
      amount: PLAN_CONFIG[plan].amount,
      premiumUntil: premiumUntil.toISOString(),
      premiumActive: true,
      fullName: fullName.trim(),
      welcomeMessage: `Bienvenue ${fullName.trim()} sur Réussite Togo APC.`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur serveur.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

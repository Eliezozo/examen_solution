import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type AdminPatchPayload = {
  userId?: string;
  grantPremium?: boolean;
  days?: number;
  note?: string;
};

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey);
}

function getProvidedAdminKey(req: Request, bodyAdminKey?: string) {
  const fromHeader = req.headers.get("x-admin-key");
  if (fromHeader?.trim()) return fromHeader.trim();
  if (bodyAdminKey?.trim()) return bodyAdminKey.trim();

  const { searchParams } = new URL(req.url);
  return searchParams.get("adminKey")?.trim() ?? "";
}

function buildManualFedapayTransactionId() {
  const seed = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  return -seed;
}

function ensureAdminAccess(req: Request, bodyAdminKey?: string) {
  const expectedAdminKey = process.env.MANUAL_PREMIUM_ADMIN_KEY;
  if (!expectedAdminKey) {
    return { ok: false as const, status: 500, error: "MANUAL_PREMIUM_ADMIN_KEY manquant." };
  }

  const provided = getProvidedAdminKey(req, bodyAdminKey);
  if (provided !== expectedAdminKey) {
    return { ok: false as const, status: 401, error: "Accès refusé." };
  }

  return { ok: true as const };
}

export async function GET(req: Request) {
  const auth = ensureAdminAccess(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Variables d'environnement manquantes: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const premiumOnly = searchParams.get("premiumOnly") === "1";
  const limitRaw = Number(searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 200) : 100;

  let query = supabase
    .from("profiles")
    .select(
      "id, full_name, phone, classe, is_premium, premium_until, referral_balance, total_referral_earnings, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (premiumOnly) {
    query = query.eq("is_premium", true);
  }

  if (q) {
    query = query.or(
      `full_name.ilike.%${q.replace(/,/g, "")}%,phone.ilike.%${q.replace(/,/g, "")}%`
    );
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data ?? [] });
}

export async function PATCH(req: Request) {
  const payload = (await req.json()) as AdminPatchPayload & { adminKey?: string };
  const auth = ensureAdminAccess(req, payload.adminKey);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Variables d'environnement manquantes: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const userId = payload.userId?.trim();
  if (!userId) {
    return NextResponse.json({ error: "userId requis." }, { status: 400 });
  }

  const grantPremium = payload.grantPremium !== false;
  const days = Number.isFinite(payload.days) ? Math.max(1, Math.floor(payload.days ?? 30)) : 30;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, phone, classe, preferred_tutor_gender, premium_until")
    .eq("id", userId)
    .maybeSingle<{
      id: string;
      full_name: string | null;
      phone: string | null;
      classe: string | null;
      preferred_tutor_gender: "female" | "male" | null;
      premium_until: string | null;
    }>();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "Utilisateur introuvable." }, { status: 404 });
  }

  if (!grantPremium) {
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ is_premium: false, premium_until: null })
      .eq("id", userId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await supabase.from("notifications").insert({
      user_id: userId,
      title: "Premium retiré",
      message: "Ton accès premium a été désactivé par l'administration.",
      metadata: { source: "admin-panel", note: payload.note ?? null },
    });

    return NextResponse.json({ ok: true, userId, isPremium: false, premiumUntil: null });
  }

  const now = new Date();
  const currentPremiumUntil = profile.premium_until ? new Date(profile.premium_until) : null;
  const baseDate = currentPremiumUntil && currentPremiumUntil > now ? currentPremiumUntil : now;
  const premiumUntil = new Date(baseDate);
  premiumUntil.setDate(premiumUntil.getDate() + days);
  const premiumUntilIso = premiumUntil.toISOString();

  const { error: premiumError } = await supabase
    .from("profiles")
    .update({ is_premium: true, premium_until: premiumUntilIso })
    .eq("id", userId);

  if (premiumError) {
    return NextResponse.json({ error: premiumError.message }, { status: 500 });
  }

  let txErrorMessage: string | null = null;
  let fedapayTransactionId = buildManualFedapayTransactionId();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await supabase.from("payment_transactions").insert({
      user_id: userId,
      fedapay_transaction_id: fedapayTransactionId,
      fedapay_reference: `admin_${Date.now()}`,
      status: "approved",
      plan_id: days >= 365 ? "pass_yearly" : "pass_monthly",
      plan_amount: days >= 365 ? 1000 : 500,
      full_name: profile.full_name ?? "Activation admin",
      phone: profile.phone ?? "N/A",
      classe: profile.classe ?? null,
      tutor_gender: profile.preferred_tutor_gender ?? "female",
      recommender_phone: null,
      premium_until: premiumUntilIso,
      approved_at: new Date().toISOString(),
      raw_payload: {
        source: "admin-panel",
        granted_days: days,
        note: payload.note ?? null,
      },
    });

    if (!error) {
      txErrorMessage = null;
      break;
    }

    txErrorMessage = error.message;
    fedapayTransactionId = buildManualFedapayTransactionId();
  }

  if (txErrorMessage) {
    return NextResponse.json({ error: txErrorMessage }, { status: 500 });
  }

  await supabase.from("notifications").insert({
    user_id: userId,
    title: "Premium activé",
    message: `Ton premium est actif jusqu'au ${new Date(premiumUntilIso).toLocaleDateString("fr-FR")}.`,
    metadata: { source: "admin-panel", granted_days: days, note: payload.note ?? null },
  });

  return NextResponse.json({
    ok: true,
    userId,
    isPremium: true,
    premiumUntil: premiumUntilIso,
    daysAdded: days,
  });
}

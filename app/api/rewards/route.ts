import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET(req: Request) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json(
        {
          error:
            "Variables d'environnement manquantes: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "userId requis." }, { status: 400 });
    }

    const { data: notifications, error: notificationsError } = await supabase
      .from("notifications")
      .select("id, title, message, metadata, is_read, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (notificationsError) {
      return NextResponse.json({ error: notificationsError.message }, { status: 500 });
    }

    const { data: commissions, error: commissionsError } = await supabase
      .from("referral_commissions")
      .select(
        "id, payer_phone, plan_id, plan_amount, commission_amount, payout_phone, payout_status, created_at"
      )
      .eq("referrer_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (commissionsError) {
      return NextResponse.json({ error: commissionsError.message }, { status: 500 });
    }

    return NextResponse.json({
      notifications: notifications ?? [],
      commissions: commissions ?? [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur serveur.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type ProfilePayload = {
  userId?: string;
  fullName?: string;
  phone?: string;
  classe?: string;
  themeColor?: "green" | "blue" | "orange" | "red" | "black";
  tutorGender?: "female" | "male";
};

const TOGO_PHONE_REGEX = /^\+228 [0-9]{8}$/;
const ALLOWED_THEME_COLORS = new Set(["green", "blue", "orange", "red", "black"]);
const ALLOWED_TUTOR_GENDERS = new Set(["female", "male"]);

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
        { error: "Variables d'environnement manquantes: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "userId requis." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, full_name, phone, classe, theme_color, preferred_tutor_gender, referral_balance, total_referral_earnings, is_premium, premium_until"
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data ?? null });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur serveur.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json(
        { error: "Variables d'environnement manquantes: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const { userId, fullName, phone, classe, themeColor, tutorGender }: ProfilePayload = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "userId requis." }, { status: 400 });
    }

    if (phone && !TOGO_PHONE_REGEX.test(phone)) {
      return NextResponse.json(
        { error: "Numéro invalide. Format requis: +228 XXXXXXXX" },
        { status: 400 }
      );
    }
    if (themeColor && !ALLOWED_THEME_COLORS.has(themeColor)) {
      return NextResponse.json(
        { error: "Couleur invalide." },
        { status: 400 }
      );
    }
    if (tutorGender && !ALLOWED_TUTOR_GENDERS.has(tutorGender)) {
      return NextResponse.json(
        { error: "Préférence tuteur invalide." },
        { status: 400 }
      );
    }

    const updatePayload: {
      full_name?: string | null;
      phone?: string | null;
      classe?: string | null;
      theme_color?: "green" | "blue" | "orange" | "red" | "black";
      preferred_tutor_gender?: "female" | "male";
    } = {};

    if (typeof fullName === "string") {
      updatePayload.full_name = fullName.trim() || null;
    }
    if (typeof phone === "string") {
      updatePayload.phone = phone.trim() || null;
    }
    if (typeof classe === "string") {
      updatePayload.classe = classe.trim() || null;
    }
    if (themeColor) {
      updatePayload.theme_color = themeColor;
    }
    if (tutorGender) {
      updatePayload.preferred_tutor_gender = tutorGender;
    }

    const { data, error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          ...updatePayload,
        },
        { onConflict: "id" }
      )
      .select(
        "id, full_name, phone, classe, theme_color, preferred_tutor_gender, referral_balance, total_referral_earnings, is_premium, premium_until"
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, profile: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur serveur.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

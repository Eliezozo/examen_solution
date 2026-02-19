import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_PROMPT = `
Tu es un tuteur IA pour les élèves togolais (CM2, 3ème, 1ère).
Tu dois répondre STRICTEMENT selon la démarche APC en 3 sections obligatoires:
1) Analyse de la situation-problème
2) Mobilisation des ressources (rappels de cours, notions, formules)
3) Résolution pas à pas + vérification finale

Contraintes:
- Langue: français simple et pédagogique.
- Réponse courte: maximum 120 mots.
- Phrases courtes et faciles (niveau élève).
- Aller directement à l'essentiel, sans longs paragraphes.
- Adapter le niveau à la classe indiquée.
- Encourager l'autonomie de l'élève.
- Donner des exemples liés au contexte togolais quand pertinent.
- Si image d'exercice floue, demander une photo plus nette avant de résoudre.
- Ne jamais donner une réponse brute sans explication APC.
`;

type ChatRequest = {
  userId?: string;
  phone?: string;
  classe?: string;
  domaine?: string;
  matiere?: string;
  message?: string;
  imageBase64?: string;
  imageMimeType?: string;
};

const TOGO_PHONE_REGEX = /^\+228 [0-9]{8}$/;

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!supabaseUrl || !serviceRoleKey || !geminiApiKey) {
      return NextResponse.json(
        {
          error:
            "Variables d'environnement manquantes: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const genAI = new GoogleGenerativeAI(geminiApiKey);

    const { userId, phone, classe, domaine, matiere, message, imageBase64, imageMimeType }: ChatRequest =
      await req.json();

    if (!userId || (!message && !imageBase64)) {
      return NextResponse.json({ error: "Données insuffisantes." }, { status: 400 });
    }
    if (phone && !TOGO_PHONE_REGEX.test(phone)) {
      return NextResponse.json(
        { error: "Numéro invalide. Format requis: +228 XXXXXXXX" },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id, full_name, phone, classe, is_premium, premium_until")
      .eq("id", userId)
      .maybeSingle();

    let profile = existingProfile;

    if (!profile) {
      const { data: insertedProfile, error: insertProfileError } = await supabase
        .from("profiles")
        .insert({
          id: userId,
          phone: phone ?? null,
          classe: classe ?? null,
          full_name: null,
          is_premium: false,
          premium_until: null,
        })
        .select("id, full_name, phone, classe, is_premium, premium_until")
        .single();

      if (insertProfileError) {
        return NextResponse.json({ error: insertProfileError.message }, { status: 500 });
      }

      profile = insertedProfile;
    }

    if (profile && (phone || classe)) {
      const nextPhone = phone ?? profile.phone ?? null;
      const nextClasse = classe ?? profile.classe ?? null;
      if (nextPhone !== profile.phone || nextClasse !== profile.classe) {
        const { data: updatedProfile } = await supabase
          .from("profiles")
          .update({ phone: nextPhone, classe: nextClasse })
          .eq("id", userId)
          .select("id, full_name, phone, classe, is_premium, premium_until")
          .single();
        if (updatedProfile) {
          profile = updatedProfile;
        }
      }
    }

    const premiumActive =
      Boolean(profile?.is_premium) &&
      Boolean(profile?.premium_until) &&
      new Date(profile.premium_until as string) > new Date(nowIso);

    const { count: usedCount, error: countError } = await supabase
      .from("history")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    const freeLimit = 2;
    const freeUsed = usedCount ?? 0;
    const freeLeft = Math.max(0, freeLimit - freeUsed);

    if (!premiumActive && freeUsed >= freeLimit) {
      return NextResponse.json(
        {
          requiresPayment: true,
          message: "Pass requis.",
          freeLeft,
          premiumActive: false,
          premiumUntil: profile?.premium_until ?? null,
        },
        { status: 402 }
      );
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const userContext = `
Classe: ${classe || "Non précisée"}
Domaine: ${domaine || "Non précisé"}
Matière: ${matiere || "Non précisée"}
Question: ${message || "Voir image envoyée"}
`;

    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
      { text: `${SYSTEM_PROMPT}\n\n${userContext}` },
    ];

    if (imageBase64) {
      parts.push({
        inlineData: {
          data: imageBase64,
          mimeType: imageMimeType || "image/jpeg",
        },
      });
    }

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
    });

    const responseText = result.response.text() || "Je n'ai pas pu générer une réponse.";

    const { error: historyError } = await supabase.from("history").insert({
      user_id: userId,
      message: message ?? "",
      response: responseText,
      image_url: null,
    });

    if (historyError) {
      return NextResponse.json({ error: historyError.message }, { status: 500 });
    }

    return NextResponse.json({
      response: responseText,
      freeLeft: premiumActive ? freeLeft : Math.max(0, freeLeft - 1),
      premiumActive,
      premiumUntil: profile?.premium_until ?? null,
      fullName: profile?.full_name ?? null,
      phone: profile?.phone ?? null,
      classe: profile?.classe ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur serveur.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

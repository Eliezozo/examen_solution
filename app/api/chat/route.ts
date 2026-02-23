import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_PROMPT = `
Tu es un tuteur IA pour les élèves togolais (CM2, 3ème, 1ère, Terminale).
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
- Appeler l'élève par son vrai nom si disponible.
- Encourager l'autonomie de l'élève.
- Donner des exemples liés au contexte togolais quand pertinent.
- Si image d'exercice floue, demander une photo plus nette avant de résoudre.
- Ne jamais donner une réponse brute sans explication APC.
`;

type ChatRequest = {
  userId?: string;
  fullName?: string;
  phone?: string;
  classe?: string;
  domaine?: string;
  matiere?: string;
  message?: string;
  imageBase64?: string;
  imageMimeType?: string;
  attachments?: Array<{
    name?: string;
    mimeType?: string;
    base64?: string;
  }>;
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

    const { userId, fullName, phone, classe, domaine, matiere, message, imageBase64, imageMimeType, attachments }: ChatRequest =
      await req.json();
    const normalizedPhone = typeof phone === "string" ? phone.trim() : "";

    const normalizedAttachments = Array.isArray(attachments)
      ? attachments
          .filter(
            (item) =>
              typeof item?.base64 === "string" &&
              item.base64.length > 0 &&
              typeof item?.mimeType === "string" &&
              item.mimeType.length > 0
          )
          .slice(0, 3)
      : [];

    if (!userId || (!message && !imageBase64 && normalizedAttachments.length === 0)) {
      return NextResponse.json({ error: "Données insuffisantes." }, { status: 400 });
    }
    if (normalizedPhone && !TOGO_PHONE_REGEX.test(normalizedPhone)) {
      return NextResponse.json(
        { error: "Numéro invalide. Format requis: +228 XXXXXXXX" },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id, full_name, phone, classe, preferred_tutor_gender, is_premium, premium_until")
      .eq("id", userId)
      .maybeSingle();

    let profile = existingProfile;

    if (!profile) {
      const { data: insertedProfile, error: insertProfileError } = await supabase
        .from("profiles")
        .insert({
          id: userId,
          phone: normalizedPhone || null,
          classe: classe ?? null,
          full_name: null,
          preferred_tutor_gender: "female",
          is_premium: false,
          premium_until: null,
        })
        .select("id, full_name, phone, classe, preferred_tutor_gender, is_premium, premium_until")
        .single();

      if (insertProfileError) {
        return NextResponse.json({ error: insertProfileError.message }, { status: 500 });
      }

      profile = insertedProfile;
    }

    if (profile && (normalizedPhone || classe || typeof fullName === "string")) {
      const nextPhone = normalizedPhone || profile.phone || null;
      const nextClasse = classe ?? profile.classe ?? null;
      const nextFullName =
        typeof fullName === "string" ? (fullName.trim() || null) : (profile.full_name ?? null);
      if (
        nextPhone !== profile.phone ||
        nextClasse !== profile.classe ||
        nextFullName !== (profile.full_name ?? null)
      ) {
        const { data: updatedProfile } = await supabase
          .from("profiles")
          .update({ phone: nextPhone, classe: nextClasse, full_name: nextFullName })
          .eq("id", userId)
          .select("id, full_name, phone, classe, preferred_tutor_gender, is_premium, premium_until")
          .single();
        if (updatedProfile) {
          profile = updatedProfile;
        }
      }
    }

    let resolvedPremiumUntil = (profile?.premium_until as string | null) ?? null;
    let premiumActive =
      Boolean(profile?.is_premium) &&
      Boolean(resolvedPremiumUntil) &&
      new Date(resolvedPremiumUntil as string) > new Date(nowIso);

    // Fallback: si le profil est désynchronisé, on lit le dernier paiement approuvé non expiré.
    if (!premiumActive) {
      const { data: approvedTx, error: approvedTxError } = await supabase
        .from("payment_transactions")
        .select("premium_until")
        .eq("user_id", userId)
        .eq("status", "approved")
        .not("premium_until", "is", null)
        .gt("premium_until", nowIso)
        .order("premium_until", { ascending: false })
        .limit(1)
        .maybeSingle<{ premium_until: string | null }>();

      if (approvedTxError) {
        return NextResponse.json({ error: approvedTxError.message }, { status: 500 });
      }

      if (approvedTx?.premium_until) {
        resolvedPremiumUntil = approvedTx.premium_until;
        premiumActive = true;

        // Synchronisation profil pour éviter de retomber sur le cas au prochain appel.
        await supabase
          .from("profiles")
          .update({ is_premium: true, premium_until: resolvedPremiumUntil })
          .eq("id", userId);
      }
    }

    // Cas d'activation manuelle anticipée: premium attaché au téléphone avant 1ère session.
    if (!premiumActive && normalizedPhone) {
      const { data: phonePremiumProfile, error: phonePremiumProfileError } = await supabase
        .from("profiles")
        .select("id, premium_until")
        .eq("phone", normalizedPhone)
        .neq("id", userId)
        .eq("is_premium", true)
        .not("premium_until", "is", null)
        .gt("premium_until", nowIso)
        .order("premium_until", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; premium_until: string | null }>();

      if (phonePremiumProfileError) {
        return NextResponse.json({ error: phonePremiumProfileError.message }, { status: 500 });
      }

      if (phonePremiumProfile?.premium_until) {
        resolvedPremiumUntil = phonePremiumProfile.premium_until;
        premiumActive = true;

        await supabase
          .from("profiles")
          .update({ is_premium: true, premium_until: resolvedPremiumUntil })
          .eq("id", userId);
      }
    }

    const resolvedPhone = normalizedPhone || profile?.phone || "";
    if (!resolvedPhone || !TOGO_PHONE_REGEX.test(resolvedPhone)) {
      return NextResponse.json(
        { error: "Numéro requis et invalide. Format: +228 XXXXXXXX" },
        { status: 400 }
      );
    }

    // Anti-abus: le quota gratuit est calculé par numéro (tous comptes confondus).
    const { data: profileIds, error: profileIdsError } = await supabase
      .from("profiles")
      .select("id")
      .eq("phone", resolvedPhone);

    if (profileIdsError) {
      return NextResponse.json({ error: profileIdsError.message }, { status: 500 });
    }

    const idsFromPhone = (profileIds ?? []).map((item) => item.id).filter(Boolean);
    const idsForQuota = Array.from(new Set([userId, ...idsFromPhone]));

    const { count: usedCount, error: countError } = await supabase
      .from("history")
      .select("id", { count: "exact", head: true })
      .in("user_id", idsForQuota);

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
          premiumUntil: resolvedPremiumUntil,
        },
        { status: 402 }
      );
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const brevityByClasse =
      classe === "CM2" || classe === "3ème"
        ? `
Règle de concision renforcée pour ${classe}:
- Réponse très directe et précise.
- Maximum 70 mots.
- Utiliser des phrases très courtes.
- Garder APC en 3 mini-sections.
- Éviter les détails théoriques inutiles.
`
        : classe === "Terminale"
        ? `
Règle de concision pour Terminale:
- Maximum 140 mots.
- APC clair, avec justification rapide des étapes.
- Mettre l'accent sur méthode + vérification finale.
`
        : `
Règle de concision pour 1ère:
- Maximum 120 mots.
- APC clair et synthétique.
`;

    const tutorPersona =
      profile?.preferred_tutor_gender === "male"
        ? "Tu incarnes un Prof."
        : "Tu incarnes une Professeure.";
    const studentName =
      (typeof fullName === "string" && fullName.trim()) ||
      (typeof profile?.full_name === "string" && profile.full_name.trim()) ||
      null;

    const userContext = `
Nom de l'élève: ${studentName || "Non précisé"}
Classe: ${classe || "Non précisée"}
Domaine: ${domaine || "Non précisé"}
Matière: ${matiere || "Non précisée"}
Question: ${message || (imageBase64 || normalizedAttachments.length > 0 ? "Voir pièces jointes envoyées" : "Non précisée")}
${tutorPersona}
${studentName ? `Adresse-toi directement à ${studentName} dans la réponse.` : ""}
${brevityByClasse}
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

    for (const attachment of normalizedAttachments) {
      if (!attachment.base64 || attachment.base64.length > 12_000_000) continue;
      parts.push({
        inlineData: {
          data: attachment.base64,
          mimeType: attachment.mimeType || "application/octet-stream",
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
      premiumUntil: resolvedPremiumUntil,
      fullName: profile?.full_name ?? null,
      phone: profile?.phone ?? null,
      classe: profile?.classe ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur serveur.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

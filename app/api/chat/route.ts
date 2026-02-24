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
- Réponse complète et structurée, pas télégraphique.
- Adapter le niveau à la classe indiquée.
- Appeler l'élève par son vrai nom si disponible.
- Encourager l'autonomie de l'élève.
- Donner des exemples liés au contexte togolais quand pertinent.
- Si image d'exercice floue, demander une photo plus nette avant de résoudre.
- Ne jamais donner une réponse brute sans explication APC.
- Si la demande est hors programme de la classe, dire clairement "hors niveau" et proposer une version adaptée.
- Si la demande n'est pas scolaire (examen, exercice, notion de cours), refuser poliment et recentrer vers un exercice scolaire.
- Ne jamais fournir un contenu universitaire/professionnel avancé à un élève CM2/3ème/1ère.

Exigences de résolution d'exercice:
- Toujours identifier les données connues et ce qu'on cherche.
- Citer la formule/règle utilisée.
- Montrer les calculs ou étapes intermédiaires (pas sauter directement au résultat).
- Donner une réponse finale explicite et vérifiée.
- Si la nouvelle question dépend d'une question précédente, réutiliser le contexte récent avant de répondre.
- Si une information manque, poser une question courte de clarification.
- Ne jamais inventer une valeur numérique (ex: alpha, maximum, racine) sans montrer d'où elle vient.
- Ne jamais produire une "vérification finale" en Oui/Non sans justification mathématique.
- Si les données nécessaires manquent (fonction absente, intervalle absent, figure illisible), arrêter la résolution et demander les infos manquantes.
- Pour les formules mathématiques, utiliser la notation LaTeX simple entre $...$ (inline) ou $$...$$ (bloc).
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

const PROGRAM_BY_CLASSE: Record<string, { domaines: string[]; matieres: string[] }> = {
  CM2: {
    domaines: ["Sciences et Technologies", "Communication", "Univers Social"],
    matieres: ["Mathématiques", "Physique-Chimie", "SVT", "Français", "Anglais", "Histoire-Géographie", "ECM"],
  },
  "3ème": {
    domaines: ["Sciences et Technologies", "Communication", "Univers Social"],
    matieres: ["Mathématiques", "Physique-Chimie", "SVT", "Français", "Anglais", "Histoire-Géographie", "ECM"],
  },
  "1ère": {
    domaines: ["Sciences et Technologies", "Communication", "Univers Social", "Développement Personnel"],
    matieres: [
      "Mathématiques",
      "Physique-Chimie",
      "SVT",
      "Informatique",
      "Français",
      "Anglais",
      "Espagnol",
      "Allemand",
      "Histoire-Géographie",
      "ECM",
      "Économie",
      "Philosophie",
    ],
  },
  Terminale: {
    domaines: ["Sciences et Technologies", "Communication", "Univers Social", "Développement Personnel"],
    matieres: [
      "Mathématiques",
      "Physique-Chimie",
      "SVT",
      "Informatique",
      "Français",
      "Anglais",
      "Espagnol",
      "Allemand",
      "Histoire-Géographie",
      "ECM",
      "Économie",
      "Philosophie",
    ],
  },
};

const NON_SCHOOL_PATTERNS = [
  /\bcasino\b/i,
  /\bpari\b/i,
  /\bbet\b/i,
  /\bcrypto\b/i,
  /\btrading\b/i,
  /\bhacker?\b/i,
  /\bpirat(er|age)\b/i,
  /\bséduction\b/i,
  /\bamour\b/i,
  /\bpolitique\b/i,
  /\brecette\b/i,
  /\bvoyage\b/i,
  /\bblague\b/i,
];

const ADVANCED_KEYWORDS_BY_CLASSE: Record<string, string[]> = {
  CM2: ["dérivée", "intégrale", "primitive", "limite", "équation différentielle", "matrice", "logarithme"],
  "3ème": ["dérivée", "intégrale", "primitive", "limite", "équation différentielle", "matrice", "logarithme"],
  "1ère": ["équation différentielle", "transformée de fourier", "laplacien", "tensoriel"],
  Terminale: [],
};

function containsAnyKeyword(text: string, keywords: string[]) {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function formatRecentHistory(
  rows: Array<{ message: string | null; response: string | null }>
) {
  if (!rows.length) return "Aucun contexte récent.";
  return rows
    .map((row, idx) => {
      const question = (row.message || "").trim() || "(question vide)";
      const answer = (row.response || "").trim() || "(réponse vide)";
      return `Échange ${idx + 1}\n- Élève: ${question}\n- IA: ${answer}`;
    })
    .join("\n\n");
}

function hasLikelyMathExpression(input: string) {
  return /[=]|f\(|x\^|x²|sqrt|racine|ln|log|sin|cos|tan|\/|\*/i.test(input);
}

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

    const effectiveClasse = classe || profile?.classe || null;
    const questionText = (message || "").trim();
    const classeProgram = effectiveClasse ? PROGRAM_BY_CLASSE[effectiveClasse] : null;

    const saveAndRespond = async (responseText: string) => {
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
    };

    if (!effectiveClasse || !classeProgram) {
      return saveAndRespond(
        "Analyse: je dois connaître ta classe avant de résoudre.\nRessources: renseigne ta classe (CM2, 3ème, 1ère ou Terminale).\nRésolution: ensuite, envoie ton exercice pour une aide adaptée."
      );
    }

    const isNonSchoolRequest = questionText.length > 0 && NON_SCHOOL_PATTERNS.some((pattern) => pattern.test(questionText));
    if (isNonSchoolRequest) {
      return saveAndRespond(
        `Analyse: ta demande ne concerne pas un exercice scolaire de ${effectiveClasse}.\nRessources: je suis dédié à la préparation d'examens.\nRésolution: envoie une question de cours, exercice ou épreuve de ${effectiveClasse}.`
      );
    }

    const hasMathLikeSignal = hasLikelyMathExpression(questionText);
    if (!hasMathLikeSignal && !imageBase64 && normalizedAttachments.length === 0) {
      return saveAndRespond(
        "Analyse: l'énoncé semble incomplet pour une résolution exacte.\nRessources: il me faut la fonction/équation ou les données chiffrées.\nRésolution: envoie l'énoncé complet (ex: f(x)=..., intervalle, question précise) et je détaille chaque étape."
      );
    }

    if (domaine && !classeProgram.domaines.includes(domaine)) {
      return saveAndRespond(
        `Analyse: le domaine "${domaine}" n'est pas prévu pour la classe ${effectiveClasse}.\nRessources: domaines autorisés: ${classeProgram.domaines.join(", ")}.\nRésolution: choisis un domaine autorisé puis renvoie l'exercice.`
      );
    }

    if (matiere && !classeProgram.matieres.includes(matiere)) {
      return saveAndRespond(
        `Analyse: la matière "${matiere}" est hors programme pour ${effectiveClasse}.\nRessources: matières autorisées: ${classeProgram.matieres.join(", ")}.\nRésolution: choisis une matière de ta classe et je t'aide pas à pas.`
      );
    }

    const advancedKeywords = ADVANCED_KEYWORDS_BY_CLASSE[effectiveClasse] ?? [];
    if (questionText.length > 0 && advancedKeywords.length > 0 && containsAnyKeyword(questionText, advancedKeywords)) {
      return saveAndRespond(
        `Analyse: ta question semble au-dessus du niveau ${effectiveClasse}.\nRessources: je dois respecter strictement ton programme.\nRésolution: reformule avec une notion de ${effectiveClasse}, je te guiderai étape par étape.`
      );
    }

    const { data: recentHistory, error: historyReadError } = await supabase
      .from("history")
      .select("message, response")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(6);

    if (historyReadError) {
      return NextResponse.json({ error: historyReadError.message }, { status: 500 });
    }

    const recentHistoryContext = formatRecentHistory((recentHistory ?? []).reverse());

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const brevityByClasse =
      effectiveClasse === "CM2" || effectiveClasse === "3ème"
        ? `
Règles de détail pour ${effectiveClasse}:
- Réponse claire en 3 sections APC.
- Entre 90 et 160 mots.
- Montrer les étapes essentielles de calcul.
`
        : effectiveClasse === "Terminale"
        ? `
Règles de détail pour Terminale:
- Réponse en 3 sections APC.
- Entre 180 et 280 mots.
- Détailler raisonnement, calculs intermédiaires et vérification.
`
        : `
Règles de détail pour 1ère:
- Réponse en 3 sections APC.
- Entre 140 et 220 mots.
- Détailler les étapes de résolution sans raccourci.
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
Classe: ${effectiveClasse}
Domaine: ${domaine || "Non précisé"}
Matière: ${matiere || "Non précisée"}
Question: ${message || (imageBase64 || normalizedAttachments.length > 0 ? "Voir pièces jointes envoyées" : "Non précisée")}
Programme autorisé (${effectiveClasse}):
- Domaines: ${classeProgram.domaines.join(", ")}
- Matières: ${classeProgram.matieres.join(", ")}
Contexte récent de la conversation (à utiliser pour garder la logique):
${recentHistoryContext}
${tutorPersona}
${studentName ? `Adresse-toi directement à ${studentName} dans la réponse.` : ""}
${brevityByClasse}

Format de sortie obligatoire:
1) Analyse de la situation-problème
- Données connues:
- Ce qu'on cherche:
2) Mobilisation des ressources
- Formules/règles utilisées:
3) Résolution pas à pas + vérification finale
- Étapes de calcul numérotées:
- Résultat final:
- Vérification justifiée (pas Oui/Non brut):
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
    return saveAndRespond(responseText);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erreur serveur.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

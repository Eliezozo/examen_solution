"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  imagePreview?: string;
};

type PlanId = "pass_monthly" | "pass_yearly";

type HistoryItem = {
  id: string;
  message: string;
  response: string;
  created_at: string;
};

type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  classe: string | null;
  is_premium: boolean | null;
  premium_until: string | null;
};

const CLASSES = ["CM2", "3ème", "1ère"];

const DOMAINES: Array<{ name: string; matieres: string[] }> = [
  { name: "Sciences et Technologies", matieres: ["Mathématiques", "PCT", "SVT"] },
  { name: "Communication", matieres: ["Français", "Anglais"] },
  { name: "Univers Social", matieres: ["Histoire-Géographie", "ECM"] },
  { name: "Développement Personnel", matieres: ["Philosophie"] },
];

const PASS_OPTIONS: Array<{ id: PlanId; label: string; price: number; subtitle: string }> = [
  { id: "pass_monthly", label: "Pass Mensuel", price: 500, subtitle: "30 jours" },
  { id: "pass_yearly", label: "Pass Annuel", price: 1000, subtitle: "365 jours" },
];

const TOGO_PHONE_REGEX = /^\+228 [0-9]{8}$/;

function getOrCreateUserId() {
  const key = "rtogo_user_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = window.crypto.randomUUID();
  window.localStorage.setItem(key, id);
  return id;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export default function ChatPage() {
  const [userId, setUserId] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("+228 ");
  const [classe, setClasse] = useState("CM2");
  const [domaine, setDomaine] = useState("Sciences et Technologies");
  const [matiere, setMatiere] = useState("Mathématiques");
  const [profileSaving, setProfileSaving] = useState(false);

  const [message, setMessage] = useState("");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatItem[]>([
    {
      role: "assistant",
      text: "### Bienvenue\nJe suis ton Coach IA APC. Envoie ton exercice et je te réponds en étapes courtes.",
    },
  ]);
  const [loading, setLoading] = useState(false);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [freeLeft, setFreeLeft] = useState<number>(2);
  const [premiumUntil, setPremiumUntil] = useState<string | null>(null);

  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("pass_monthly");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [showSidebar, setShowSidebar] = useState(false);

  const domainesDisponibles = useMemo(() => {
    if (classe === "1ère") return DOMAINES;
    return DOMAINES.filter((d) => d.name !== "Développement Personnel");
  }, [classe]);

  const matieres = useMemo(
    () => domainesDisponibles.find((d) => d.name === domaine)?.matieres ?? [],
    [domainesDisponibles, domaine]
  );

  const premiumActive = useMemo(() => {
    if (!premiumUntil) return false;
    return new Date(premiumUntil) > new Date();
  }, [premiumUntil]);

  useEffect(() => {
    const id = getOrCreateUserId();
    setUserId(id);
  }, []);

  useEffect(() => {
    if (!domainesDisponibles.find((d) => d.name === domaine)) {
      setDomaine(domainesDisponibles[0]?.name ?? "");
    }
  }, [domainesDisponibles, domaine]);

  useEffect(() => {
    if (!matieres.includes(matiere)) {
      setMatiere(matieres[0] ?? "");
    }
  }, [matieres, matiere]);

  useEffect(() => {
    if (!userId) return;
    void loadProfile(userId);
    void loadHistory(userId);
  }, [userId]);

  async function loadProfile(id: string) {
    const res = await fetch(`/api/profile?userId=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok || !data?.profile) return;

    const profile: Profile = data.profile;
    if (profile.full_name) setFullName(profile.full_name);
    if (profile.phone) setPhone(profile.phone);
    if (profile.classe) setClasse(profile.classe);
    if (profile.premium_until) setPremiumUntil(profile.premium_until);
  }

  async function loadHistory(id: string) {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/history?userId=${encodeURIComponent(id)}&limit=30`);
      const data = await res.json();
      if (!res.ok) return;
      setHistory(Array.isArray(data?.history) ? data.history : []);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function saveProfile() {
    if (phone && !TOGO_PHONE_REGEX.test(phone)) {
      setChat((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Format téléphone invalide. Utilise exactement `+228 XXXXXXXX`.",
        },
      ]);
      return;
    }

    setProfileSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          fullName,
          phone,
          classe,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erreur profil");

      setChat((prev) => [
        ...prev,
        { role: "assistant", text: "Profil mis à jour avec succès." },
      ]);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Erreur inconnue";
      setChat((prev) => [...prev, { role: "assistant", text: `Erreur profil: ${errMsg}` }]);
    } finally {
      setProfileSaving(false);
    }
  }

  async function toBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function onImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const b64 = await toBase64(file);
    setImageBase64(b64);
    setImagePreview(URL.createObjectURL(file));
  }

  async function onSend() {
    if (!userId || (!message.trim() && !imageBase64)) return;
    if (!TOGO_PHONE_REGEX.test(phone)) {
      setChat((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Avant d'envoyer, ajoute un numéro valide au format `+228 XXXXXXXX`.",
        },
      ]);
      return;
    }

    setLoading(true);

    setChat((prev) => [
      ...prev,
      {
        role: "user",
        text: message || "Photo envoyée",
        imagePreview: imagePreview ?? undefined,
      },
    ]);

    const payload = {
      userId,
      phone,
      classe,
      domaine,
      matiere,
      message,
      imageBase64,
      imageMimeType: "image/jpeg",
    };

    setMessage("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (typeof data?.freeLeft === "number") {
        setFreeLeft(data.freeLeft);
      }
      if (data?.premiumUntil) {
        setPremiumUntil(data.premiumUntil);
      }

      if (res.status === 402 || data?.requiresPayment) {
        setShowPayModal(true);
        return;
      }

      if (!res.ok) {
        throw new Error(data?.error || "Erreur API");
      }

      setChat((prev) => [...prev, { role: "assistant", text: data.response }]);
      setImageBase64(null);
      setImagePreview(null);
      await loadHistory(userId);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Erreur inconnue";
      setChat((prev) => [...prev, { role: "assistant", text: `Erreur: ${errorMessage}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function onSimulatePayment() {
    if (!userId) return;
    if (!fullName.trim()) {
      setPaymentError("Renseigne ton nom avant le paiement.");
      return;
    }
    if (!TOGO_PHONE_REGEX.test(phone)) {
      setPaymentError("Numéro invalide. Format: +228 XXXXXXXX");
      return;
    }

    setPaymentError(null);
    setPaymentLoading(true);

    try {
      const res = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          fullName,
          phone,
          classe,
          plan: selectedPlan,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Paiement impossible");
      }

      setPremiumUntil(data?.premiumUntil ?? null);
      setShowPayModal(false);
      setChat((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `### ${data?.welcomeMessage ?? `Bienvenue ${fullName}`}\nPaiement validé: **${data?.planLabel} (${data?.amount}F)**.`,
        },
      ]);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Erreur inconnue";
      setPaymentError(errMsg);
    } finally {
      setPaymentLoading(false);
    }
  }

  function loadHistoryIntoChat(item: HistoryItem) {
    setChat([
      { role: "user", text: item.message || "Question" },
      { role: "assistant", text: item.response || "Réponse" },
    ]);
    setShowSidebar(false);
  }

  function logout() {
    window.localStorage.removeItem("rtogo_user_id");
    const newId = getOrCreateUserId();
    setUserId(newId);
    setFullName("");
    setPhone("+228 ");
    setClasse("CM2");
    setDomaine("Sciences et Technologies");
    setMatiere("Mathématiques");
    setPremiumUntil(null);
    setFreeLeft(2);
    setHistory([]);
    setChat([
      {
        role: "assistant",
        text: "### Session réinitialisée\nBonjour. Envoie ton exercice pour commencer.",
      },
    ]);
  }

  return (
    <section className="flex h-[calc(100vh-10rem)] gap-3">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 transform overflow-y-auto border-r bg-white p-3 shadow-lg transition-transform md:static md:z-0 md:block md:w-72 md:translate-x-0 md:rounded-2xl md:border md:shadow-sm ${
          showSidebar ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-3 flex items-center justify-between md:hidden">
          <p className="font-semibold">Menu</p>
          <button onClick={() => setShowSidebar(false)} className="rounded-lg border px-2 py-1 text-xs">
            Fermer
          </button>
        </div>

        <div className="space-y-2 rounded-xl border p-3">
          <p className="text-sm font-semibold text-green-700">Profil</p>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Nom complet"
            className="w-full rounded-lg border p-2 text-sm"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+228 XXXXXXXX"
            className="w-full rounded-lg border p-2 text-sm"
          />
          <select value={classe} onChange={(e) => setClasse(e.target.value)} className="w-full rounded-lg border p-2 text-sm">
            {CLASSES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select value={domaine} onChange={(e) => setDomaine(e.target.value)} className="w-full rounded-lg border p-2 text-sm">
            {domainesDisponibles.map((d) => (
              <option key={d.name}>{d.name}</option>
            ))}
          </select>
          <select value={matiere} onChange={(e) => setMatiere(e.target.value)} className="w-full rounded-lg border p-2 text-sm">
            {matieres.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={saveProfile}
            disabled={profileSaving}
            className="w-full rounded-lg bg-green-600 p-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {profileSaving ? "Sauvegarde..." : "Mettre à jour"}
          </button>
        </div>

        <div className="mt-3 rounded-xl border p-3">
          <p className="text-sm font-semibold text-green-700">Historique</p>
          <div className="mt-2 space-y-2">
            {historyLoading && <p className="text-xs text-slate-500">Chargement...</p>}
            {!historyLoading && history.length === 0 && (
              <p className="text-xs text-slate-500">Aucun historique.</p>
            )}
            {history.map((item) => (
              <button
                key={item.id}
                onClick={() => loadHistoryIntoChat(item)}
                className="w-full rounded-lg border p-2 text-left text-xs"
              >
                <p className="line-clamp-2 font-medium">{item.message}</p>
                <p className="mt-1 text-[11px] text-slate-500">{formatDate(item.created_at)}</p>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSidebar(true)} className="rounded-lg border px-2 py-1 text-xs md:hidden">
              Menu
            </button>
            <p className="text-sm font-semibold text-green-700">
              {fullName ? `Bienvenue ${fullName}` : "Bienvenue élève"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
              {premiumActive ? "Premium" : `${freeLeft} gratuit`}
            </span>
            <button onClick={logout} className="rounded-lg border px-2 py-1 text-xs">
              Déconnexion
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {chat.map((item, index) => (
            <div key={`${item.role}-${index}`} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
                  item.role === "user" ? "bg-green-600 text-white" : "border border-slate-200 bg-slate-50"
                }`}
              >
                {item.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-headings:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{item.text}</p>
                )}
                {item.imagePreview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imagePreview} alt="Exercice" className="mt-2 h-28 rounded-lg object-cover" />
                )}
              </div>
            </div>
          ))}
          {loading && <p className="text-xs text-slate-500">Coach IA APC réfléchit...</p>}
        </div>

        <div className="border-t p-3">
          {imagePreview && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border bg-slate-50 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Aperçu" className="h-12 w-12 rounded-lg object-cover" />
              <button
                onClick={() => {
                  setImagePreview(null);
                  setImageBase64(null);
                }}
                className="rounded-lg border px-2 py-1 text-xs"
              >
                Retirer
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <label className="cursor-pointer rounded-lg bg-yellow-400 px-3 py-2 text-xs font-semibold text-slate-900">
              Photo
              <input type="file" accept="image/*" capture="environment" onChange={onImageChange} className="hidden" />
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              placeholder="Pose ta question..."
              className="min-h-[44px] flex-1 resize-none rounded-xl border p-2 text-sm"
            />
            <button
              onClick={onSend}
              disabled={loading}
              className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Envoyer
            </button>
          </div>
        </div>
      </div>

      {showPayModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl">
            <h2 className="text-base font-bold text-red-700">Abonnement requis</h2>
            <p className="mt-1 text-sm text-slate-600">Choisis ton abonnement et valide le paiement.</p>

            <div className="mt-3 space-y-2">
              {PASS_OPTIONS.map((pass) => (
                <button
                  key={pass.id}
                  onClick={() => setSelectedPlan(pass.id)}
                  className={`w-full rounded-xl border p-2 text-left ${
                    selectedPlan === pass.id ? "border-green-600 bg-green-50" : "border-slate-200"
                  }`}
                >
                  <p className="text-sm font-semibold">{pass.label} - {pass.price}F</p>
                  <p className="text-xs text-slate-600">{pass.subtitle}</p>
                </button>
              ))}
            </div>

            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nom complet"
              className="mt-3 w-full rounded-xl border p-2 text-sm"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+228 XXXXXXXX"
              className="mt-2 w-full rounded-xl border p-2 text-sm"
            />

            {paymentError && <p className="mt-2 text-xs text-red-600">{paymentError}</p>}

            <button
              onClick={onSimulatePayment}
              disabled={paymentLoading}
              className="mt-3 w-full rounded-xl bg-green-600 p-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {paymentLoading ? "Validation..." : "Payer (FedaPay Simulation)"}
            </button>

            <button
              onClick={() => {
                setPaymentError(null);
                setShowPayModal(false);
              }}
              className="mt-2 w-full rounded-xl bg-slate-200 p-2 text-sm"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

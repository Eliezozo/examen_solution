"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  imagePreview?: string;
};

type PlanId = "pass_monthly" | "pass_yearly";
type ThemeColor = "green" | "blue" | "orange" | "red" | "black";
type TutorGender = "female" | "male";

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
  theme_color: ThemeColor | null;
  preferred_tutor_gender: TutorGender | null;
  referral_balance: number | null;
  total_referral_earnings: number | null;
  is_premium: boolean | null;
  premium_until: string | null;
};

type RewardNotification = {
  id: string;
  title: string;
  message: string;
  created_at: string;
};

type ReferralCommission = {
  id: string;
  payer_phone: string;
  plan_id: string;
  plan_amount: number;
  commission_amount: number;
  payout_phone: string;
  payout_status: string;
  created_at: string;
};

const CLASSES = ["CM2", "3ème", "1ère"];
const TOGO_PHONE_REGEX = /^\+228 [0-9]{8}$/;

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

const THEME_OPTIONS: Array<{ id: ThemeColor; label: string; accent: string; soft: string }> = [
  { id: "green", label: "Vert", accent: "#15803d", soft: "#dcfce7" },
  { id: "blue", label: "Bleu", accent: "#1d4ed8", soft: "#dbeafe" },
  { id: "orange", label: "Orange", accent: "#c2410c", soft: "#ffedd5" },
  { id: "red", label: "Rouge", accent: "#b91c1c", soft: "#fee2e2" },
  { id: "black", label: "Noir", accent: "#111827", soft: "#374151" },
];

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
  const [themeColor, setThemeColor] = useState<ThemeColor>("green");
  const [tutorGender, setTutorGender] = useState<TutorGender>("female");
  const [profileSaving, setProfileSaving] = useState(false);

  const [message, setMessage] = useState("");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatItem[]>([
    {
      role: "assistant",
      text: "### Bienvenue\nJe suis ton Coach IA APC. Pose une question et je réponds simplement.",
    },
  ]);
  const [loading, setLoading] = useState(false);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [notifications, setNotifications] = useState<RewardNotification[]>([]);
  const [commissions, setCommissions] = useState<ReferralCommission[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [referralBalance, setReferralBalance] = useState(0);
  const [totalReferralEarnings, setTotalReferralEarnings] = useState(0);

  const [freeLeft, setFreeLeft] = useState<number>(2);
  const [premiumUntil, setPremiumUntil] = useState<string | null>(null);

  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("pass_monthly");
  const [recommenderPhone, setRecommenderPhone] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [showSidebar, setShowSidebar] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const theme = useMemo(
    () => THEME_OPTIONS.find((item) => item.id === themeColor) ?? THEME_OPTIONS[0],
    [themeColor]
  );
  const isDarkTheme = themeColor === "black";

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
    setUserId(getOrCreateUserId());
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
    void loadRewards(userId);
  }, [userId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "return") return;

    setChat((prev) => [
      ...prev,
      {
        role: "assistant",
        text: "Paiement détecté. Vérification en cours... Si validé, ton premium sera activé automatiquement.",
      },
    ]);

    if (userId) {
      void watchPaymentStatus(userId);
    }
  }, [userId]);

  useEffect(() => {
    if (!chatEndRef.current) return;
    if (!isNearBottom && !loading) return;
    chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat, loading, isNearBottom]);

  async function loadProfile(id: string) {
    const res = await fetch(`/api/profile?userId=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok || !data?.profile) return;

    const profile: Profile = data.profile;
    if (profile.full_name) setFullName(profile.full_name);
    if (profile.phone) setPhone(profile.phone);
    if (profile.classe) setClasse(profile.classe);
    if (profile.theme_color) setThemeColor(profile.theme_color);
    if (profile.preferred_tutor_gender) setTutorGender(profile.preferred_tutor_gender);
    if (typeof profile.referral_balance === "number") setReferralBalance(profile.referral_balance);
    if (typeof profile.total_referral_earnings === "number") {
      setTotalReferralEarnings(profile.total_referral_earnings);
    }
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

  async function loadRewards(id: string) {
    setRewardsLoading(true);
    try {
      const res = await fetch(`/api/rewards?userId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) return;
      setNotifications(Array.isArray(data?.notifications) ? data.notifications : []);
      setCommissions(Array.isArray(data?.commissions) ? data.commissions : []);
    } finally {
      setRewardsLoading(false);
    }
  }

  async function watchPaymentStatus(id: string) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await fetch(`/api/payment/status?userId=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (res.ok && data?.payment?.status === "approved") {
        await loadProfile(id);
        await loadRewards(id);
        setChat((prev) => [
          ...prev,
          {
            role: "assistant",
            text: "Paiement confirmé. Ton accès premium est actif.",
          },
        ]);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
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
          themeColor,
          tutorGender,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erreur profil");

      setChat((prev) => [...prev, { role: "assistant", text: "Profil mis à jour." }]);
      await loadProfile(userId);
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
    await setImageFromFile(file);
  }

  async function setImageFromFile(file: File) {
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

      if (typeof data?.freeLeft === "number") setFreeLeft(data.freeLeft);
      if (data?.premiumUntil) setPremiumUntil(data.premiumUntil);

      if (res.status === 402 || data?.requiresPayment) {
        setShowPayModal(true);
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Erreur API");

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

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void onSend();
    }
  }

  async function onComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(event.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;

    const file = imageItem.getAsFile();
    if (!file) return;

    event.preventDefault();
    await setImageFromFile(file);
    setChat((prev) => [
      ...prev,
      {
        role: "assistant",
        text: "Image collée. Tu peux ajouter du texte puis envoyer.",
      },
    ]);
  }

  function onChatScroll() {
    const container = chatScrollRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsNearBottom(distance < 120);
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
    if (recommenderPhone && !TOGO_PHONE_REGEX.test(recommenderPhone)) {
      setPaymentError("Numéro du recommandant invalide. Format: +228 XXXXXXXX");
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
          recommenderPhone: recommenderPhone || null,
          tutorGender,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Paiement impossible");
      if (!data?.paymentUrl) throw new Error("URL de paiement FedaPay introuvable.");

      setShowPayModal(false);
      setRecommenderPhone("");
      setChat((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Redirection vers FedaPay pour payer **${data?.planLabel} (${data?.amount}F)**...`,
        },
      ]);
      window.location.href = data.paymentUrl;
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
    const nextId = getOrCreateUserId();

    setUserId(nextId);
    setFullName("");
    setPhone("+228 ");
    setClasse("CM2");
    setDomaine("Sciences et Technologies");
    setMatiere("Mathématiques");
    setThemeColor("green");
    setTutorGender("female");
    setPremiumUntil(null);
    setFreeLeft(2);
    setReferralBalance(0);
    setTotalReferralEarnings(0);
    setNotifications([]);
    setCommissions([]);
    setHistory([]);
    setChat([
      {
        role: "assistant",
        text: "### Session réinitialisée\nBonjour. Envoie ton exercice pour commencer.",
      },
    ]);
  }

  return (
    <section
      style={{
        ["--accent" as string]: theme.accent,
        ["--accent-soft" as string]: theme.soft,
      }}
      className={`flex h-[calc(100vh-9rem)] gap-2 ${isDarkTheme ? "text-slate-100" : ""}`}
    >
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 transform overflow-y-auto border-r p-2.5 shadow-lg transition-transform md:static md:z-0 md:block md:w-72 md:translate-x-0 md:rounded-2xl md:border md:shadow-sm ${
          isDarkTheme ? "border-slate-700 bg-slate-900" : "bg-white"
        } ${
          showSidebar ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-3 flex items-center justify-between md:hidden">
          <p className="font-semibold">Menu</p>
          <button onClick={() => setShowSidebar(false)} className="rounded-lg border px-2 py-1 text-xs">
            Fermer
          </button>
        </div>

        <div className={`space-y-2 rounded-xl border p-2.5 ${isDarkTheme ? "border-slate-700 bg-slate-800" : ""}`}>
          <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
            Profil
          </p>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Nom complet"
            className={`w-full rounded-lg border p-2 text-sm ${isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : ""}`}
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+228 XXXXXXXX"
            className={`w-full rounded-lg border p-2 text-sm ${isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : ""}`}
          />
          <select value={classe} onChange={(e) => setClasse(e.target.value)} className={`w-full rounded-lg border p-2 text-sm ${isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : ""}`}>
            {CLASSES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select value={domaine} onChange={(e) => setDomaine(e.target.value)} className={`w-full rounded-lg border p-2 text-sm ${isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : ""}`}>
            {domainesDisponibles.map((d) => (
              <option key={d.name}>{d.name}</option>
            ))}
          </select>
          <select value={matiere} onChange={(e) => setMatiere(e.target.value)} className={`w-full rounded-lg border p-2 text-sm ${isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : ""}`}>
            {matieres.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <select
            value={themeColor}
            onChange={(e) => setThemeColor(e.target.value as ThemeColor)}
            className={`w-full rounded-lg border p-2 text-sm ${isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : ""}`}
          >
            {THEME_OPTIONS.map((t) => (
              <option key={t.id} value={t.id}>
                Thème {t.label}
              </option>
            ))}
          </select>
          <select
            value={tutorGender}
            onChange={(e) => setTutorGender(e.target.value as TutorGender)}
            className={`w-full rounded-lg border p-2 text-sm ${isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : ""}`}
          >
            <option value="female">Je préfère une Professeure</option>
            <option value="male">Je préfère un Prof</option>
          </select>
          <button
            onClick={saveProfile}
            disabled={profileSaving}
            style={{ backgroundColor: "var(--accent)" }}
            className="w-full rounded-lg p-2 text-xs font-semibold text-white disabled:opacity-60"
          >
            {profileSaving ? "Sauvegarde..." : "Mettre à jour"}
          </button>
        </div>

        <div className={`mt-3 rounded-xl border p-3 ${isDarkTheme ? "border-slate-700" : ""}`} style={{ backgroundColor: "var(--accent-soft)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
            Recommandations
          </p>
          <p className={`mt-1 text-xs ${isDarkTheme ? "text-white" : "text-slate-700"}`}>Gains dispo: {referralBalance}F</p>
          <p className={`text-xs ${isDarkTheme ? "text-white" : "text-slate-700"}`}>Total gagné: {totalReferralEarnings}F</p>
        </div>

        <div className={`mt-3 rounded-xl border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : ""}`}>
          <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
            Notifications
          </p>
          <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
            {rewardsLoading && <p className={`text-xs ${isDarkTheme ? "text-slate-300" : "text-slate-500"}`}>Chargement...</p>}
            {!rewardsLoading && notifications.length === 0 && (
              <p className={`text-xs ${isDarkTheme ? "text-slate-300" : "text-slate-500"}`}>Aucune notification.</p>
            )}
            {notifications.map((item) => (
              <div key={item.id} className={`rounded-lg border p-2 text-xs ${isDarkTheme ? "border-slate-600 bg-slate-900" : ""}`}>
                <p className="font-semibold">{item.title}</p>
                <p className={`mt-1 ${isDarkTheme ? "text-slate-100" : "text-slate-700"}`}>{item.message}</p>
                <p className={`mt-1 text-[11px] ${isDarkTheme ? "text-slate-300" : "text-slate-500"}`}>{formatDate(item.created_at)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={`mt-3 rounded-xl border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : ""}`}>
          <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
            Transactions de parrainage
          </p>
          <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
            {!rewardsLoading && commissions.length === 0 && (
              <p className={`text-xs ${isDarkTheme ? "text-slate-300" : "text-slate-500"}`}>Aucune transaction.</p>
            )}
            {commissions.map((item) => (
              <div key={item.id} className={`rounded-lg border p-2 text-xs ${isDarkTheme ? "border-slate-600 bg-slate-900" : ""}`}>
                <p>Paiement: {item.plan_amount}F</p>
                <p>Commission: {item.commission_amount}F</p>
                <p>Statut: {item.payout_status}</p>
                <p>Mobile Money: {item.payout_phone}</p>
                <p className={`text-[11px] ${isDarkTheme ? "text-slate-300" : "text-slate-500"}`}>{formatDate(item.created_at)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className={`mt-3 rounded-xl border p-3 ${isDarkTheme ? "border-slate-700 bg-slate-800" : ""}`}>
          <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
            Historique
          </p>
          <div className="mt-2 space-y-2">
            {historyLoading && <p className={`text-xs ${isDarkTheme ? "text-slate-300" : "text-slate-500"}`}>Chargement...</p>}
            {!historyLoading && history.length === 0 && <p className={`text-xs ${isDarkTheme ? "text-slate-300" : "text-slate-500"}`}>Aucun historique.</p>}
            {history.map((item) => (
              <button
                key={item.id}
                onClick={() => loadHistoryIntoChat(item)}
                className={`w-full rounded-lg border p-2 text-left text-xs ${isDarkTheme ? "border-slate-600 bg-slate-900" : ""}`}
              >
                <p className="line-clamp-2 font-medium">{item.message}</p>
                <p className={`mt-1 text-[11px] ${isDarkTheme ? "text-slate-300" : "text-slate-500"}`}>{formatDate(item.created_at)}</p>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {showSidebar && (
        <button
          type="button"
          aria-label="Fermer le menu"
          onClick={() => setShowSidebar(false)}
          className="fixed inset-0 z-30 bg-black/35 md:hidden"
        />
      )}

      <div
        className={`flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-sm ${
          isDarkTheme ? "border-slate-700 bg-slate-900" : "bg-white"
        }`}
      >
        <div
          className={`flex items-center justify-between border-b px-3 py-2 ${
            isDarkTheme ? "border-slate-700 bg-slate-900/90" : "bg-white/90"
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSidebar(true)}
              aria-label="Ouvrir le menu latéral"
              className={`mobile-sidebar-arrow rounded-lg border px-2 py-1 text-sm md:hidden ${
                isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : "bg-white text-slate-700"
              }`}
            >
              ←
            </button>
            <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
              {fullName ? `Bienvenue ${fullName}` : "Bienvenue élève"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-xs ${isDarkTheme ? "text-white" : "text-slate-700"}`} style={{ backgroundColor: "var(--accent-soft)" }}>
              {premiumActive ? "Premium" : `${freeLeft} gratuit`}
            </span>
            <button onClick={logout} className="rounded-lg border px-2 py-1 text-xs">
              Déconnexion
            </button>
          </div>
        </div>

        <div ref={chatScrollRef} onScroll={onChatScroll} className="flex-1 space-y-3 overflow-y-auto p-3">
          {chat.map((item, index) => (
            <div key={`${item.role}-${index}`} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
                  item.role === "user"
                    ? "text-white"
                    : isDarkTheme
                    ? "border border-slate-600 bg-slate-800 text-slate-100"
                    : "border border-slate-200 bg-slate-50"
                }`}
                style={item.role === "user" ? { backgroundColor: "var(--accent)" } : undefined}
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
          {loading && (
            <div className="flex justify-start">
              <div className={`rounded-2xl border px-3 py-2 ${isDarkTheme ? "border-slate-600 bg-slate-800" : "border-slate-200 bg-slate-50"}`}>
                <div className="flex items-center gap-1">
                  <span className={`h-2 w-2 animate-pulse rounded-full ${isDarkTheme ? "bg-slate-200" : "bg-slate-400"}`} />
                  <span className={`h-2 w-2 animate-pulse rounded-full [animation-delay:150ms] ${isDarkTheme ? "bg-slate-200" : "bg-slate-400"}`} />
                  <span className={`h-2 w-2 animate-pulse rounded-full [animation-delay:300ms] ${isDarkTheme ? "bg-slate-200" : "bg-slate-400"}`} />
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="border-t p-3">
          {imagePreview && (
            <div className={`mb-2 flex items-center gap-2 rounded-lg border p-2 ${isDarkTheme ? "border-slate-600 bg-slate-800" : "bg-slate-50"}`}>
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
              onKeyDown={onComposerKeyDown}
              onPaste={onComposerPaste}
              rows={2}
              placeholder="Pose ta question ici."
              className={`min-h-[44px] flex-1 resize-none rounded-xl border p-2 text-sm ${isDarkTheme ? "border-slate-600 bg-slate-900 text-slate-100" : ""}`}
            />
            <button
              onClick={onSend}
              disabled={loading}
              style={{ backgroundColor: "var(--accent)" }}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Envoyer
            </button>
          </div>
        </div>
      </div>

      {showPayModal && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className={`w-full max-w-sm rounded-2xl p-4 shadow-xl ${isDarkTheme ? "border border-slate-700 bg-slate-900 text-white" : "bg-white"}`}>
            <h2 className={`text-base font-bold ${isDarkTheme ? "text-white" : "text-red-700"}`}>Abonnement requis</h2>
            <p className={`mt-1 text-sm ${isDarkTheme ? "text-slate-200" : "text-slate-600"}`}>Choisis ton abonnement et règle le paiement.</p>

            <div className="mt-3 space-y-2">
              {PASS_OPTIONS.map((pass) => (
                <button
                  key={pass.id}
                  onClick={() => setSelectedPlan(pass.id)}
                  className={`w-full rounded-xl border p-2 text-left ${
                    selectedPlan === pass.id
                      ? isDarkTheme
                        ? "border-slate-200 bg-slate-800"
                        : "border-slate-900 bg-slate-50"
                      : isDarkTheme
                      ? "border-slate-600 bg-slate-900"
                      : "border-slate-200"
                  }`}
                >
                  <p className="text-sm font-semibold">{pass.label} - {pass.price}F</p>
                  <p className={`text-xs ${isDarkTheme ? "text-slate-200" : "text-slate-600"}`}>{pass.subtitle}</p>
                </button>
              ))}
            </div>

            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nom complet"
              className={`mt-3 w-full rounded-xl border p-2 text-sm ${isDarkTheme ? "border-slate-600 bg-slate-800 text-white" : ""}`}
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ton numéro: +228 XXXXXXXX"
              className={`mt-2 w-full rounded-xl border p-2 text-sm ${isDarkTheme ? "border-slate-600 bg-slate-800 text-white" : ""}`}
            />
            <input
              value={recommenderPhone}
              onChange={(e) => setRecommenderPhone(e.target.value)}
              placeholder="Numéro recommandant (optionnel): +228 XXXXXXXX"
              className={`mt-2 w-full rounded-xl border p-2 text-sm ${isDarkTheme ? "border-slate-600 bg-slate-800 text-white" : ""}`}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => setTutorGender("female")}
                className={`rounded-xl border p-2 text-xs ${
                  tutorGender === "female"
                    ? isDarkTheme
                      ? "border-slate-200 bg-slate-800"
                      : "border-slate-900 bg-slate-50"
                    : isDarkTheme
                    ? "border-slate-600 bg-slate-900"
                    : "border-slate-200"
                }`}
              >
                Professeure
              </button>
              <button
                onClick={() => setTutorGender("male")}
                className={`rounded-xl border p-2 text-xs ${
                  tutorGender === "male"
                    ? isDarkTheme
                      ? "border-slate-200 bg-slate-800"
                      : "border-slate-900 bg-slate-50"
                    : isDarkTheme
                    ? "border-slate-600 bg-slate-900"
                    : "border-slate-200"
                }`}
              >
                Prof
              </button>
            </div>

            {paymentError && <p className="mt-2 text-xs text-red-600">{paymentError}</p>}

            <button
              onClick={onSimulatePayment}
              disabled={paymentLoading}
              style={{ backgroundColor: "var(--accent)" }}
              className="mt-3 w-full rounded-xl p-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {paymentLoading ? "Validation..." : "Payer avec FedaPay"}
            </button>

            <button
              onClick={() => {
                setPaymentError(null);
                setShowPayModal(false);
              }}
              className={`mt-2 w-full rounded-xl p-2 text-sm ${isDarkTheme ? "bg-slate-700 text-white" : "bg-slate-200"}`}
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

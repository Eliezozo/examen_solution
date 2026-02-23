"use client";

import { useEffect, useMemo, useState } from "react";

type AdminUser = {
  id: string;
  full_name: string | null;
  phone: string | null;
  classe: string | null;
  is_premium: boolean;
  premium_until: string | null;
  created_at: string;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [daysToAdd, setDaysToAdd] = useState(30);
  const [workingUserId, setWorkingUserId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedKey = window.localStorage.getItem("rtogo_admin_key");
      if (savedKey) setAdminKey(savedKey);
    } catch {
      // Ignore localStorage errors.
    }
  }, []);

  const canLoad = useMemo(() => adminKey.trim().length > 0, [adminKey]);

  async function loadUsers() {
    if (!adminKey.trim()) {
      setError("Renseigne d'abord la clé admin.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      window.localStorage.setItem("rtogo_admin_key", adminKey.trim());
      const params = new URLSearchParams({
        adminKey: adminKey.trim(),
        limit: "200",
      });
      if (query.trim()) params.set("q", query.trim());
      if (premiumOnly) params.set("premiumOnly", "1");

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Impossible de charger les utilisateurs.");
      setUsers(Array.isArray(data?.users) ? data.users : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  async function updatePremium(userId: string, grantPremium: boolean) {
    if (!adminKey.trim()) {
      setError("Clé admin requise.");
      return;
    }
    setWorkingUserId(userId);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey.trim() },
        body: JSON.stringify({
          userId,
          grantPremium,
          days: grantPremium ? daysToAdd : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Mise à jour impossible.");
      await loadUsers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setWorkingUserId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-green-700">Administration</h2>
        <p className="mt-1 text-sm text-slate-600">
          Gérer les utilisateurs et activer/désactiver le mode premium.
        </p>

        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <input
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Clé admin"
            className="rounded-lg border p-2 text-sm md:col-span-2"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Recherche nom ou téléphone"
            className="rounded-lg border p-2 text-sm"
          />
          <button
            type="button"
            onClick={loadUsers}
            disabled={loading || !canLoad}
            className="rounded-lg bg-green-700 p-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Chargement..." : "Charger"}
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={premiumOnly}
              onChange={(e) => setPremiumOnly(e.target.checked)}
            />
            Premium seulement
          </label>
          <label className="flex items-center gap-2 text-sm">
            Jours à ajouter
            <input
              type="number"
              min={1}
              value={daysToAdd}
              onChange={(e) => setDaysToAdd(Number(e.target.value) || 30)}
              className="w-24 rounded-lg border p-1 text-sm"
            />
          </label>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="space-y-2">
        {users.length === 0 && !loading && (
          <p className="rounded-lg border bg-white p-3 text-sm text-slate-600">
            Aucun utilisateur chargé.
          </p>
        )}

        {users.map((user) => (
          <div key={user.id} className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{user.full_name || "Nom non renseigné"}</p>
                <p className="text-xs text-slate-600">{user.phone || "Téléphone non renseigné"}</p>
                <p className="text-xs text-slate-600">Classe: {user.classe || "-"}</p>
                <p className="text-xs text-slate-600">Créé le: {formatDate(user.created_at)}</p>
              </div>
              <div className="text-right">
                <p
                  className={`text-sm font-semibold ${
                    user.is_premium ? "text-green-700" : "text-slate-700"
                  }`}
                >
                  {user.is_premium ? "Premium" : "Gratuit"}
                </p>
                <p className="text-xs text-slate-600">
                  Expiration: {formatDate(user.premium_until)}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={workingUserId === user.id}
                onClick={() => updatePremium(user.id, true)}
                className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {workingUserId === user.id ? "..." : `+${daysToAdd} jours premium`}
              </button>
              <button
                type="button"
                disabled={workingUserId === user.id}
                onClick={() => updatePremium(user.id, false)}
                className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                Retirer premium
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

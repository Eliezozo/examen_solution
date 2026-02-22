# Résumé du projet - Réussite Togo APC

## 1) Objectif
Application web éducative pour les élèves togolais (CM2, 3ème, 1ère) avec:
- assistant IA pédagogique (méthode APC),
- gestion d'abonnement premium,
- paiements FedaPay,
- système de parrainage et notifications.

## 2) Stack technique
- Frontend: Next.js 14 (App Router), React 18, Tailwind CSS.
- Backend: Routes API Next.js (`app/api/*`) en TypeScript.
- Base de données: Supabase (PostgreSQL + RLS).
- IA: Google Gemini (`@google/generative-ai`).
- Paiement: FedaPay (API + webhook signé).

## 3) Fonctionnalités clés
- Chat IA éducatif avec réponses courtes et structurées en 3 parties APC.
- Personnalisation profil: nom, téléphone, classe, thème, préférence tuteur.
- Historique des échanges.
- Limite gratuite (2 requêtes) puis passage premium.
- Achat premium: pass mensuel (500 XOF) ou annuel (1000 XOF).
- Activation premium via webhook de paiement.
- Parrainage: commission (10%) + notifications.
- Endpoint d'activation manuelle premium (admin).

## 4) Architecture applicative
- UI principale: `app/page.tsx`.
- Layout global: `app/layout.tsx`.
- Services:
  - `lib/fedapay.ts` (client FedaPay, signature webhook, helpers),
  - `lib/supabase.ts` (client public Supabase côté front).
- API backend:
  - `app/api/chat/route.ts`: génération IA + contrôle quota + insertion historique.
  - `app/api/profile/route.ts`: lecture/mise à jour profil.
  - `app/api/history/route.ts`: récupération historique.
  - `app/api/rewards/route.ts`: notifications + commissions.
  - `app/api/payment/route.ts`: création transaction FedaPay + URL paiement.
  - `app/api/payment/webhook/route.ts`: confirmation paiement, activation premium, commissions.
  - `app/api/payment/status/route.ts`: dernier état de paiement.
  - `app/api/payment/manual/route.ts`: activation premium manuelle sécurisée par clé admin.

## 5) Modèle de données (Supabase)
Schéma principal défini dans `supabase/schema.sql`:
- `profiles`: identité utilisateur, préférences, statut premium, gains de parrainage.
- `history`: messages utilisateur + réponses IA.
- `payment_transactions`: transactions de paiement et statut.
- `referral_commissions`: commissions de parrainage.
- `notifications`: notifications utilisateur.

Indexes présents sur les champs de consultation fréquente (`user_id`, `created_at`, `status`), ce qui améliore les performances en lecture.

## 6) Variables d'environnement
Définies dans `.env.example`:
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `FEDAPAY_ENV`
- `FEDAPAY_SECRET_KEY`
- `FEDAPAY_WEBHOOK_SECRET`
- `MANUAL_PREMIUM_ADMIN_KEY`

## 7) Points forts actuels
- Logique métier claire et séparée par route API.
- Validation côté API (format téléphone, plans, données minimales).
- Webhook idempotent pour paiements approuvés.
- Flux premium/parrainage déjà opérationnel.
- Application majoritairement stateless, adaptée à la montée en charge.

## 8) Points d'attention
- RLS est actuellement permissif (`select/insert/update` avec `true`) pour le mode MVP sans auth stricte.
- Le `SUPABASE_SERVICE_ROLE_KEY` est utilisé dans les routes API (normal côté serveur), mais impose un contrôle rigoureux des endpoints.
- Le `userId` est généré côté client (localStorage), donc pas d'authentification forte utilisateur à ce stade.

## 9) Scalabilité
Un fichier PM2 de cluster a été ajouté: `ecosystem.config.cjs`.
- `exec_mode: "cluster"`
- `instances: "max"`
- redémarrage auto + limite mémoire

Cela permet d'exploiter plusieurs cœurs CPU en production.


# Réussite Togo APC

Application web éducative pour les élèves togolais (CM2, 3ème, 1ère, Terminale) avec assistant IA (APC), abonnements premium et paiements FedaPay.

## Fonctionnalités
- Chat IA avec réponses pédagogiques structurées en méthode APC.
- Upload de pièces jointes (image/fichier) et note vocale audio.
- Gestion profil élève (nom, téléphone, classe, thème, préférence tuteur).
- Historique des échanges.
- Mode gratuit limité, puis déblocage premium.
- Paiement FedaPay (webhook de confirmation).
- Parrainage + notifications.
- Page admin pour gérer les utilisateurs premium.

## Stack
- Next.js 14 + React 18 + TypeScript
- Tailwind CSS
- Supabase (PostgreSQL)
- Google Gemini API
- FedaPay API

## Prérequis
- Node.js 18+
- npm
- Un projet Supabase configuré
- Clés API Gemini et FedaPay

## Installation
```bash
npm install
cp .env.example .env
```

## Variables d'environnement
Configurer `.env`:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

GEMINI_API_KEY=

FEDAPAY_ENV=sandbox
FEDAPAY_SECRET_KEY=
FEDAPAY_WEBHOOK_SECRET=
MANUAL_PREMIUM_ADMIN_KEY=
```

## Base de données
Exécuter `supabase/schema.sql` dans le SQL Editor Supabase.

Ce schéma crée:
- tables `profiles`, `history`, `payment_transactions`, `referral_commissions`, `notifications`,
- politiques RLS (mode MVP permissif).

## Lancement
Développement:
```bash
npm run dev
```

Production:
```bash
npm run build
npm run start
```

## Endpoints API principaux
- `POST /api/chat`
- `GET/PATCH /api/profile`
- `GET /api/history`
- `GET /api/rewards`
- `POST /api/payment`
- `GET /api/payment/status`
- `POST /api/payment/webhook`
- `POST /api/payment/manual`
- `GET/PATCH /api/admin/users` (clé `MANUAL_PREMIUM_ADMIN_KEY`)

## Administration
- Interface admin: `/admin`
- Renseigner la clé admin (même valeur que `MANUAL_PREMIUM_ADMIN_KEY`) pour:
  - lister/rechercher les utilisateurs,
  - filtrer premium,
  - activer le premium (ajout en jours),
  - retirer le premium.

## Debug iPhone
- Ouvrir l'application avec `?debugIphone=1` (ex: `http://localhost:3000/?debugIphone=1`)
- Alternative ancienne version iOS: `/#debugIphone` ou cliquer le bouton `Debug` (en bas à droite sur iPhone/iPad)
- Un panneau "Debug iPhone" apparaît en bas à droite:
  - trace des événements tactiles/clics,
  - logs des actions critiques (menu, fichier, vocal, envoi),
  - bouton `Copier logs` pour partager les traces de diagnostic.

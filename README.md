# Réussite Togo APC

Application web éducative pour les élèves togolais (CM2, 3ème, 1ère) avec assistant IA (APC), abonnements premium et paiements FedaPay.

## Fonctionnalités
- Chat IA avec réponses pédagogiques structurées en méthode APC.
- Gestion profil élève (nom, téléphone, classe, thème, préférence tuteur).
- Historique des échanges.
- Mode gratuit limité, puis déblocage premium.
- Paiement FedaPay (webhook de confirmation).
- Parrainage + notifications.
- Activation premium manuelle (par `user_id` ou numéro de téléphone).

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
- politiques RLS (mode MVP permissif),
- fonctions SQL d’activation premium manuelle:
  - `public.activate_manual_premium(uuid, days, amount, note)`
  - `public.activate_manual_premium_by_phone(phone, days, amount, note)`

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

## Activation premium manuelle (SQL)
Par `user_id`:
```sql
select *
from public.activate_manual_premium(
  'UUID_UTILISATEUR'::uuid,
  30,
  500,
  'Activation manuelle admin'
);
```

Par téléphone:
```sql
select *
from public.activate_manual_premium_by_phone(
  '+228 90123456',
  30,
  500,
  'Activation avant 1ere connexion'
);
```

## Notes importantes
- Le `userId` est généré côté client (localStorage) en mode MVP.
- Le backend chat contient un fallback premium (transactions approuvées + téléphone) pour éviter les blocages de synchronisation.
- En mode sombre (thème noir), les textes sont forcés en blanc pour la lisibilité.


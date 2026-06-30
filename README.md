# Studio Botema ERP

Цялостна ERP система за управление на **Studio Botema ЕООД** — бутик дизайн студио за осветление, мебели и интериорен дизайн.

## Функционалности

- **Дашборд** — KPI, месечен P&L, топ клиенти и доставчици, банкова рекон.
- **Фактури** — издаване, проследяване, aging report (BGN + EUR)
- **Документи (BizDoc)** — входящи фактури от Gmail и Drive, AI парсване, статуси
- **Доставки** — входящи покупки от доставчици
- **Банкова рекон.** — импорт на CSV извлечения, автоматично съпоставяне с фактури
- **ДДС** — месечна справка, изходящ/входящ ДДС, нет позиция
- **Склад** — наличности, движения, мостри
- **Проекти** — кодове, клиенти, P&L по проект
- **Клиенти** — CRM, история на фактурите, приходи по година
- **Разходи** — наем, счетоводство, транспорт, реклама
- **Gmail мониторинг** — автоматично засичане на нови фактури по имейл
- **AI Асистент** — на български, с достъп до всички данни (Gemini 2.5 Flash)

## Технологии

| Компонент | Технология |
|-----------|-----------|
| Frontend | Next.js 14 + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + Prisma ORM |
| Database | PostgreSQL (Supabase) |
| AI | Gemini 2.5 Flash (fallback: Groq llama-3.3-70b, OpenRouter) |
| Email | Gmail API + Google Pub/Sub |
| Storage | Google Drive API |
| Deploy FE | Vercel |
| Deploy BE | Railway |

## Бърз старт

### 1. Клонирай репото
```bash
git clone https://github.com/IliyanBogdanov/botema-erp.git
cd botema-erp
```

### 2. Настрой базата данни (Supabase)
1. Създай проект на [supabase.com](https://supabase.com)
2. Копирай `DATABASE_URL` от Settings → Database

### 3. Конфигурирай environment variables
```bash
cp backend/.env.example backend/.env
# Попълни всички стойности в backend/.env
```

### 4. Инициализирай базата
```bash
cd backend
npm install
npx prisma db push
npm run db:seed
```

### 5. Стартирай локално
```bash
# В root директорията
npm install
npm run dev
```

Frontend: http://localhost:3000  
Backend: http://localhost:3001  
Prisma Studio: `cd backend && npm run db:studio`

### Optional: MinerU документ parsing spike
MinerU не е npm dependency; инсталира се отделно като Python CLI/FastAPI service.

```bash
# След локална MinerU инсталация
cd backend
npm run mineru:parse -- ../path/to/document.pdf
```

За да се пробва в ERP document parser-а:

```bash
MINERU_ENABLED=true
MINERU_COMMAND=mineru
# optional, ако ползваш вече стартиран MinerU FastAPI:
MINERU_API_URL=http://127.0.0.1:8000
```

Ако MinerU липсва или върне грешка, backend-ът пада обратно към текущия Gemini/Groq/OpenRouter flow.

## Deployment

### Backend → Railway
1. Създай проект на [railway.app](https://railway.app)
2. Свържи GitHub repo
3. Добави environment variables (виж `.env.example`)
4. Railway автоматично деплойва от `master` branch

### Frontend → Vercel
```bash
cd frontend
npx vercel --prod
```

### Gmail мониторинг
```bash
# Настрой Google Pub/Sub topic
gcloud pubsub topics create botema-gmail-watch
gcloud pubsub subscriptions create botema-sub \
  --topic botema-gmail-watch \
  --push-endpoint https://your-backend.railway.app/api/gmail/webhook

# Активирай следенето
curl -X POST https://your-backend.railway.app/api/gmail/watch \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"email": "office@studiobotema.com"}'
```

## Структура на проекта

```
botema-erp/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma        # Database schema
│   ├── scripts/                 # Utility & migration scripts
│   └── src/
│       ├── index.js             # Entry point
│       ├── middleware/
│       │   └── auth.js          # JWT auth
│       ├── routes/
│       │   ├── auth.js
│       │   ├── dashboard.js     # KPIs, monthly P&L
│       │   ├── invoices.js      # Outgoing invoices
│       │   ├── bizDocuments.js  # Incoming docs (AI parsed)
│       │   ├── payments.js      # Bank statement payments
│       │   ├── reconciliation.js
│       │   ├── vat.js
│       │   ├── purchases.js
│       │   ├── projects.js
│       │   ├── clients.js
│       │   ├── expenses.js
│       │   ├── inventory.js
│       │   ├── ai.js            # Gemini AI chat
│       │   └── gmail.js         # Gmail monitoring
│       └── lib/
│           ├── aiParser.js      # PDF → structured data
│           ├── gmailScanner.js
│           ├── reconciliationEngine.js
│           └── seed.js
├── frontend/
│   └── src/
│       ├── app/                 # Next.js App Router pages
│       ├── components/          # Shared React components
│       └── lib/
│           ├── api.ts           # Axios API client
│           └── i18n.ts          # BG/EN translations
└── railway.toml                 # Railway config
```

## Акаунти при стартиране

| Email | Role |
|-------|------|
| office@studiobotema.com | ADMIN |
| office@luminavera.com | STAFF |

Паролите се задават чрез `ADMIN_PASSWORD` в `.env` или чрез `scripts/reset-password.js`.

## Лиценз
Частен проект — Studio Botema ЕООД © 2026

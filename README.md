# Studio Botema ERP

Цялостна ERP система за управление на **Studio Botema ЕООД** — бутик дизайн студио за осветление, мебели и интериорен дизайн.

## Функционалности

- 📊 **Дашборд** — KPI, графики по месец, топ клиенти
- 📤 **Фактури** — издаване, проследяване, статуси (BGN + EUR)
- 📥 **Доставки** — входящи от доставчици (Lodes, Alphaluce, Karimoku...)
- 🏷 **Склад** — наличности, движения (постъпване/изписване), мостри
- 📁 **Проекти** — 1717.xxx номера, клиенти, финанси по проект
- 👥 **Клиенти** — 40+ партньора от 2024 насам
- 💸 **Разходи** — наем, счетоводство, транспорт, реклама
- 📧 **Gmail мониторинг** — автоматично засичане на нови фактури по имейл
- 🤖 **AI Асистент** — на български, с достъп до всички данни
- 📱 **PWA** — работи като мобилно приложение

## Технологии

| Компонент | Технология |
|-----------|-----------|
| Frontend | Next.js 14 + TypeScript + Tailwind CSS |
| Backend | Node.js + Express + Prisma ORM |
| Database | PostgreSQL (Supabase) |
| AI | Anthropic Claude API |
| Email | Gmail API + Google Pub/Sub |
| Storage | Google Drive API |
| Deploy FE | Vercel |
| Deploy BE | Railway |
| CI/CD | GitHub Actions |

## Бърз старт

### 1. Клонирай репото
```bash
git clone https://github.com/studiobotema/botema-erp.git
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

## Deployment

### Backend → Railway
1. Създай проект на [railway.app](https://railway.app)
2. Свържи GitHub repo
3. Добави environment variables
4. Railway автоматично деплойва от `main` branch

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
│   │   └── schema.prisma     # Database schema
│   └── src/
│       ├── index.js           # Entry point
│       ├── middleware/
│       │   └── auth.js        # JWT auth
│       ├── routes/
│       │   ├── auth.js
│       │   ├── dashboard.js
│       │   ├── invoices.js
│       │   ├── purchases.js
│       │   ├── inventory.js
│       │   ├── projects.js
│       │   ├── clients.js
│       │   ├── expenses.js
│       │   ├── ai.js          # Claude AI integration
│       │   └── gmail.js       # Gmail monitoring
│       └── lib/
│           └── seed.js        # Database seed
├── frontend/
│   └── src/
│       ├── app/               # Next.js App Router
│       ├── components/        # React components
│       └── lib/
│           └── api.ts         # API client
├── .github/
│   └── workflows/
│       └── deploy.yml         # CI/CD
└── railway.toml               # Railway config
```

## Акаунти при стартиране

| Email | Role | Парола |
|-------|------|--------|
| office@studiobotema.com | ADMIN | (от ADMIN_PASSWORD в .env) |
| office@luminavera.com | STAFF | temppass123 (смени!) |

## Лиценз
Частен проект — Studio Botema ЕООД © 2026

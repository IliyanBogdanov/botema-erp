# Developer Guide — Studio Botema ERP

Практически наръчник за нов разработчик. README-то покрива setup — тук е логиката.

---

## Архитектура накратко

```
Gmail / Google Drive
       │
       ▼
  Backend (Railway)          ◄──── Frontend (Vercel)
  Node.js + Express                Next.js 14 / TypeScript
  Prisma ORM                       React Query (data fetching)
       │
       ▼
  PostgreSQL (Supabase)
```

Всички API заявки минават през `/api/*`. Auth-ът е JWT — токенът се пази в `localStorage` и се праща като `Authorization: Bearer <token>`.

---

## Data flow — как влизат разходите

```
PDF фактура (Gmail или Drive)
       │
       ▼ (aiParser.js → Gemini 2.5 Flash)
  BizDocument  (docType: INVOICE_IN)
       │
       ▼ (reconciliationEngine.js)
  ReconciliationLink  ──►  Payment (банково плащане)
       │
       ▼
  Dashboard KPIs  (САМО status NOT IN ['REJECTED','ARCHIVED'])
```

**Важно:** `BizDocument` е авторитетният източник за разходи — не `Purchase`. Purchase таблицата е legacy от преди импорта на Gmail/Drive данни.

---

## Ключови бизнес правила

### Валути
```js
const BGN_PER_EUR = 1.95583;  // фиксиран курс навсякъде
```
Системата работи с BGN и EUR. USD се среща рядко (DHL). Конвертацията е в JS, не в базата.

### Invoice статуси (`PaymentStatus` enum)
```
PENDING → PAID | OVERDUE | CANCELLED
```
`Invoice.status` **не може** да бъде `ARCHIVED` — enum-ът не го поддържа. Ако добавяш филтри за Invoice, само `{ not: 'CANCELLED' }`.

### BizDocument статуси (`BizDocStatus` enum)
```
ACTIVE → REVIEWED → MATCHED
       → NEEDS_REVIEW
       → REJECTED   (дубликат или грешен документ)
       → ARCHIVED   (проформа, order confirmation — не е реална фактура)
```
При KPI изчисления винаги: `status: { notIn: ['REJECTED', 'ARCHIVED'] }`.

### Какво се брои като разход
Само `BizDocument` с `docType: 'INVOICE_IN'` и `status NOT IN ('REJECTED', 'ARCHIVED')`.

### Какво се брои като приход
Само `Invoice` с `status != 'CANCELLED'`.

---

## Структура на базата (основните таблици)

| Таблица | Роля |
|---------|------|
| `invoices` | Изходящи фактури към клиенти |
| `bizDocuments` | Входящи документи (фактури, проформи, оферти) |
| `payments` | Банкови транзакции от CSV |
| `reconciliationLinks` | Връзки payment ↔ bizDocument |
| `clients` | CRM — клиенти на студиото |
| `counterparties` | Доставчици / контрагенти (за bizDocuments) |
| `suppliers` | Legacy доставчици (за Purchase таблицата) |
| `projects` | Проекти с код, клиент, финанси |
| `expenses` | Режийни разходи (наем, счетоводство, ...) |
| `inventoryItems` | Склад |
| `alerts` | Системни сигнали (ДДС, просрочия, ...) |

`ReconciliationLink` има две полета: `sourceDocId` (payment) и `targetDocId` (bizDocument) — **не** `bizDocumentId`.

---

## Важни файлове

```
backend/src/
├── routes/
│   ├── dashboard.js        ← KPI логика, monthly P&L — чети тук при въпроси за числата
│   ├── bizDocuments.js     ← CRUD за входящи документи
│   ├── reconciliation.js   ← match/unmatch логика
│   └── ai.js               ← Gemini chat + PDF extraction
├── lib/
│   ├── aiParser.js         ← PDF → JSON (Gemini)
│   ├── gmailScanner.js     ← следи Gmail за нови фактури
│   └── reconciliationEngine.js  ← автоматично съпоставяне
backend/scripts/            ← еднократни migration/cleanup скриптове (не за production)
```

---

## Локален старт

```bash
# 1. Backend
cd backend
cp .env.example .env       # попълни GEMINI_API_KEY, DATABASE_URL, JWT_SECRET
npm install
npx prisma db push         # само при първо стартиране
npm run dev                # http://localhost:3001

# 2. Frontend (нов терминал)
cd frontend
npm install
npm run dev                # http://localhost:3000
```

Prisma Studio (GUI за базата):
```bash
cd backend && npm run db:studio   # http://localhost:5555
```

---

## Нов потребител / смяна на парола

```bash
cd backend
node scripts/reset-password.js
```

---

## AI интеграция

Моделът е **Gemini 2.5 Flash**. При недостъпност — автоматично fallback към Groq (llama-3.3-70b), после OpenRouter (gpt-4.1-mini).

```
GEMINI_API_KEY   ← задължителен
GROQ_API_KEY     ← опционален fallback
OPENROUTER_API_KEY ← опционален fallback
```

PDF парсването (`/api/ai/extract`) изпраща base64 PDF директно към Gemini Vision.

---

## Банкова рекон.

1. Импортирай CSV от банката → `POST /api/payments/import`
2. Системата автоматично търси съвпадения по сума + дата ± 5 дни
3. Ръчни съвпадения от `/reconciliation` страницата
4. Payment статуси: `UNMATCHED → PARTIAL → MATCHED`

---

## Deployment

| Среда | URL | Branch |
|-------|-----|--------|
| Production FE | Vercel (auto-deploy) | `master` |
| Production BE | Railway (auto-deploy) | `master` |
| Database | Supabase | — |

Railway environment variables задължително трябва да имат:
- `DATABASE_URL`, `DIRECT_URL`
- `JWT_SECRET`, `ADMIN_PASSWORD`
- `GEMINI_API_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`
- `FRONTEND_URL` (Vercel URL-ът)
- `ALERT_EMAIL_TO`

---

## Чести грешки

**`PrismaClientValidationError: Expected PaymentStatus`**
→ Опитваш се да филтрираш Invoice по статус `'ARCHIVED'`. Не е валидна стойност. Използвай само `PENDING`, `PAID`, `OVERDUE`, `CANCELLED`.

**Числата в дашборда не се променят след cleanup**
→ Провери дали BizDocument статусът е правилно сетнат. `NEEDS_REVIEW` и `IMPORTED` се броят в разходите — само `REJECTED` и `ARCHIVED` се изключват.

**PDF не се парсва правилно**
→ Провери `GEMINI_API_KEY`. При грешка в AI парсването документът влиза с `status: NEEDS_REVIEW` и нулева сума.

**Дублирани документи**
→ Честа причина: един документ импортиран веднъж от Gmail и веднъж от Drive. Reject-ни единия чрез Prisma Studio или cleanup скрипт в `backend/scripts/`.

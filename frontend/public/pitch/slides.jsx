// All 12 slides for Botema ERP deck

const TOTAL = 12;

// 01 — COVER
const Slide01 = () => (
  <SlideFrame style={{ padding: 0, justifyContent: 'space-between' }}>
    {/* ambient glow */}
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      background: `radial-gradient(circle at 22% 35%, color-mix(in oklab, ${C.accent} 16%, transparent), transparent 55%)`,
    }}/>
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.4,
      backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
      backgroundSize: '80px 80px',
      maskImage: 'radial-gradient(circle at 50% 50%, black 30%, transparent 80%)',
    }}/>

    <div style={{
      position: 'relative', padding: `60px ${SPACING.paddingX}px 0`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <BotemaMark size={48}/>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.text, letterSpacing: '-0.01em' }}>Studio Botema</div>
          <div style={{ fontSize: 24, color: C.textFaint, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', marginTop: 4 }}>ЕООД · Sofia</div>
        </div>
      </div>
      <div style={{ fontSize: 24, color: C.textDim, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>v1.0 · May 2026</div>
    </div>

    <div style={{ position: 'relative', padding: `0 ${SPACING.paddingX}px`, display: 'flex', flexDirection: 'column', gap: 28 }}>
      <Eyebrow color={C.accent} style={{ color: C.accent, fontSize: 24 }}>Internal Showcase · Вътрешен преглед</Eyebrow>
      <h1 style={{
        fontSize: TYPE_SCALE.display, fontWeight: 600, lineHeight: 0.95,
        letterSpacing: '-0.045em', color: C.text, margin: 0,
      }}>
        Botema ERP.<br/>
        <span style={{
          background: `linear-gradient(120deg, ${C.text} 30%, ${C.accent} 90%)`,
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>Една система.</span>
      </h1>
      <Body size={TYPE_SCALE.subtitle} color={C.textMuted} style={{ maxWidth: 1100, fontWeight: 400 }}>
        От Excel хаос към една ERP система.
        <span style={{ color: C.textFaint, display: 'block', fontSize: TYPE_SCALE.body, marginTop: 6 }}>From Excel chaos to one ERP. Built in 2026.</span>
      </Body>
    </div>

    <div style={{
      position: 'relative', padding: `0 ${SPACING.paddingX}px 60px`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
    }}>
      <div style={{ display: 'flex', gap: 60 }}>
        {[
          ['10', 'Модули / Modules'],
          ['64', 'Фактури / Invoices'],
          ['40+', 'Клиенти / Clients'],
          ['1', 'Език за всичко'],
        ].map(([n, l]) => (
          <div key={l}>
            <div style={{ fontSize: 56, fontWeight: 700, color: C.text, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>{n}</div>
            <div style={{ fontSize: 24, color: C.textDim, fontWeight: 500, marginTop: 6 }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 24, color: C.textFaint, textAlign: 'right' }}>
        <div>Studio Botema ЕООД</div>
        <div style={{ marginTop: 4 }}>Lighting · Furniture · Interior</div>
      </div>
    </div>
  </SlideFrame>
);

// 02 — PROBLEM
const Slide02 = () => (
  <SlideFrame>
    <SlideHeader num={2} total={TOTAL} label="Problem"/>
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center', marginTop: 40 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.titleGap }}>
        <Eyebrow>01 · Проблемът / The problem</Eyebrow>
        <SlideTitle bg="Excel-и навсякъде." en="Spreadsheets everywhere."/>
        <Body style={{ maxWidth: 640 }}>
          Фактури в един файл. Доставки в друг. Склад — на лист хартия.
          Никой не знае колко дължи кой клиент в момента.
        </Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
          {[
            ['12+', 'различни Excel файла'],
            ['~6h', 'на седмица за съгласуване'],
            ['0', 'единен източник на истина'],
          ].map(([n, l]) => (
            <div key={l} style={{ display: 'flex', alignItems: 'baseline', gap: 24 }}>
              <span style={{ fontSize: 56, fontWeight: 700, color: C.red, letterSpacing: '-0.03em', minWidth: 110, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
              <span style={{ fontSize: TYPE_SCALE.small, color: C.textMuted }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Visual: stacked, chaotic spreadsheets */}
      <div style={{ position: 'relative', height: 540 }}>
        {[
          { x: 0, y: 0, rot: -6, label: 'fakturi_2024_FINAL_v3.xlsx', tint: 0.35 },
          { x: 80, y: 60, rot: 4, label: 'sklad_NEW.xlsx', tint: 0.55 },
          { x: 30, y: 160, rot: -2, label: 'klienti_ARC.xlsx', tint: 0.7 },
          { x: 120, y: 240, rot: 7, label: 'razhodi_mart.xlsx', tint: 0.85 },
          { x: 50, y: 340, rot: -4, label: 'proekti_2025.xlsx', tint: 1 },
        ].map((s, i) => (
          <div key={i} style={{
            position: 'absolute', left: s.x, top: s.y,
            transform: `rotate(${s.rot}deg)`,
            width: 380, height: 220,
            background: C.bgCard, border: `1px solid ${C.border}`,
            borderRadius: 10, opacity: s.tint,
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '8px 12px', borderBottom: `1px solid ${C.border}`,
              fontSize: 11, color: C.textDim, fontFamily: 'ui-monospace, monospace',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ width: 10, height: 10, background: C.green, borderRadius: 2 }}/>
              {s.label}
            </div>
            <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 1 }}>
              {Array.from({length: 35}).map((_, k) => (
                <div key={k} style={{
                  height: 22, background: k < 5 ? C.bgHover : C.bgSubtle,
                  borderRight: `1px solid ${C.borderSubtle}`,
                  borderBottom: `1px solid ${C.borderSubtle}`,
                }}/>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  </SlideFrame>
);

// 03 — SOLUTION
const Slide03 = () => (
  <SlideFrame>
    <SlideHeader num={3} total={TOTAL} label="Solution"/>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 60, textAlign: 'center' }}>
      <Eyebrow color={C.accent}>02 · Решението / The solution</Eyebrow>
      <h1 style={{
        fontSize: TYPE_SCALE.hero, fontWeight: 600, letterSpacing: '-0.04em',
        color: C.text, margin: 0, lineHeight: 1, maxWidth: 1500,
      }}>
        Една база данни. Един екран.<br/>
        <span style={{ color: C.textDim }}>One database. One screen.</span>
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, width: '100%', maxWidth: 1500, marginTop: 20 }}>
        {[
          ['Real-time', 'Всичко синхронно — фактура, склад, проект.'],
          ['Search-first', '40+ клиента, стотици фактури — едно поле.'],
          ['AI-native', 'Питаш на български. Отговаря с числа.'],
        ].map(([t, d]) => (
          <div key={t} style={{
            background: C.bgCard, border: `1px solid ${C.border}`,
            borderRadius: 18, padding: '32px 28px', textAlign: 'left',
          }}>
            <div style={{ fontSize: TYPE_SCALE.subtitle, fontWeight: 600, color: C.text, letterSpacing: '-0.02em' }}>{t}</div>
            <div style={{ fontSize: TYPE_SCALE.small, color: C.textMuted, marginTop: 14, lineHeight: 1.4 }}>{d}</div>
          </div>
        ))}
      </div>
    </div>
  </SlideFrame>
);

// 04 — DASHBOARD SCREEN
const Slide04 = () => (
  <SlideFrame>
    <SlideHeader num={4} total={TOTAL} label="Dashboard"/>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 30, marginBottom: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Eyebrow>03 · Дашборд / Dashboard</Eyebrow>
        <SlideTitle bg="Цялата фирма на един екран." en="The whole company on one screen."/>
      </div>
      <div style={{ fontSize: TYPE_SCALE.small, color: C.textMuted, maxWidth: 480, textAlign: 'right', lineHeight: 1.4 }}>
        KPI · графики · последни фактури · pending документи — всичко тук.
      </div>
    </div>
    <WindowChrome height={680} label="botema-erp · Dashboard">
      <DashboardMock/>
    </WindowChrome>
  </SlideFrame>
);

// 05 — MODULES (10 cards)
const Slide05 = () => {
  const modules = [
    ['Дашборд', 'Dashboard', 'KPI · графики · pending'],
    ['Фактури', 'Invoices', 'BGN + EUR · статуси'],
    ['Доставки', 'Purchases', 'входящи · доставчици'],
    ['Склад', 'Inventory', 'наличности · мостри'],
    ['Проекти', 'Projects', '1717.xxx · финанси'],
    ['Клиенти', 'Clients', '40+ партньора'],
    ['Доставчици', 'Suppliers', 'Lodes · Karimoku · Alphaluce'],
    ['Разходи', 'Expenses', 'наем · реклама · транспорт'],
    ['Документи', 'Documents', 'Gmail auto-detect'],
    ['AI Асистент', 'AI Assistant', 'Claude · на български'],
  ];
  return (
    <SlideFrame>
      <SlideHeader num={5} total={TOTAL} label="Modules"/>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 30, marginBottom: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Eyebrow>04 · Модулите / Modules</Eyebrow>
          <SlideTitle bg="Десет модула. Една логика." en="Ten modules. One logic."/>
        </div>
        <div style={{ fontSize: 80, fontWeight: 700, color: C.accent, letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>10</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 16, flex: 1 }}>
        {modules.map(([bg, en, sub], i) => (
          <div key={bg} style={{
            background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 14,
            padding: 22, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          }}>
            <div style={{ fontSize: 13, color: C.textFaint, fontWeight: 600, letterSpacing: '0.1em', fontVariantNumeric: 'tabular-nums' }}>{String(i+1).padStart(2,'0')}</div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 600, color: C.text, letterSpacing: '-0.02em' }}>{bg}</div>
              <div style={{ fontSize: 14, color: C.textDim, marginTop: 2 }}>{en}</div>
              <div style={{ fontSize: 13, color: C.textFaint, marginTop: 14, lineHeight: 1.35 }}>{sub}</div>
            </div>
          </div>
        ))}
      </div>
    </SlideFrame>
  );
};

// 06 — AI ASSISTANT (the magic)
const Slide06 = () => (
  <SlideFrame>
    <SlideHeader num={6} total={TOTAL} label="AI"/>
    <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 48, flex: 1, marginTop: 30, alignItems: 'stretch' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, justifyContent: 'center' }}>
        <Eyebrow color={C.purple}>05 · Магията / The magic</Eyebrow>
        <SlideTitle bg="Питаш. Отговаря." en="Ask. Get answers."/>
        <Body>
          AI асистентът е с пълен достъп до базата.
          На български. Без SQL, без таблици — просто въпрос.
        </Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          {[
            'Кой ми дължи най-много?',
            'Какъв е маржът ми за март?',
            'Колко артикула от Lodes са в склада?',
          ].map(q => (
            <div key={q} style={{
              padding: '12px 18px', background: C.bgCard, border: `1px solid ${C.border}`,
              borderRadius: 12, fontSize: 18, color: C.textMuted, fontStyle: 'italic',
            }}>"{q}"</div>
          ))}
        </div>
      </div>
      <WindowChrome height={680} label="botema-erp · AI Assistant">
        <AIAssistantMock/>
      </WindowChrome>
    </div>
  </SlideFrame>
);

// 07 — GMAIL AUTOMATION
const Slide07 = () => (
  <SlideFrame>
    <SlideHeader num={7} total={TOTAL} label="Automation"/>
    <div style={{ marginTop: 30, marginBottom: 60, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Eyebrow>06 · Gmail автоматизация / Email auto-capture</Eyebrow>
      <SlideTitle bg="Фактурата идва. Системата я знае." en="The invoice arrives. The system knows."/>
    </div>

    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
      {[
        { n: '01', t: 'Gmail', sub: 'Доставчик праща PDF', glyph: '✉' },
        { n: '02', t: 'Pub/Sub', sub: 'Webhook trigger', glyph: '⌁' },
        { n: '03', t: 'Parser', sub: 'AI извлича данни', glyph: '✦' },
        { n: '04', t: 'Преглед', sub: 'Чакаш approval', glyph: '◐' },
        { n: '05', t: 'ERP', sub: 'Записано в базата', glyph: '✓' },
      ].map((s, i, arr) => (
        <React.Fragment key={s.n}>
          <div style={{
            flex: 1, background: C.bgCard, border: `1px solid ${C.border}`,
            borderRadius: 16, padding: 28, display: 'flex', flexDirection: 'column', gap: 16,
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: -12, right: -12,
              fontSize: 90, fontWeight: 700, color: C.bgHover, lineHeight: 1, letterSpacing: '-0.04em',
            }}>{s.n}</div>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: i === 4 ? `color-mix(in oklab, ${C.green} 18%, transparent)` : C.bgHover,
              color: i === 4 ? C.green : C.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, position: 'relative', zIndex: 1,
            }}>{s.glyph}</div>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: 26, fontWeight: 600, color: C.text, letterSpacing: '-0.02em' }}>{s.t}</div>
              <div style={{ fontSize: 16, color: C.textDim, marginTop: 4 }}>{s.sub}</div>
            </div>
          </div>
          {i < arr.length - 1 && (
            <div style={{ color: C.textFaint, fontSize: 28, flexShrink: 0 }}>→</div>
          )}
        </React.Fragment>
      ))}
    </div>

    <div style={{ marginTop: 50, display: 'flex', gap: 60 }}>
      <div>
        <div style={{ fontSize: 64, fontWeight: 700, color: C.green, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>~30s</div>
        <div style={{ fontSize: 18, color: C.textDim, marginTop: 4 }}>от имейл до запис в системата</div>
      </div>
      <div>
        <div style={{ fontSize: 64, fontWeight: 700, color: C.text, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>0</div>
        <div style={{ fontSize: 18, color: C.textDim, marginTop: 4 }}>ръчно набиране</div>
      </div>
    </div>
  </SlideFrame>
);

// 08 — IMPACT
const Slide08 = () => (
  <SlideFrame bg="#0a0a0c">
    <SlideHeader num={8} total={TOTAL} label="Impact"/>
    <div style={{ marginTop: 30, marginBottom: 70, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Eyebrow color={C.green}>07 · Ефект / Impact</Eyebrow>
      <SlideTitle bg="По-малко време. По-малко грешки. Повече проекти." en="Less time. Fewer errors. More projects."/>
    </div>

    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 18 }}>
      {[
        { n: '−85%', l: 'време за месечно отчитане', s: 'от ~6 часа на ~50 минути', c: C.green },
        { n: '+3×', l: 'повече проекти / месец без увеличение на екип', s: 'без admin overhead', c: C.accent },
        { n: '0', l: 'изгубени фактури', s: 'Gmail auto-capture', c: C.purple },
        { n: '<1s', l: 'отговор от AI асистент', s: 'каквото и да попиташ', c: C.orange },
      ].map((m) => (
        <div key={m.l} style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: 18, padding: '40px 44px',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.5,
            background: `radial-gradient(circle at 90% 100%, color-mix(in oklab, ${m.c} 15%, transparent), transparent 60%)`,
          }}/>
          <div style={{ position: 'relative' }}>
            <div style={{
              fontSize: 130, fontWeight: 700, color: m.c, letterSpacing: '-0.04em',
              fontVariantNumeric: 'tabular-nums', lineHeight: 1,
            }}>{m.n}</div>
          </div>
          <div style={{ position: 'relative' }}>
            <div style={{ fontSize: 26, fontWeight: 600, color: C.text, letterSpacing: '-0.01em', maxWidth: 460 }}>{m.l}</div>
            <div style={{ fontSize: 16, color: C.textFaint, marginTop: 6 }}>{m.s}</div>
          </div>
        </div>
      ))}
    </div>
  </SlideFrame>
);

// 09 — STACK
const Slide09 = () => {
  const rows = [
    ['Frontend', 'Next.js 14 · TypeScript · Tailwind', 'PWA · App Router'],
    ['Backend', 'Node.js · Express · Prisma ORM', 'REST · JWT'],
    ['Database', 'PostgreSQL (Supabase)', 'Real-time · Backups'],
    ['AI', 'Anthropic Claude API', 'Schema-aware · BG'],
    ['Email', 'Gmail API · Google Pub/Sub', 'Webhook · auto-watch'],
    ['Storage', 'Google Drive API', 'Документи · PDF'],
    ['Deploy', 'Vercel + Railway', 'GitHub Actions CI/CD'],
  ];
  return (
    <SlideFrame>
      <SlideHeader num={9} total={TOTAL} label="Stack"/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 100, flex: 1, marginTop: 30 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28, justifyContent: 'center' }}>
          <Eyebrow>08 · Стек / Tech stack</Eyebrow>
          <SlideTitle bg="Production grade. Не toy project." en="Production grade. Not a toy."/>
          <Body>
            Същият стек като в Vercel и Linear.
            Deployment с един git push. Real database с backups.
          </Body>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ borderTop: `1px solid ${C.border}` }}>
            {rows.map(([cat, tech, note]) => (
              <div key={cat} style={{
                display: 'grid', gridTemplateColumns: '180px 1fr 220px',
                alignItems: 'baseline', padding: '22px 0',
                borderBottom: `1px solid ${C.border}`, gap: 24,
              }}>
                <div style={{ fontSize: 13, color: C.textFaint, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase' }}>{cat}</div>
                <div style={{ fontSize: 24, fontWeight: 500, color: C.text, letterSpacing: '-0.01em' }}>{tech}</div>
                <div style={{ fontSize: 14, color: C.textDim, textAlign: 'right' }}>{note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SlideFrame>
  );
};

// 10 — BEFORE / AFTER
const Slide10 = () => (
  <SlideFrame>
    <SlideHeader num={10} total={TOTAL} label="Before & After"/>
    <div style={{ marginTop: 30, marginBottom: 50 }}>
      <Eyebrow>09 · Преди / След · Before / After</Eyebrow>
      <SlideTitle bg="Един и същи понеделник, преди и сега." en="The same Monday, before and after." style={{ marginTop: 16 }}/>
    </div>
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
      {[
        {
          title: 'ПРЕДИ', en: 'Before', color: C.red,
          items: [
            ['09:00', 'Отваряш 4 Excel файла, за да видиш приходите'],
            ['10:30', 'Звъниш на счетоводител: "Платиха ли ARC?"'],
            ['11:45', 'Не намираш фактура от Lodes — в имейла някъде'],
            ['14:00', 'Преписваш суми между файлове, риск от грешка'],
            ['17:00', 'Отчет за деня: непълен, ще го довършиш утре'],
          ],
        },
        {
          title: 'СЛЕД', en: 'After', color: C.green,
          items: [
            ['09:00', 'Отваряш дашборда. Виждаш всичко.'],
            ['09:02', 'Питаш AI: "Кой ми дължи?" — готов отговор.'],
            ['09:05', 'Lodes фактурата вече е в системата (Gmail capture)'],
            ['09:10', 'Една заявка → запис → отчет. Без грешки.'],
            ['09:15', 'Затваряш лаптопа. Понеделникът свърши.'],
          ],
        },
      ].map((col) => (
        <div key={col.title} style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: 18, padding: 36, display: 'flex', flexDirection: 'column', gap: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }}/>
            <span style={{ fontSize: 28, fontWeight: 700, color: col.color, letterSpacing: '0.08em' }}>{col.title}</span>
            <span style={{ fontSize: 16, color: C.textFaint, letterSpacing: '0.04em' }}>· {col.en}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {col.items.map(([t, d], i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '90px 1fr',
                gap: 18, padding: '14px 0',
                borderTop: i === 0 ? 'none' : `1px solid ${C.borderSubtle}`,
              }}>
                <span style={{ fontSize: 16, color: C.textFaint, fontVariantNumeric: 'tabular-nums', fontFamily: 'ui-monospace, monospace' }}>{t}</span>
                <span style={{ fontSize: 18, color: C.textMuted, lineHeight: 1.4 }}>{d}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </SlideFrame>
);

// 11 — ROADMAP
const Slide11 = () => (
  <SlideFrame>
    <SlideHeader num={11} total={TOTAL} label="Roadmap"/>
    <div style={{ marginTop: 30, marginBottom: 60 }}>
      <Eyebrow>10 · Roadmap / What's next</Eyebrow>
      <SlideTitle bg="Какво следва." en="What's next." style={{ marginTop: 16 }}/>
    </div>
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
      {[
        {
          q: 'Q3 2026', status: 'Сега · Now', color: C.green,
          items: ['PWA офлайн режим', 'Експорт към НАП формат', 'Multi-currency reports', 'Mobile push notifications'],
        },
        {
          q: 'Q4 2026', status: 'Скоро · Soon', color: C.accent,
          items: ['Auto-reconciliation банка', 'Складови баркодове', 'Client portal (B2B)', 'Cashflow forecasting'],
        },
        {
          q: '2027', status: 'Визия · Vision', color: C.purple,
          items: ['AI авто-фактуриране', 'Voice input (български)', 'CRM модул', 'White-label за други студия'],
        },
      ].map((col) => (
        <div key={col.q} style={{
          background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: 18, padding: 32, display: 'flex', flexDirection: 'column', gap: 20,
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: col.color, letterSpacing: '0.16em', textTransform: 'uppercase' }}>{col.status}</div>
            <div style={{ fontSize: 44, fontWeight: 600, color: C.text, letterSpacing: '-0.03em', marginTop: 8 }}>{col.q}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {col.items.map(it => (
              <div key={it} style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                <span style={{ width: 6, height: 6, background: col.color, borderRadius: '50%', flexShrink: 0, transform: 'translateY(-2px)' }}/>
                <span style={{ fontSize: 18, color: C.textMuted, lineHeight: 1.4 }}>{it}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </SlideFrame>
);

// 12 — CLOSING
const Slide12 = () => (
  <SlideFrame style={{ padding: 0, justifyContent: 'space-between' }}>
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      background: `radial-gradient(circle at 78% 70%, color-mix(in oklab, ${C.accent} 14%, transparent), transparent 55%)`,
    }}/>

    <div style={{ position: 'relative', padding: `60px ${SPACING.paddingX}px 0`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <BotemaMark size={36}/>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Studio Botema · ERP</div>
      </div>
      <div style={{ fontSize: 14, color: C.textFaint, fontVariantNumeric: 'tabular-nums' }}>12 / 12</div>
    </div>

    <div style={{
      position: 'relative', padding: `0 ${SPACING.paddingX}px`,
      display: 'flex', flexDirection: 'column', gap: 30,
    }}>
      <Eyebrow color={C.accent}>Край · Closing</Eyebrow>
      <h1 style={{
        fontSize: TYPE_SCALE.display, fontWeight: 600, lineHeight: 0.95,
        letterSpacing: '-0.045em', color: C.text, margin: 0, maxWidth: 1500,
      }}>
        Това е операционната<br/>система на Botema.
      </h1>
      <Body size={TYPE_SCALE.subtitle} color={C.textMuted} style={{ maxWidth: 1100 }}>
        This is the operating system of the studio.
      </Body>
    </div>

    <div style={{
      position: 'relative', padding: `0 ${SPACING.paddingX}px 70px`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 60,
    }}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {['Open it.', 'Use it.', 'Break it.', 'Tell me what to fix.'].map(t => (
          <div key={t} style={{
            padding: '14px 22px', border: `1px solid ${C.border}`,
            borderRadius: 999, fontSize: 22, color: C.textMuted, fontWeight: 500,
          }}>{t}</div>
        ))}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 14, color: C.textFaint, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600 }}>Built with care</div>
        <div style={{ fontSize: 22, color: C.text, marginTop: 8, fontWeight: 600 }}>office@studiobotema.com</div>
        <div style={{ fontSize: 14, color: C.textFaint, marginTop: 4 }}>Studio Botema ЕООД · 2026</div>
      </div>
    </div>
  </SlideFrame>
);

window.SLIDES = [Slide01, Slide02, Slide03, Slide04, Slide05, Slide06, Slide07, Slide08, Slide09, Slide10, Slide11, Slide12];

// Botema ERP deck — high-fidelity mockups of the actual app screens
// (rebuilt from the codebase's components — same colors, same density)

const KPICardMock = ({ label, value, sub, color = C.accent, glyph }) => (
  <div style={{
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.textDim }}>{label}</div>
      <div style={{
        width: 22, height: 22, borderRadius: 6,
        background: `color-mix(in oklab, ${color} 18%, transparent)`,
        color, fontSize: 11, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{glyph}</div>
    </div>
    <div style={{ fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    <div style={{ fontSize: 11, color: C.textFaint }}>{sub}</div>
  </div>
);

const RevenueChartMock = () => {
  const data = [42, 58, 71, 65, 88, 95, 78, 110, 124, 98, 132, 145];
  const max = Math.max(...data);
  const months = ['Я', 'Ф', 'М', 'А', 'М', 'Ю', 'Ю', 'А', 'С', 'О', 'Н', 'Д'];
  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: 18,
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Приходи по месец</div>
        <div style={{ fontSize: 10, color: C.textFaint }}>BGN</div>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        {data.map((v, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: '100%',
              height: `${(v / max) * 100}%`,
              background: `linear-gradient(180deg, ${C.accent}, color-mix(in oklab, ${C.accent} 35%, transparent))`,
              borderRadius: '3px 3px 0 0',
              minHeight: 4,
            }}/>
            <div style={{ fontSize: 9, color: C.textFaint }}>{months[i]}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const TopClientsMock = () => {
  const clients = [
    ['ARC Studio', 28],
    ['Маркам', 22],
    ['Atelier 17', 17],
    ['Form Living', 14],
    ['Domus', 11],
  ];
  const max = clients[0][1];
  return (
    <div style={{
      background: C.bgCard,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: 18,
      width: 240,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>Топ клиенти</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {clients.map(([name, v]) => (
          <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
              <span style={{ color: C.textMuted }}>{name}</span>
              <span style={{ color: C.textDim, fontVariantNumeric: 'tabular-nums' }}>{v}k</span>
            </div>
            <div style={{ height: 4, background: C.bgHover, borderRadius: 2 }}>
              <div style={{ width: `${(v / max) * 100}%`, height: '100%', background: C.accent, borderRadius: 2 }}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const InvoiceRow = ({ num, client, amount, status, statusColor }) => (
  <div style={{
    display: 'grid',
    gridTemplateColumns: '90px 1fr auto auto',
    alignItems: 'center',
    gap: 12,
    padding: '10px 14px',
    borderBottom: `1px solid ${C.borderSubtle}`,
    fontSize: 11,
  }}>
    <span style={{ color: C.textDim, fontVariantNumeric: 'tabular-nums' }}>{num}</span>
    <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client}</span>
    <span style={{ color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{amount}</span>
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
      background: `color-mix(in oklab, ${statusColor} 20%, transparent)`,
      color: statusColor, letterSpacing: '0.05em', textTransform: 'uppercase',
    }}>{status}</span>
  </div>
);

const InvoiceTableMock = ({ title, rows }) => (
  <div style={{
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    overflow: 'hidden',
    flex: 1,
  }}>
    <div style={{ padding: 14, borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 600, color: C.text }}>{title}</div>
    <div>{rows.map((r, i) => <InvoiceRow key={i} {...r} />)}</div>
  </div>
);

// Full dashboard mockup, used inside WindowChrome
const DashboardMock = () => (
  <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
    <MockSidebar active="Дашборд" />
    <main style={{ flex: 1, padding: 22, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Дашборд</div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>Studio Botema ЕООД · Преглед 2026</div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: C.bgHover, padding: 3, borderRadius: 9 }}>
          {[2024, 2025, 2026].map(y => (
            <div key={y} style={{
              padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: y === 2026 ? C.accent : 'transparent',
              color: y === 2026 ? 'white' : C.textDim,
            }}>{y}</div>
          ))}
        </div>
      </div>

      {/* alert */}
      <div style={{
        background: C.bgCard, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.orange}`,
        borderRadius: 10, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: C.text }}>
          <span style={{ width: 6, height: 6, background: C.orange, borderRadius: '50%' }}/>
          3 нови документа чакат преглед
        </div>
        <span style={{ fontSize: 10, color: C.accent, fontWeight: 600 }}>Прегледай →</span>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <KPICardMock label="Приходи" value="248 320 BGN" sub="64 фактури" color={C.green} glyph="↑"/>
        <KPICardMock label="Разходи" value="142 880 BGN" sub="входящи доставки" color={C.red} glyph="↓"/>
        <KPICardMock label="Брутен марж" value="42.5%" sub="~105 440 BGN" color={C.accent} glyph="%"/>
        <KPICardMock label="Склад" value="187" sub="артикула налични" color={C.orange} glyph="▣"/>
      </div>

      {/* charts */}
      <div style={{ display: 'flex', gap: 10, flex: 1, minHeight: 0 }}>
        <RevenueChartMock />
        <TopClientsMock />
      </div>
    </main>
  </div>
);

// AI assistant mockup
const AIAssistantMock = () => (
  <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
    <MockSidebar active="AI Асистент" />
    <main style={{ flex: 1, padding: 24, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>AI Асистент</div>
        <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>Достъп до всички данни · Claude Sonnet</div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
        {/* user msg */}
        <div style={{ alignSelf: 'flex-end', maxWidth: '70%' }}>
          <div style={{
            background: C.accent, color: 'white', padding: '10px 14px',
            borderRadius: '14px 14px 2px 14px', fontSize: 12, lineHeight: 1.45,
          }}>
            Колко неплатени фактури имам и кой клиент е най-голям длъжник?
          </div>
        </div>

        {/* assistant msg */}
        <div style={{ alignSelf: 'flex-start', maxWidth: '78%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 6,
              background: `color-mix(in oklab, ${C.purple} 20%, transparent)`,
              color: C.purple, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
            }}>✦</div>
            <span style={{ fontSize: 10, color: C.textFaint, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Botema AI</span>
          </div>
          <div style={{
            background: C.bgCard, border: `1px solid ${C.border}`, padding: '12px 16px',
            borderRadius: '14px 14px 14px 2px', fontSize: 12, lineHeight: 1.5, color: C.textMuted,
          }}>
            <div>Към момента имате <span style={{ color: C.text, fontWeight: 600 }}>7 неплатени фактури</span> на обща стойност <span style={{ color: C.orange, fontWeight: 600 }}>34 280 BGN</span>.</div>
            <div style={{ marginTop: 8 }}>Най-голям длъжник: <span style={{ color: C.text, fontWeight: 600 }}>ARC Studio</span> — 3 фактури, 18 450 BGN, най-старата от 47 дни.</div>
            <div style={{
              marginTop: 12, padding: 10, background: C.bgSubtle,
              borderRadius: 8, display: 'flex', gap: 12, fontSize: 10,
            }}>
              <span style={{ color: C.textFaint }}>SQL:</span>
              <span style={{ color: C.green, fontFamily: 'ui-monospace, monospace' }}>SELECT * FROM invoices WHERE status='UNPAID'</span>
            </div>
          </div>
        </div>

        {/* typing */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 30, marginTop: -6 }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{
              width: 5, height: 5, borderRadius: '50%', background: C.textFaint,
              animation: `typing-pulse 1.2s ${i * 0.15}s infinite`,
            }}/>
          ))}
        </div>
      </div>

      {/* input */}
      <div style={{
        marginTop: 16, background: C.bgHover, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: '10px 14px', fontSize: 12, color: C.textFaint,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Попитай нещо за фирмата…</span>
        <span style={{ fontSize: 10, color: C.textFaint }}>⌘ + ↵</span>
      </div>
    </main>
  </div>
);

Object.assign(window, {
  KPICardMock, RevenueChartMock, TopClientsMock,
  InvoiceRow, InvoiceTableMock, DashboardMock, AIAssistantMock,
});

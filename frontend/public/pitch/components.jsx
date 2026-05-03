// Botema ERP deck — shared components, tokens, mockups
// Aesthetic: dark Apple-style (matches the actual ERP product). Boutique, premium, quiet.

// ─────────────────────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────────────────────
const TYPE_SCALE = {
  display: 128,
  hero: 96,
  title: 72,
  subtitle: 48,
  body: 34,
  small: 28,
  micro: 22,
  eyebrow: 18,
};

const SPACING = {
  paddingTop: 100,
  paddingBottom: 100,
  paddingX: 120,
  titleGap: 52,
  itemGap: 28,
  sectionGap: 80,
};

// Colors — pulled directly from the ERP's globals.css
const C = {
  bg: '#09090b',
  bgCard: '#111113',
  bgHover: '#1d1d1f',
  bgSubtle: '#161618',
  border: '#27272a',
  borderSubtle: '#1a1a1c',
  text: '#fafafa',
  textMuted: '#a1a1aa',
  textDim: '#71717a',
  textFaint: '#52525b',
  accent: 'var(--accent, #0a84ff)',
  green: '#30d158',
  red: '#ff453a',
  orange: '#ff9f0a',
  purple: '#bf5af2',
};

// ─────────────────────────────────────────────────────────────
// SHARED LAYOUT PRIMITIVES
// ─────────────────────────────────────────────────────────────

const SlideFrame = ({ children, style, bg = C.bg }) => (
  <div style={{
    width: '100%',
    height: '100%',
    background: bg,
    color: C.text,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", sans-serif',
    fontFeatureSettings: '"ss01", "cv11"',
    padding: `${SPACING.paddingTop}px ${SPACING.paddingX}px ${SPACING.paddingBottom}px`,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden',
    ...style,
  }}>
    {children}
  </div>
);

const Eyebrow = ({ children, color = C.textDim, style }) => (
  <div style={{
    fontSize: 26,
    fontWeight: 600,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color,
    ...style,
  }}>{children}</div>
);

const SlideTitle = ({ bg, en, style }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, ...style }}>
    <h1 style={{
      fontSize: TYPE_SCALE.title,
      fontWeight: 600,
      letterSpacing: '-0.03em',
      lineHeight: 1.05,
      color: C.text,
      margin: 0,
    }}>{bg}</h1>
    {en && (
      <div style={{
        fontSize: TYPE_SCALE.small,
        fontWeight: 400,
        color: C.textDim,
        letterSpacing: '-0.01em',
      }}>{en}</div>
    )}
  </div>
);

const Body = ({ children, color = C.textMuted, size = TYPE_SCALE.body, style }) => (
  <p style={{
    fontSize: size,
    fontWeight: 400,
    lineHeight: 1.4,
    color,
    margin: 0,
    letterSpacing: '-0.01em',
    textWrap: 'pretty',
    ...style,
  }}>{children}</p>
);

const SlideHeader = ({ num, total, label }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    color: C.textFaint,
    fontSize: 24,
    fontWeight: 500,
    letterSpacing: '0.04em',
    flexShrink: 0,
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <BotemaMark size={28} />
      <span style={{ color: C.textDim, fontWeight: 600 }}>Studio Botema</span>
      <span style={{ opacity: 0.4 }}>·</span>
      <span>ERP System</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span>{label}</span>
      <span style={{ opacity: 0.4 }}>·</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{String(num).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// LOGO MARK (abstract — a "B" formed from a square notch)
// ─────────────────────────────────────────────────────────────
const BotemaMark = ({ size = 32, color }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <rect x="1" y="1" width="30" height="30" rx="7" stroke={color || C.text} strokeWidth="1.5" opacity="0.9"/>
    <path d="M10 9h8a4 4 0 0 1 0 8h-8V9z M10 15h9a4 4 0 0 1 0 8h-9v-8z" stroke={color || C.text} strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
  </svg>
);

// ─────────────────────────────────────────────────────────────
// MOCKUP CHROME — recreates the ERP look from Sidebar.tsx + globals.css
// ─────────────────────────────────────────────────────────────
const WindowChrome = ({ children, label = 'Studio Botema · ERP', height = 720, style }) => (
  <div style={{
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: 18,
    overflow: 'hidden',
    height,
    boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    ...style,
  }}>
    {/* traffic lights bar */}
    <div style={{
      height: 36,
      borderBottom: `1px solid ${C.border}`,
      background: '#0c0c0e',
      display: 'flex',
      alignItems: 'center',
      padding: '0 14px',
      gap: 8,
      flexShrink: 0,
    }}>
      <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57' }}/>
      <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e' }}/>
      <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#28c840' }}/>
      <div style={{ flex: 1, textAlign: 'center', color: C.textFaint, fontSize: 12, letterSpacing: '0.02em' }}>{label}</div>
    </div>
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>{children}</div>
  </div>
);

const MockSidebar = ({ active = 'Дашборд' }) => {
  const items = [
    ['Дашборд', '◐'],
    ['Фактури', '▤'],
    ['Доставки', '▦'],
    ['Склад', '▣'],
    ['Проекти', '▢'],
    ['Клиенти', '◇'],
    ['Доставчици', '◈'],
    ['Разходи', '▥'],
    ['Документи', '▧'],
    ['AI Асистент', '✦'],
  ];
  return (
    <aside style={{
      width: 200,
      background: C.bgCard,
      borderRight: `1px solid ${C.border}`,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      <div style={{ padding: '18px 16px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Studio Botema</div>
        <div style={{ fontSize: 9, color: C.textFaint, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', marginTop: 2 }}>ERP System</div>
      </div>
      <nav style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(([label, glyph]) => {
          const isActive = label === active;
          return (
            <div key={label} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 10px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 500,
              color: isActive ? C.accent : C.textDim,
              background: isActive ? 'rgba(10,132,255,0.10)' : 'transparent',
            }}>
              <span style={{ fontSize: 11, opacity: 0.85 }}>{glyph}</span>
              <span>{label}</span>
            </div>
          );
        })}
      </nav>
    </aside>
  );
};

// ─────────────────────────────────────────────────────────────
// EXPORT to globals
// ─────────────────────────────────────────────────────────────
Object.assign(window, {
  TYPE_SCALE, SPACING, C,
  SlideFrame, Eyebrow, SlideTitle, Body, SlideHeader,
  BotemaMark, WindowChrome, MockSidebar,
});

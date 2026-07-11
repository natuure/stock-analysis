const TABS = [
  { key: 'main',     label: '주식 거래대금·등락률 분석' },
  { key: 'stock',    label: '종목 분석' },
  { key: 'rsRanking', label: 'RS랭킹' },
  { key: 'screener', label: '조건 검색' },
];

export default function TopTabs({ active, onChange }) {
  return (
    <nav className="top-tabs">
      {TABS.map(t => (
        <button
          key={t.key}
          className={`top-tab${active === t.key ? ' active' : ''}`}
          onClick={() => onChange(t.key)}
        >{t.label}</button>
      ))}
    </nav>
  );
}

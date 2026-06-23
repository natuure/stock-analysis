export default function Header({ date }) {
  return (
    <header className="app-header">
      <div>
        <div className="header-title">GM Investment</div>
        <div className="header-sub">{date || '파일을 업로드하면 분석이 시작됩니다'}</div>
      </div>
    </header>
  );
}

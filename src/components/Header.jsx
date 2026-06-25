export default function Header({ date }) {
  return (
    <header className="app-header">
      <div>
        <div className="header-title">GM Investment</div>
        {date && <div className="header-sub">{date}</div>}
      </div>
    </header>
  );
}

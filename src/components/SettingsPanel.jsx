import { useState, useEffect } from 'react';

export default function SettingsPanel({ open, initialKey, onSave }) {
  const [key, setKey] = useState(initialKey || '');

  useEffect(() => { if (open) setKey(initialKey || ''); }, [open, initialKey]);

  return (
    <div className={`settings-panel${open ? ' open' : ''}`}>
      <h3>설정</h3>
      <div className="s-row">
        <label>Claude API 키</label>
        <input
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder="sk-ant-api03-..."
        />
        <p className="s-hint">AI 뉴스 분석에 사용됩니다. api.anthropic.com에서 발급.</p>
      </div>
      <button className="btn-sm" onClick={() => onSave(key.trim())}>저장</button>
    </div>
  );
}

import { useState, useRef } from 'react';

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  );
}

function Dropzone({ label, hint, onFile }) {
  const [state, setState]    = useState('');
  const [fileName, setFileName] = useState('');
  const inputRef = useRef(null);

  async function process(file) {
    setState('');
    try {
      await onFile(file);
      setFileName(file.name);
      setState('success');
    } catch {
      setState('error');
    }
  }

  return (
    <div
      className={`dz${state ? ` ${state}` : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
      onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
      onDrop={e => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) process(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
        onChange={e => { if (e.target.files[0]) process(e.target.files[0]); }}
      />
      <div className="dz-icon"><UploadIcon /></div>
      <div className="dz-label">{label}</div>
      <div className="dz-hint">{hint}</div>
      {fileName && <div className="dz-name">{fileName}</div>}
    </div>
  );
}

export default function Upload({ onVolFile, onRateFile }) {
  return (
    <div className="upload-section">
      <Dropzone label="거래대금 파일" hint="시트명 '거래대금' · .xlsx 드래그 또는 클릭" onFile={onVolFile} />
      <Dropzone label="등락률 파일"   hint="시트명 '등락률' · .xlsx 드래그 또는 클릭"   onFile={onRateFile} />
    </div>
  );
}

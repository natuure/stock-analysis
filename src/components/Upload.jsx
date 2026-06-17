import { useState, useRef } from 'react';

function Dropzone({ label, onFile }) {
  const [state, setState] = useState('');
  const inputRef = useRef(null);

  async function process(file) {
    setState('');
    try {
      await onFile(file);
      setState('success');
    } catch {
      setState('error');
    }
  }

  return (
    <div
      className={`dz dz-mini${state ? ` ${state}` : ''}`}
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
        ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
        onChange={e => { if (e.target.files[0]) process(e.target.files[0]); }}
      />
      <span className="dz-mini-label">{label}</span>
    </div>
  );
}

export default function Upload({ onDataFile, onAnalysisFile, onWeeklyFile }) {
  return (
    <div className="upload-section upload-mini">
      <Dropzone label="D" onFile={onDataFile} />
      <Dropzone label="N" onFile={onAnalysisFile} />
      <Dropzone label="W" onFile={onWeeklyFile} />
    </div>
  );
}

// src/components/terms/FileDrop.jsx
import React, { useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { SIGNED_COPY_ACCEPT } from '../../utils/terms';

/**
 * Area para soltar ou escolher o termo assinado (PDF ou foto). No celular, o
 * seletor oferece a camera.
 */
const FileDrop = ({ id, onFiles, multiple = false, label, hint, compact = false }) => {
  const [over, setOver] = useState(false);

  const take = (list) => {
    const files = [...(list || [])];
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
      className={`rounded-2xl border-2 border-dashed transition-colors ${over ? 'border-brand bg-brand/5' : 'border-gray-300 dark:border-slate-600 hover:border-brand/60'}`}
    >
      <input
        id={id}
        type="file"
        accept={SIGNED_COPY_ACCEPT}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
      <label htmlFor={id} className={`flex cursor-pointer items-center gap-3 ${compact ? 'p-3' : 'flex-col p-6 text-center'}`}>
        <span className="p-2.5 rounded-xl bg-brand/10 text-brand"><UploadCloud size={compact ? 18 : 24} /></span>
        <span className="min-w-0">
          <span className="block text-sm font-black text-gray-800 dark:text-gray-100">{label}</span>
          {hint && <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{hint}</span>}
        </span>
      </label>
    </div>
  );
};

export default FileDrop;

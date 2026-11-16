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
      className={`rounded-2xl border-2 border-dashed transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 dark:focus-within:ring-offset-[#111113] ${
        over
          ? 'border-brand bg-brand/5 dark:bg-brand/10'
          : 'border-slate-300 dark:border-zinc-700 hover:border-brand/60 bg-slate-50/50 dark:bg-zinc-900/40'
      }`}
    >
      <input
        id={id}
        type="file"
        accept={SIGNED_COPY_ACCEPT}
        multiple={multiple}
        className="sr-only peer"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
      <label
        htmlFor={id}
        className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-2xl ${
          compact ? 'p-3' : 'flex-col p-6 text-center'
        }`}
      >
        <span className="p-2.5 rounded-xl bg-brand/10 text-brand-aa" aria-hidden="true">
          <UploadCloud size={compact ? 18 : 24} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-black text-slate-900 dark:text-[#fafafa]">{label}</span>
          {hint && <span className="block text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{hint}</span>}
        </span>
      </label>
    </div>
  );
};

export default FileDrop;

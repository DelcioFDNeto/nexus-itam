import React from 'react';

const colorClasses = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    text: 'text-blue-800 dark:text-blue-300',
    hoverBg: 'group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40',
  },
  green: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-emerald-800 dark:text-emerald-300',
    hoverBg: 'group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/40',
  },
  yellow: {
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    text: 'text-amber-900 dark:text-amber-300',
    hoverBg: 'group-hover:bg-amber-100 dark:group-hover:bg-amber-900/40',
  },
  sky: {
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    text: 'text-sky-800 dark:text-sky-300',
    hoverBg: 'group-hover:bg-sky-100 dark:group-hover:bg-sky-900/40',
  },
  orange: {
    bg: 'bg-orange-50 dark:bg-orange-950/40',
    text: 'text-orange-800 dark:text-orange-300',
    hoverBg: 'group-hover:bg-orange-100 dark:group-hover:bg-orange-900/40',
  },
  red: {
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    text: 'text-rose-800 dark:text-rose-300',
    hoverBg: 'group-hover:bg-rose-100 dark:group-hover:bg-rose-900/40',
  },
  gray: {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-700 dark:text-slate-300',
    hoverBg: 'group-hover:bg-slate-200 dark:group-hover:bg-slate-700',
  },
};

const KpiCard = ({ title, value, subtitle, icon, color = 'blue', isAlert, onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  const palette = colorClasses[color === 'purple' ? 'sky' : color] || colorClasses.blue;
  const badgeTone = isAlert
    ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
    : `${palette.bg} ${palette.text}`;
  const iconTone = isAlert
    ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
    : `${palette.bg} ${palette.text} ${palette.hoverBg}`;

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full text-left bg-white dark:bg-[#111113] p-6 rounded-2xl shadow-sm border border-slate-200/90 dark:border-zinc-800 flex items-center justify-between gap-4 transition-colors group ${
        onClick
          ? 'cursor-pointer hover:shadow-md hover:border-slate-300 dark:hover:border-zinc-700 active:bg-slate-50 dark:active:bg-zinc-900 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#09090b]'
          : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-slate-600 dark:text-slate-400 text-xs font-bold uppercase tracking-wider truncate group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
          {title}
        </p>
        <h3 className="text-3xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums truncate">
          {value}
        </h3>
        {subtitle && (
          <span className={`inline-block mt-1 max-w-full truncate text-xs font-semibold px-2.5 py-0.5 rounded-full ${badgeTone}`}>
            {subtitle}
          </span>
        )}
      </div>
      <div className={`p-4 rounded-xl shrink-0 transition-colors ${iconTone}`} aria-hidden="true">
        {icon}
      </div>
    </Tag>
  );
};

export default KpiCard;

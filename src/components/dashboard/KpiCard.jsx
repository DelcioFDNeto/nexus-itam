import React from 'react';

const colorClasses = {
  blue: { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-600 dark:text-blue-400', hoverBg: 'group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40' },
  green: { bg: 'bg-green-50 dark:bg-green-950/40', text: 'text-green-600 dark:text-green-400', hoverBg: 'group-hover:bg-green-100 dark:group-hover:bg-green-900/40' },
  yellow: { bg: 'bg-yellow-50 dark:bg-yellow-950/40', text: 'text-yellow-600 dark:text-yellow-400', hoverBg: 'group-hover:bg-yellow-100 dark:group-hover:bg-yellow-900/40' },
  purple: { bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-600 dark:text-purple-400', hoverBg: 'group-hover:bg-purple-100 dark:group-hover:bg-purple-900/40' },
  orange: { bg: 'bg-orange-50 dark:bg-orange-950/40', text: 'text-orange-600 dark:text-orange-400', hoverBg: 'group-hover:bg-orange-100 dark:group-hover:bg-orange-900/40' },
  red: { bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-600 dark:text-red-400', hoverBg: 'group-hover:bg-red-100 dark:group-hover:bg-red-900/40' },
  gray: { bg: 'bg-gray-50 dark:bg-slate-700/50', text: 'text-gray-600 dark:text-gray-400', hoverBg: 'group-hover:bg-gray-100 dark:group-hover:bg-slate-700' }
};

const KpiCard = ({ title, value, subtitle, icon, color = 'blue', isAlert, onClick }) => (
    <div 
        onClick={onClick} 
        className={`bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 flex items-center justify-between hover:shadow-md transition-all group ${onClick ? 'cursor-pointer' : ''}`}
    >
        <div>
            <p className="text-gray-400 dark:text-gray-500 text-[10px] font-black uppercase tracking-widest group-hover:text-black dark:group-hover:text-white transition-colors">{title}</p>
            <h3 className="text-3xl font-black text-gray-900 dark:text-white mt-1">{value}</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isAlert ? 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400' : `${colorClasses[color]?.bg || 'bg-blue-50 dark:bg-blue-950/40'} ${colorClasses[color]?.text || 'text-blue-600 dark:text-blue-400'}`}`}>
                {subtitle}
            </span>
        </div>
        <div className={`p-4 rounded-xl ${isAlert ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400' : `${colorClasses[color]?.bg || 'bg-blue-50 dark:bg-blue-950/40'} ${colorClasses[color]?.text || 'text-blue-600 dark:text-blue-400'} ${colorClasses[color]?.hoverBg || 'group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40'}`}`}>
            {icon}
        </div>
    </div>
);

export default KpiCard;

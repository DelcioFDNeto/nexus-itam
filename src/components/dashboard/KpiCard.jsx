import React from 'react';

const colorClasses = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-600', hoverBg: 'group-hover:bg-blue-100' },
  green: { bg: 'bg-green-50', text: 'text-green-600', hoverBg: 'group-hover:bg-green-100' },
  yellow: { bg: 'bg-yellow-50', text: 'text-yellow-600', hoverBg: 'group-hover:bg-yellow-100' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600', hoverBg: 'group-hover:bg-purple-100' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-600', hoverBg: 'group-hover:bg-orange-100' },
  red: { bg: 'bg-red-50', text: 'text-red-600', hoverBg: 'group-hover:bg-red-100' },
  gray: { bg: 'bg-gray-50', text: 'text-gray-600', hoverBg: 'group-hover:bg-gray-100' }
};

const KpiCard = ({ title, value, subtitle, icon, color = 'blue', isAlert, onClick }) => (
    <div 
        onClick={onClick} 
        className={`bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 flex items-center justify-between hover:shadow-md transition-all group ${onClick ? 'cursor-pointer' : ''}`}
    >
        <div>
            <p className="text-gray-400 dark:text-gray-500 text-[10px] font-black uppercase tracking-widest group-hover:text-black transition-colors">{title}</p>
            <h3 className="text-3xl font-black text-gray-900 dark:text-white mt-1">{value}</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isAlert ? 'bg-red-100 text-red-600' : `${colorClasses[color]?.bg || 'bg-blue-50'} ${colorClasses[color]?.text || 'text-blue-600'}`}`}>
                {subtitle}
            </span>
        </div>
        <div className={`p-4 rounded-xl ${isAlert ? 'bg-red-50 text-red-600' : `${colorClasses[color]?.bg || 'bg-blue-50'} ${colorClasses[color]?.text || 'text-blue-600'} ${colorClasses[color]?.hoverBg || 'group-hover:bg-blue-100'}`}`}>
            {icon}
        </div>
    </div>
);

export default KpiCard;

import React from 'react';

const KpiCard = ({ title, value, subtitle, icon, color, isAlert, onClick }) => (
    <div 
        onClick={onClick} 
        className={`bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 flex items-center justify-between hover:shadow-md transition-all group ${onClick ? 'cursor-pointer' : ''}`}
    >
        <div>
            <p className="text-gray-400 dark:text-gray-500 text-[10px] font-black uppercase tracking-widest group-hover:text-black transition-colors">{title}</p>
            <h3 className="text-3xl font-black text-gray-900 dark:text-white mt-1">{value}</h3>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isAlert ? 'bg-red-100 text-red-600' : `bg-${color}-50 text-${color}-600`}`}>
                {subtitle}
            </span>
        </div>
        <div className={`p-4 rounded-xl ${isAlert ? 'bg-red-50 text-red-600' : `bg-${color}-50 text-${color}-600 group-hover:bg-${color}-100`}`}>
            {icon}
        </div>
    </div>
);

export default KpiCard;

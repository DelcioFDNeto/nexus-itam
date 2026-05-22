import React from 'react';

const CategoryRow = ({ label, count, icon }) => (
    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-700">
        <div className="flex items-center gap-3">
            <div className="text-gray-500 dark:text-gray-400">{icon}</div>
            <span className="font-bold text-sm text-gray-700 dark:text-gray-200">{label}</span>
        </div>
        <span className="font-mono font-black text-gray-900 dark:text-white">{count}</span>
    </div>
);

export default CategoryRow;

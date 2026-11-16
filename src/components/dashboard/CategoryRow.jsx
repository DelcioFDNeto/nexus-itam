import React from 'react';

const CategoryRow = ({ label, count, icon }) => (
    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#111113] rounded-xl border border-gray-100 dark:border-zinc-800">
        <div className="flex items-center gap-3">
            <div className="text-gray-500 dark:text-zinc-400" aria-hidden="true">{icon}</div>
            <span className="font-bold text-sm text-gray-700 dark:text-zinc-200">{label}</span>
        </div>
        <span className="font-mono font-black tabular-nums text-gray-900 dark:text-[#fafafa]">{count}</span>
    </div>
);

export default CategoryRow;

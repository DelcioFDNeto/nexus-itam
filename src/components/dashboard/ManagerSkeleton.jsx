import React from 'react';

const ManagerSkeleton = () => {
  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto animate-pulse">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <div className="h-8 w-64 bg-gray-200 dark:bg-slate-700 rounded-md mb-2"></div>
          <div className="h-4 w-48 bg-gray-200 dark:bg-slate-700 rounded-md"></div>
        </div>
        <div className="h-10 w-32 bg-gray-200 dark:bg-slate-700 rounded-xl"></div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-slate-700 flex gap-4">
          <div className="h-10 flex-1 max-w-md bg-gray-200 dark:bg-slate-700 rounded-xl"></div>
        </div>
        
        <div className="p-4 space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex justify-between items-center p-4 border border-gray-100 dark:border-slate-700 rounded-xl">
              <div className="flex gap-4 items-center">
                <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-slate-700"></div>
                <div>
                  <div className="h-5 w-40 bg-gray-200 dark:bg-slate-700 rounded-md mb-2"></div>
                  <div className="h-4 w-24 bg-gray-200 dark:bg-slate-700 rounded-md"></div>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-slate-700"></div>
                <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-slate-700"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ManagerSkeleton;

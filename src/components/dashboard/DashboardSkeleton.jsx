import React from 'react';

const DashboardSkeleton = () => {
  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 pb-24 animate-pulse">
      
      {/* HEADER SKELETON */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
            <div className="h-8 w-48 bg-gray-200 rounded-md mb-2"></div>
            <div className="h-4 w-64 bg-gray-200 rounded-md"></div>
        </div>
        <div className="flex gap-2">
            <div className="h-10 w-32 bg-gray-200 rounded-xl"></div>
            <div className="h-10 w-32 bg-gray-200 rounded-xl"></div>
        </div>
      </div>

      {/* KPI CARDS SKELETON */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-32 flex items-center justify-between">
                <div>
                    <div className="h-3 w-20 bg-gray-200 rounded-md mb-2"></div>
                    <div className="h-8 w-16 bg-gray-200 rounded-md mb-2"></div>
                    <div className="h-4 w-24 bg-gray-200 rounded-full"></div>
                </div>
                <div className="h-12 w-12 bg-gray-200 rounded-xl"></div>
            </div>
        ))}
      </div>

      {/* MAIN CONTENT SKELETON */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* LEFT COL */}
          <div className="lg:col-span-2 space-y-8">
              <div className="bg-white p-6 rounded-2xl h-80 border border-gray-200"></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white p-6 rounded-2xl h-64 border border-gray-200"></div>
                  <div className="bg-white p-6 rounded-2xl h-64 border border-gray-200"></div>
              </div>
          </div>

          {/* RIGHT COL - TIMELINE */}
          <div className="bg-white rounded-2xl h-[600px] border border-gray-200 p-6 flex flex-col gap-4">
               <div className="h-6 w-40 bg-gray-200 rounded-md"></div>
               <div className="flex-1 space-y-4 pt-4">
                   {[...Array(5)].map((_, i) => (
                       <div key={i} className="flex gap-3">
                           <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0"></div>
                           <div className="flex-1 space-y-2">
                               <div className="h-3 w-full bg-gray-200 rounded-md"></div>
                               <div className="h-3 w-2/3 bg-gray-200 rounded-md"></div>
                           </div>
                       </div>
                   ))}
               </div>
          </div>
      </div>
    </div>
  );
};

export default DashboardSkeleton;

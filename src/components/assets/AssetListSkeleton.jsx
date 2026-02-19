import React from 'react';

const AssetListSkeleton = () => {
  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto animate-pulse pb-24">
      {/* HEADER SKELETON */}
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-end">
            <div>
                <div className="h-8 w-48 bg-gray-200 rounded-md mb-2"></div>
                <div className="h-4 w-32 bg-gray-200 rounded-md"></div>
            </div>
            <div className="hidden md:flex gap-3">
                <div className="h-10 w-24 bg-gray-200 rounded-lg"></div>
                <div className="h-10 w-24 bg-gray-200 rounded-lg"></div>
                <div className="h-10 w-24 bg-gray-200 rounded-lg"></div>
            </div>
        </div>
        
        {/* SEARCH BAR SKELETON */}
        <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 h-12 bg-gray-200 rounded-xl"></div>
            <div className="hidden md:block w-48 h-12 bg-gray-200 rounded-xl"></div>
        </div>

        {/* TABS SKELETON */}
        <div className="flex gap-2 overflow-x-auto pb-2">
            {[...Array(6)].map((_, i) => (
                <div key={i} className="h-10 w-24 bg-gray-200 rounded-xl shrink-0"></div>
            ))}
        </div>
      </div>

      {/* MOBILE LIST SKELETON */}
      <div className="grid grid-cols-1 gap-3 md:hidden">
          {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white p-4 rounded-xl border border-gray-200 h-28 flex flex-col justify-between">
                  <div className="flex gap-4">
                      <div className="w-10 h-10 bg-gray-200 rounded-xl"></div>
                      <div className="flex-1 space-y-2">
                          <div className="h-4 w-3/4 bg-gray-200 rounded"></div>
                          <div className="h-3 w-1/2 bg-gray-200 rounded"></div>
                      </div>
                  </div>
              </div>
          ))}
      </div>

      {/* DESKTOP TABLE SKELETON */}
      <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex gap-4">
              <div className="h-6 w-6 bg-gray-200 rounded"></div>
              <div className="h-6 w-1/4 bg-gray-200 rounded"></div>
              <div className="h-6 w-1/4 bg-gray-200 rounded"></div>
              <div className="h-6 w-1/4 bg-gray-200 rounded"></div>
          </div>
          {[...Array(8)].map((_, i) => (
              <div key={i} className="p-5 border-b border-gray-50 flex gap-4 items-center">
                  <div className="h-5 w-5 bg-gray-200 rounded"></div>
                  <div className="h-10 w-10 bg-gray-200 rounded-xl"></div>
                  <div className="flex-1 space-y-2">
                      <div className="h-4 w-1/3 bg-gray-200 rounded"></div>
                      <div className="h-3 w-1/4 bg-gray-200 rounded"></div>
                  </div>
                  <div className="w-1/6 h-4 bg-gray-200 rounded"></div>
                  <div className="w-1/6 h-6 bg-gray-200 rounded-full"></div>
              </div>
          ))}
      </div>
    </div>
  );
};

export default AssetListSkeleton;

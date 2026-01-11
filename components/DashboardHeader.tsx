
import React from 'react';

export const DashboardHeader: React.FC = () => {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="flex h-16 w-full items-center justify-between px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-lg shadow-slate-200">
            <i className="fa-solid fa-industry text-lg"></i>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Asset Criticality Mapping Ledger</h1>
            <p className="text-[10px] font-medium uppercase tracking-widest text-slate-500 italic leading-none">ACM Ledger Intelligence</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
           {/* Navigation or user profile could go here, buttons removed as requested */}
        </div>
      </div>
    </header>
  );
};

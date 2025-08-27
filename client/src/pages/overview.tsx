import { useState } from "react";
import OverviewTiles from "@/components/dashboard/overview-tiles";
import RevenueChart from "@/components/dashboard/revenue-chart";
import TemplateDownload from "@/components/dashboard/template-download";

export default function Overview() {
  return (
    <div className="min-h-screen bg-[var(--dashboard-bg)] p-6">
      {/* Main Logo Header */}
      <div className="w-full mb-8 py-6">
        <img 
          src="/@fs/home/runner/workspace/attached_assets/image_1756172904290.png" 
          alt="Modulo Revenue Management" 
          className="w-full h-80 object-contain"
          style={{ 
            objectPosition: 'center center',
            display: 'block'
          }}
        />
      </div>

      {/* Page Header */}
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-light text-[var(--trilogy-dark-blue)] mb-6" data-testid="text-page-title">
          Revenue Management Dashboard
        </h1>
        <p className="text-xl font-light text-[var(--trilogy-grey)] leading-relaxed" data-testid="text-page-subtitle">
          Optimize pricing with data-driven market analysis and competitor intelligence
        </p>
      </div>

      {/* Overview Tiles */}
      <div className="mb-12">
        <OverviewTiles />
      </div>

      {/* Revenue Growth Chart */}
      <div className="mb-12">
        <RevenueChart />
      </div>

      {/* Data Management */}
      <div className="mb-12">
        <TemplateDownload />
      </div>
    </div>
  );
}
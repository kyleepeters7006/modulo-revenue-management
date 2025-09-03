import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="min-h-screen bg-[var(--dashboard-bg)] flex flex-col items-center justify-center px-4">
      <div className="max-w-4xl mx-auto text-center">
        {/* Main Logo */}
        <div className="mb-12">
          <img 
            src="https://modulorm.replit.app/assets/image_1756172904290.png" 
            alt="Modulo Revenue Management" 
            className="h-32 sm:h-40 md:h-48 lg:h-56 w-auto mx-auto"
            loading="eager"
            decoding="async"
            crossOrigin="anonymous"
            onError={(e) => {
              console.error('Main logo failed to load, trying fallback');
              const img = e.target as HTMLImageElement;
              img.src = '/assets/image_1756172904290.png';
              img.onerror = () => {
                console.error('Fallback logo also failed');
                img.style.display = 'none';
              };
            }}
          />
        </div>

        {/* Hero Content */}
        <div className="mb-12">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-light text-[var(--trilogy-dark-blue)] mb-6">
            Portfolio Revenue Management System
          </h1>
          <p className="text-lg sm:text-xl lg:text-2xl font-light text-[var(--trilogy-grey)] leading-relaxed mb-8">
            Optimize pricing across your entire senior living portfolio with AI-powered recommendations and market intelligence
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <div className="flex items-center space-x-2 text-[var(--trilogy-teal)]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
              </svg>
              <span className="text-sm font-medium">Portfolio-Wide Analytics</span>
            </div>
            <div className="flex items-center space-x-2 text-[var(--trilogy-teal)]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 00-2 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h2z"/>
              </svg>
              <span className="text-sm font-medium">AI-Powered Pricing</span>
            </div>
            <div className="flex items-center space-x-2 text-[var(--trilogy-teal)]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              <span className="text-sm font-medium">Market Intelligence</span>
            </div>
          </div>
        </div>

        {/* Login Button */}
        <div className="mb-8">
          <Button
            onClick={() => window.location.href = "/api/login"}
            className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white px-8 py-4 text-lg font-medium rounded-xl transition-all duration-300 transform hover:scale-105"
            data-testid="button-login"
          >
            Access Dashboard
          </Button>
        </div>

        {/* Footer */}
        <div className="text-sm text-[var(--trilogy-grey)]">
          <p>Trilogy Health Services • Portfolio Revenue Management</p>
          <p className="mt-2 text-xs">Powered by Modulo</p>
        </div>
      </div>
    </div>
  );
}
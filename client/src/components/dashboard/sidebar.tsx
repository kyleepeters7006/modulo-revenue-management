import { Home, Upload, DollarSign, MapPin, BarChart3, CreditCard, FileText, Shield, Download } from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "#dashboard", icon: Home, current: true },
  { name: "Data Upload", href: "#data-upload", icon: Upload, current: false },
  { name: "Rate Card", href: "#ratecard", icon: CreditCard, current: false },
  { name: "Attribute Pricing", href: "#attribute-pricing", icon: DollarSign, current: false },
  { name: "Dynamic Pricing", href: "#pricing", icon: DollarSign, current: false },
  { name: "Competitor Map", href: "#competitors", icon: MapPin, current: false },
  { name: "AI Insights", href: "#ai-insights", icon: BarChart3, current: false },
  { name: "Guardrails", href: "#guardrails", icon: Shield, current: false },
  { name: "Export", href: "#export", icon: Download, current: false },
];

export default function Sidebar() {
  return (
    <div className="flex flex-col flex-grow bg-[var(--dashboard-surface)] border-r border-[var(--dashboard-border)] h-full">
      {/* Header */}
      <div className="flex items-center justify-center px-4 py-6 border-b border-[var(--dashboard-border)]">
        <svg className="h-16 w-16" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="64" rx="8" fill="#1e40af" stroke="#1d4ed8" strokeWidth="2"/>
          <text x="32" y="42" textAnchor="middle" fill="white" fontSize="28" fontWeight="bold" fontFamily="Arial, sans-serif">
            M
          </text>
        </svg>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.name}
              href={item.href}
              className={`
                flex items-center px-4 py-3 text-sm font-light rounded-lg transition-all duration-300
                ${item.current
                  ? 'bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal)] border border-[var(--trilogy-teal)]/20'
                  : 'text-[var(--trilogy-grey)] hover:bg-[var(--trilogy-light-blue)]/10 hover:text-[var(--trilogy-dark-blue)]'
                }
              `}
              data-testid={`link-nav-${item.name.toLowerCase().replace(' ', '-')}`}
            >
              <Icon className="w-5 h-5 mr-4" />
              {item.name}
            </a>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-[var(--dashboard-border)]">
        <div className="flex items-center space-x-3 p-3 rounded-lg bg-[var(--dashboard-bg)]">
          <div className="w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center">
            <span className="text-sm font-medium text-white">U</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--dashboard-text)] truncate" data-testid="text-user-name">
              User
            </p>
            <p className="text-xs text-[var(--dashboard-muted)] truncate" data-testid="text-user-role">
              Property Manager
            </p>
          </div>
          <button
            onClick={() => window.location.href = "/api/logout"}
            className="text-xs text-[var(--trilogy-grey)] hover:text-[var(--trilogy-teal)] transition-colors"
            data-testid="button-logout"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}

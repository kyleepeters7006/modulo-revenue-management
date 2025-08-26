import { Home, Upload, DollarSign, MapPin, BarChart3 } from "lucide-react";
import mainLogoPath from "@assets/image_1756172551638.png";

const navigation = [
  { name: "Dashboard", href: "#dashboard", icon: Home, current: true },
  { name: "Data Upload", href: "#data-upload", icon: Upload, current: false },
  { name: "Dynamic Pricing", href: "#pricing", icon: DollarSign, current: false },
  { name: "Competitor Map", href: "#competitors", icon: MapPin, current: false },
  { name: "Analytics", href: "#analytics", icon: BarChart3, current: false },
];

export default function Sidebar() {
  return (
    <div className="flex flex-col flex-grow bg-[var(--dashboard-surface)] border-r border-[var(--dashboard-border)] h-full">
      {/* Header */}
      <div className="flex items-center px-12 py-12 border-b border-[var(--dashboard-border)]">
        <div className="flex items-center space-x-3">
          <img 
            src={mainLogoPath} 
            alt="Modulo Logo" 
            className="h-32 w-auto max-w-full"
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-8 py-12 space-y-4">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.name}
              href={item.href}
              className={`
                flex items-center px-6 py-4 text-base font-light rounded-xl transition-all duration-300
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
            <span className="text-sm font-medium text-white">JD</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--dashboard-text)] truncate" data-testid="text-user-name">
              John Doe
            </p>
            <p className="text-xs text-[var(--dashboard-muted)] truncate" data-testid="text-user-role">
              Property Manager
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

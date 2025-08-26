import { Home, Upload, DollarSign, MapPin, BarChart3 } from "lucide-react";

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
      <div className="flex items-center px-6 py-6 border-b border-[var(--dashboard-border)]">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">M</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[var(--dashboard-text)]">Modulo</h1>
            <p className="text-sm text-[var(--dashboard-muted)]">Revenue Management</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-2">
        {navigation.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.name}
              href={item.href}
              className={`
                flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors
                ${item.current
                  ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                  : 'text-[var(--dashboard-muted)] hover:bg-[var(--dashboard-bg)] hover:text-[var(--dashboard-text)]'
                }
              `}
              data-testid={`link-nav-${item.name.toLowerCase().replace(' ', '-')}`}
            >
              <Icon className="w-5 h-5 mr-3" />
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

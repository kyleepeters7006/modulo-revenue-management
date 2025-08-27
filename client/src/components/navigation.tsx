import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  BarChart3,
  Upload,
  CreditCard,
  Settings,
  Map,
  Brain,
  LogOut
} from "lucide-react";

const menuItems = [
  { path: "/overview", label: "Overview", icon: BarChart3 },
  { path: "/data-management", label: "Data Management", icon: Upload },
  { path: "/rate-card", label: "Rate Card & Pricing", icon: CreditCard },
  { path: "/pricing-controls", label: "Dynamic Pricing Controls", icon: Settings },
  { path: "/competitor-analysis", label: "Competitor Analysis", icon: Map },
  { path: "/ai-insights", label: "AI Insights", icon: Brain },
];

interface NavigationProps {
  className?: string;
}

export default function Navigation({ className }: NavigationProps) {
  const [location] = useLocation();

  return (
    <nav className={cn("bg-white shadow-sm border-b border-gray-200", className)}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center space-x-8">
            {/* Trilogy Logo */}
            <Link href="/overview" className="flex items-center space-x-2" data-testid="link-home">
              <img 
                src="/@fs/home/runner/workspace/attached_assets/image_1756172896932.png" 
                alt="Trilogy Health Services" 
                className="h-10 w-auto"
              />
            </Link>
            
            {/* Main Navigation */}
            <div className="hidden md:flex space-x-8">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.path || (location === "/" && item.path === "/overview");
                
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={cn(
                      "inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors duration-200",
                      isActive
                        ? "border-[var(--trilogy-blue)] text-[var(--trilogy-dark-blue)]"
                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    )}
                    data-testid={`link-${item.path.slice(1)}`}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Logout */}
          <div className="flex items-center">
            <a
              href="/api/logout"
              className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors duration-200"
              data-testid="link-logout"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </a>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden border-t border-gray-200">
        <div className="px-2 pt-2 pb-3 space-y-1 bg-gray-50">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path || (location === "/" && item.path === "/overview");
            
            return (
              <Link
                key={item.path}
                href={item.path}
                className={cn(
                  "flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200",
                  isActive
                    ? "bg-[var(--trilogy-light-blue)] text-[var(--trilogy-dark-blue)]"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                )}
                data-testid={`mobile-link-${item.path.slice(1)}`}
              >
                <Icon className="h-5 w-5 mr-3" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
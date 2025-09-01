import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  BarChart3,
  Upload,
  CreditCard,
  Settings,
  Map,
  Brain,
  Building2,
  LogOut,
  Menu,
  X
} from "lucide-react";

const menuItems = [
  { path: "/overview", label: "Overview", icon: BarChart3 },
  { path: "/portfolio", label: "Portfolio", icon: Building2 },
  { path: "/data-management", label: "Data Management", icon: Upload },
  { path: "/rate-card", label: "Rate Card", icon: CreditCard },
  { path: "/pricing-controls", label: "Pricing Controls", icon: Settings },
  { path: "/competitor-analysis", label: "Competitors", icon: Map },
  { path: "/ai-insights", label: "AI Insights", icon: Brain },
];

interface NavigationProps {
  className?: string;
}

export default function Navigation({ className }: NavigationProps) {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <nav className={cn("bg-white shadow-sm border-b border-gray-200", className)}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/overview" className="flex items-center space-x-2" data-testid="link-home">
            <img 
              src="/@fs/home/runner/workspace/attached_assets/image_1756171963360.png" 
              alt="Modulo" 
              className="h-14 w-auto"
            />
          </Link>
          
          {/* Centered Main Navigation - Desktop */}
          <div className="hidden md:flex flex-1 justify-center">
            <div className="flex space-x-8">
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

          <div className="flex items-center space-x-4">
            {/* Logout - Desktop */}
            <a
              href="/api/logout"
              className="hidden md:inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors duration-200"
              data-testid="link-logout"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </a>

            {/* Mobile menu button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
              data-testid="button-mobile-menu"
              aria-expanded="false"
            >
              <span className="sr-only">Open main menu</span>
              {isMobileMenuOpen ? (
                <X className="h-6 w-6" aria-hidden="true" />
              ) : (
                <Menu className="h-6 w-6" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      {isMobileMenuOpen && (
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
                  onClick={() => setIsMobileMenuOpen(false)}
                  data-testid={`mobile-link-${item.path.slice(1)}`}
                >
                  <Icon className="h-5 w-5 mr-3" />
                  {item.label}
                </Link>
              );
            })}
            
            {/* Mobile Logout */}
            <a
              href="/api/logout"
              className="flex items-center px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-200"
              data-testid="mobile-link-logout"
            >
              <LogOut className="h-5 w-5 mr-3" />
              Logout
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}
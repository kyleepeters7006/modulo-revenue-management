import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import inflectLogo from "@assets/Inflect_Logo_-_No_Text_Below_1781618481726.png";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import LoginModal from "@/components/login-modal";
import { 
  BarChart3,
  Upload,
  CreditCard,
  Settings,
  Map,
  Brain,
  Info,
  LogOut,
  LogIn,
  Menu,
  X,
  ScatterChart,
  LayoutTemplate,
  Layers,
  Shield,
  FileUp
} from "lucide-react";

const menuItems = [
  { path: "/overview", label: "Overview", icon: BarChart3 },
  { path: "/pricing-controls", label: "Pricing Controls", icon: Settings },
  { path: "/analytics", label: "Pricing Analytics", icon: ScatterChart },
  { path: "/rate-card", label: "Rate Card", icon: CreditCard },
  { path: "/room-attributes", label: "Room Attributes", icon: Layers },
  { path: "/competitor-analysis", label: "Competitors", icon: Map },
  { path: "/ai-insights", label: "AI Insights", icon: Brain },
  { path: "/floor-plans", label: "Floor Plans", icon: LayoutTemplate },
  { path: "/about", label: "About Us", icon: Info },
  { path: "/data-management", label: "Data Management", icon: Upload },
  { path: "/data-imports", label: "Data Imports", icon: FileUp },
];

interface NavigationProps {
  className?: string;
}

export default function Navigation({ className }: NavigationProps) {
  const [location] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const { isAuthenticated, clientName, isLoading } = useAuth();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.clear();
      window.location.reload();
    },
  });

  return (
    <div className={cn("sticky top-0 z-50", className)}>
      {/* Demo mode banner */}
      {!isLoading && !isAuthenticated && (
        <div className="bg-[var(--trilogy-teal)] text-white text-center py-1 px-3 text-xs flex flex-wrap items-center justify-center gap-1.5 sm:gap-3">
          <Shield className="h-3 w-3 flex-shrink-0" />
          <span>
            You are viewing <strong>Demo Mode</strong>. Please log in to access your data.
          </span>
          <button
            onClick={() => setShowLoginModal(true)}
            className="underline font-semibold hover:no-underline whitespace-nowrap"
          >
            Log In
          </button>
        </div>
      )}

      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8">
          <div className="flex items-center py-2">
            {/* Logo */}
            <div className="flex-shrink-0 mr-3 lg:mr-5">
              <Link href="/overview" className="flex items-center" data-testid="link-home">
                <img 
                  src="/attached_assets/image_1756817717051.png" 
                  alt="Modulo" 
                  className="h-16 md:h-20 w-auto rounded-lg"
                />
              </Link>
            </div>
            
            {/* Main Navigation - Desktop */}
            <div className="hidden md:flex flex-1 min-w-0">
              <div className="flex gap-x-0.5 lg:gap-x-2 xl:gap-x-3">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location === item.path || (location === "/" && item.path === "/overview");
                  
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      className={cn(
                        "inline-flex flex-col items-center text-center px-1 lg:px-1.5 py-1.5 border-b-2 text-xs lg:text-sm font-medium transition-colors duration-200 max-w-[72px] lg:max-w-[90px]",
                        isActive
                          ? "border-[var(--trilogy-blue)] text-[var(--trilogy-dark-blue)]"
                          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                      )}
                      data-testid={`link-${item.path.slice(1)}`}
                    >
                      <Icon className="h-3.5 w-3.5 flex-shrink-0 mb-0.5" />
                      <span className="leading-tight">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center space-x-4 ml-auto">
              {/* Inflect link */}
              <a
                href="https://inflect.replit.app"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors duration-200"
                title="Inflect"
              >
                <img src={inflectLogo} alt="Inflect" className="h-[50px] w-auto rounded-lg" />
              </a>

              {/* Auth button - Desktop */}
              {!isLoading && (
                isAuthenticated ? (
                  <button
                    onClick={() => logoutMutation.mutate()}
                    className="hidden md:inline-flex items-center px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors duration-200"
                    data-testid="link-logout"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Logout
                  </button>
                ) : (
                  <button
                    onClick={() => setShowLoginModal(true)}
                    className="hidden md:inline-flex items-center px-3 py-2 text-sm font-medium text-[var(--trilogy-teal)] hover:text-[var(--trilogy-teal-dark)] transition-colors duration-200"
                    data-testid="link-login"
                  >
                    <LogIn className="h-4 w-4 mr-2" />
                    Login
                  </button>
                )
              )}

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
              
              {/* Mobile auth button */}
              {!isLoading && (
                isAuthenticated ? (
                  <button
                    onClick={() => logoutMutation.mutate()}
                    className="flex w-full items-center px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-200"
                    data-testid="mobile-link-logout"
                  >
                    <LogOut className="h-5 w-5 mr-3" />
                    Logout
                  </button>
                ) : (
                  <button
                    onClick={() => { setShowLoginModal(true); setIsMobileMenuOpen(false); }}
                    className="flex w-full items-center px-3 py-2 rounded-md text-sm font-medium text-[var(--trilogy-teal)] hover:bg-gray-100 transition-colors duration-200"
                    data-testid="mobile-link-login"
                  >
                    <LogIn className="h-5 w-5 mr-3" />
                    Login
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </nav>

      <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </div>
  );
}

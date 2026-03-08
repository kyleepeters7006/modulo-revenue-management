import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
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
  Shield
} from "lucide-react";

const menuItems = [
  { path: "/overview", label: "Overview", icon: BarChart3 },
  { path: "/rate-card", label: "Rate Card", icon: CreditCard },
  { path: "/pricing-controls", label: "Pricing Controls", icon: Settings },
  { path: "/competitor-analysis", label: "Competitors", icon: Map },
  { path: "/analytics", label: "Pricing Analytics", icon: ScatterChart },
  { path: "/room-attributes", label: "Room Attributes", icon: Layers },
  { path: "/floor-plans", label: "Floor Plans", icon: LayoutTemplate },
  { path: "/about", label: "About Us", icon: Info },
  { path: "/data-management", label: "Data Management", icon: Upload },
  { path: "/ai-insights", label: "AI Insights", icon: Brain },
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
    <>
      {/* Demo mode banner */}
      {!isLoading && !isAuthenticated && (
        <div className="bg-[var(--trilogy-teal)] text-white text-center py-2 px-4 text-sm flex items-center justify-center gap-3">
          <Shield className="h-4 w-4 flex-shrink-0" />
          <span>
            You are viewing <strong>Demo Mode</strong>. Trilogy, GLM, and SSMG clients — please log in to access your data.
          </span>
          <button
            onClick={() => setShowLoginModal(true)}
            className="ml-2 underline font-semibold hover:no-underline whitespace-nowrap"
          >
            Log In
          </button>
        </div>
      )}

      {/* Logged-in client banner */}
      {!isLoading && isAuthenticated && (
        <div className="bg-[var(--trilogy-dark-blue)] text-white text-center py-2 px-4 text-sm flex items-center justify-center gap-3">
          <Shield className="h-4 w-4 flex-shrink-0" />
          <span>Logged in as <strong>{clientName}</strong></span>
          <button
            onClick={() => logoutMutation.mutate()}
            className="ml-2 underline font-semibold hover:no-underline"
          >
            Log Out
          </button>
        </div>
      )}

      <nav className={cn("bg-white shadow-sm border-b border-gray-200", className)}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-28">
            {/* Logo */}
            <div className="flex-shrink-0 mr-8">
              <Link href="/overview" className="flex items-center" data-testid="link-home">
                <img 
                  src="/attached_assets/image_1756817717051.png" 
                  alt="Modulo" 
                  className="h-24 w-auto"
                />
              </Link>
            </div>
            
            {/* Main Navigation - Desktop */}
            <div className="hidden md:flex flex-1">
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

            <div className="flex items-center space-x-4 ml-auto">
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
    </>
  );
}

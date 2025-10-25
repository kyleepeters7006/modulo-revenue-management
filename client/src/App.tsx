import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Overview from "@/pages/overview";
import DataManagement from "@/pages/data-management";
import RateCard from "@/pages/rate-card";
import PricingControls from "@/pages/pricing-controls";
import CompetitorAnalysis from "@/pages/competitor-analysis";
import AIInsights from "@/pages/ai-insights";
import PortfolioManager from "@/pages/PortfolioManager";
import Analysis from "@/pages/Analysis";
import { Analytics } from "@/pages/analytics";
import AboutUs from "@/pages/AboutUs";
import FloorPlans from "@/pages/floor-plans";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Overview} />
      <Route path="/overview" component={Overview} />
      <Route path="/portfolio" component={PortfolioManager} />
      <Route path="/analysis" component={Analysis} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/data-management" component={DataManagement} />
      <Route path="/rate-card" component={RateCard} />
      <Route path="/pricing-controls" component={PricingControls} />
      <Route path="/competitor-analysis" component={CompetitorAnalysis} />
      <Route path="/ai-insights" component={AIInsights} />
      <Route path="/floor-plans" component={FloorPlans} />
      <Route path="/about" component={AboutUs} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="dark">
          <Toaster />
          <Router />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

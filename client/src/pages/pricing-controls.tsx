import { useState } from "react";
import Navigation from "@/components/navigation";
import PricingWeights from "@/components/dashboard/pricing-weights";
import AdjustmentRanges from "@/components/dashboard/adjustment-ranges";
import { AiPricingWeights } from "@/components/dashboard/ai-pricing-weights";
import { AiAdjustmentRanges } from "@/components/dashboard/ai-adjustment-ranges";
import GuardrailsEditor from "@/components/dashboard/guardrails-editor";
import AttributeManagement from "@/components/attribute-management";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Calculator } from "lucide-react";

export default function PricingControls() {
  const [activeTab, setActiveTab] = useState("modulo");

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-20 sm:py-8 sm:pb-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
            Dynamic Pricing Controls
          </h1>
          <p className="text-sm sm:text-base text-gray-600" data-testid="text-page-subtitle">
            Configure pricing algorithms with independent controls for Modulo and AI
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="modulo" className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Modulo Controls
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center gap-2">
              <Brain className="h-4 w-4" />
              AI Controls
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="modulo" className="space-y-6 sm:space-y-8">
            <div className="text-sm text-gray-600 mb-4">
              Configure weights and ranges for the Modulo pricing algorithm
            </div>
            <PricingWeights />
            <AdjustmentRanges />
            <GuardrailsEditor />
            <AttributeManagement />
          </TabsContent>
          
          <TabsContent value="ai" className="space-y-6 sm:space-y-8">
            <div className="text-sm text-gray-600 mb-4">
              Configure independent weights and ranges for the AI pricing algorithm
            </div>
            <AiPricingWeights />
            <AiAdjustmentRanges />
            <GuardrailsEditor />
            <AttributeManagement />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
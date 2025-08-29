import Navigation from "@/components/navigation";
import PricingWeights from "@/components/dashboard/pricing-weights";
import GuardrailsEditor from "@/components/dashboard/guardrails-editor";
import AttributeManagement from "@/components/attribute-management";

export default function PricingControls() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-20 sm:py-8 sm:pb-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
            Dynamic Pricing Controls
          </h1>
          <p className="text-sm sm:text-base text-gray-600" data-testid="text-page-subtitle">
            Adjust pricing weights and guardrails for the Modulo algorithm
          </p>
        </div>

        <div className="space-y-6 sm:space-y-8">
          <PricingWeights />
          <GuardrailsEditor />
          <AttributeManagement />
        </div>
      </div>
    </div>
  );
}
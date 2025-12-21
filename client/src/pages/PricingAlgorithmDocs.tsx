import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  Calculator, 
  Brain, 
  Target, 
  ChevronRight,
  TrendingUp,
  Clock,
  Home,
  Calendar,
  Users,
  BarChart3,
  Activity,
  Shield,
  Sparkles,
  GitBranch,
  RefreshCw
} from "lucide-react";
import { useLocation } from "wouter";

export default function PricingAlgorithmDocs() {
  const [, setLocation] = useLocation();
  
  return (
    <div className="min-h-screen bg-[var(--dashboard-bg)] p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <Button
            variant="outline"
            onClick={() => setLocation("/about")}
            className="border-[var(--trilogy-grey)]/30 text-[var(--trilogy-grey)] hover:bg-[var(--trilogy-grey)]/10"
            data-testid="button-back-to-about"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to About Us
          </Button>
        </div>
        
        <div className="text-center mb-12">
          <h1 className="text-4xl font-light text-[var(--trilogy-dark-blue)] mb-4">
            Pricing Algorithm Documentation
          </h1>
          <p className="text-xl text-[var(--trilogy-grey)]">
            Understanding How Modulo Calculates Optimal Rates
          </p>
        </div>

        <div className="space-y-8">
          <Card className="bg-gradient-to-r from-[var(--trilogy-teal)]/10 to-[var(--trilogy-dark-blue)]/10 border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center">
                <GitBranch className="mr-3 h-6 w-6 text-[var(--trilogy-teal)]" />
                Algorithm Workflow Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[var(--trilogy-grey)]">
              <p className="mb-4">
                Modulo uses a three-stage pricing workflow to generate and continuously improve rate recommendations:
              </p>
              <div className="flex flex-col md:flex-row gap-4 items-center justify-center">
                <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-lg border border-[var(--trilogy-teal)]/30">
                  <Calculator className="h-5 w-5 text-[var(--trilogy-teal)]" />
                  <span className="font-medium">Modulo Algorithm</span>
                </div>
                <ChevronRight className="h-5 w-5 text-[var(--trilogy-grey)] hidden md:block" />
                <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-lg border border-[var(--trilogy-dark-blue)]/30">
                  <Brain className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                  <span className="font-medium">AI Pricing Engine</span>
                </div>
                <ChevronRight className="h-5 w-5 text-[var(--trilogy-grey)] hidden md:block" />
                <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-lg border border-[var(--trilogy-orange)]/30">
                  <Target className="h-5 w-5 text-[var(--trilogy-orange)]" />
                  <span className="font-medium">Revenue Target Integration</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center">
                <Calculator className="mr-3 h-6 w-6 text-[var(--trilogy-teal)]" />
                Stage 1: Modulo Pricing Algorithm
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                The Modulo algorithm is a sophisticated multi-factor pricing engine that calculates optimal rates 
                by blending 7 pricing signals with configurable weights. Each factor generates a "signal" normalized 
                to a -1 to +1 range, which is then weighted and blended to produce a final price adjustment.
              </p>
              
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">Core Formula</h4>
                <div className="font-mono text-sm bg-white p-3 rounded border border-gray-200">
                  Final Price = Base Rate × (1 + Blended Adjustment)
                </div>
                <p className="text-sm mt-2">
                  Where Blended Adjustment = Σ(Signal × Normalized Weight), capped at ±25%
                </p>
              </div>

              <h4 className="font-semibold text-[var(--trilogy-dark-blue)] text-lg mt-6 mb-4">
                The 7 Pricing Factors
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Occupancy Pressure</h5>
                  </div>
                  <p className="text-sm">
                    <strong>Range:</strong> -12% to +6%<br/>
                    Campus-level occupancy drives pricing pressure. Below 85% occupancy triggers stronger 
                    reductions; above 90% allows premium pricing.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Days Vacant Decay</h5>
                  </div>
                  <p className="text-sm">
                    <strong>Range:</strong> -15% to 0%<br/>
                    Unit-level vacancy decay applies progressive discounts. 7-day grace period before 
                    discounts begin, reaching maximum reduction after extended vacancy.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <Home className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Room Attributes</h5>
                  </div>
                  <p className="text-sm">
                    <strong>Range:</strong> ±10%<br/>
                    Adjusts for location within building, unit size, view quality, renovation status, 
                    and amenity level. Premium rooms earn uplift; basic rooms may receive discounts.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Seasonality</h5>
                  </div>
                  <p className="text-sm">
                    <strong>Range:</strong> ±5%<br/>
                    Monthly demand patterns adjust pricing. Peak months (May-July) see increases; 
                    slower months (Oct-Dec) may see modest reductions.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Competitor Positioning</h5>
                  </div>
                  <p className="text-sm">
                    <strong>Range:</strong> ±8%<br/>
                    Compares rates against market median. Targets premium positioning (10-25% above median 
                    depending on service line) to reflect quality and care value.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Market Conditions</h5>
                  </div>
                  <p className="text-sm">
                    <strong>Range:</strong> ±3%<br/>
                    Economic indicators (S&P 500 performance) provide macroeconomic context. 
                    Strong markets support higher pricing; weak markets suggest caution.
                  </p>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 bg-white md:col-span-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Demand (Inquiry/Tour Volume)</h5>
                  </div>
                  <p className="text-sm">
                    <strong>Range:</strong> ±15%<br/>
                    Real-time demand signals from inquiry and tour volume. High inquiry volume signals strong 
                    demand, justifying premium pricing. Low volume suggests market softness.
                  </p>
                </div>
              </div>

              <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-4 mt-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-2">Service Line Premium Targets</h4>
                <p className="text-sm mb-3">
                  Each service line has a target premium positioning above competitor median:
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  <div className="bg-white rounded px-3 py-2">
                    <span className="font-medium">AL:</span> +25% premium
                  </div>
                  <div className="bg-white rounded px-3 py-2">
                    <span className="font-medium">HC:</span> +20% premium
                  </div>
                  <div className="bg-white rounded px-3 py-2">
                    <span className="font-medium">AL/MC, HC/MC:</span> +20%
                  </div>
                  <div className="bg-white rounded px-3 py-2">
                    <span className="font-medium">SL:</span> +10% premium
                  </div>
                  <div className="bg-white rounded px-3 py-2">
                    <span className="font-medium">VIL:</span> +10% premium
                  </div>
                  <div className="bg-white rounded px-3 py-2">
                    <span className="font-medium">Default:</span> +18%
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center">
                <Brain className="mr-3 h-6 w-6 text-[var(--trilogy-dark-blue)]" />
                Stage 2: AI Pricing Engine
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                The AI Pricing Engine builds upon the Modulo algorithm by using machine learning to continuously 
                optimize pricing weights based on real-world outcomes. Unlike the static Modulo weights, AI weights 
                adapt and improve over time.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-[var(--trilogy-dark-blue)]/20 rounded-lg p-4 bg-[var(--trilogy-dark-blue)]/5">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">How AI Learning Works</h5>
                  </div>
                  <ol className="text-sm space-y-2 list-decimal list-inside">
                    <li>Track when AI-recommended rates are adopted</li>
                    <li>Monitor if adopted rates result in sales (within 30 days)</li>
                    <li>Analyze patterns between successful rates and pricing factors</li>
                    <li>Use regularized regression to adjust factor weights</li>
                    <li>Version-control weight updates for rollback capability</li>
                  </ol>
                </div>

                <div className="border border-[var(--trilogy-dark-blue)]/20 rounded-lg p-4 bg-[var(--trilogy-dark-blue)]/5">
                  <div className="flex items-center gap-2 mb-3">
                    <RefreshCw className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Automated Daily Learning</h5>
                  </div>
                  <ul className="text-sm space-y-2 list-disc list-inside">
                    <li>Portfolio-wide calculations run daily at 6:00 AM EST</li>
                    <li>New outcome data is processed automatically</li>
                    <li>Weights are updated based on latest performance</li>
                    <li>Models can be trained per service line or globally</li>
                    <li>All calculated rates are saved for historical tracking</li>
                  </ul>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">AI vs Modulo: Key Differences</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Aspect</th>
                      <th className="text-left py-2">Modulo</th>
                      <th className="text-left py-2">AI Engine</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2">Weights</td>
                      <td className="py-2">Operator-configured</td>
                      <td className="py-2">ML-optimized</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2">Adaptation</td>
                      <td className="py-2">Manual adjustment</td>
                      <td className="py-2">Continuous learning</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2">Outcome Tracking</td>
                      <td className="py-2">Not used</td>
                      <td className="py-2">Adoption + sales data</td>
                    </tr>
                    <tr>
                      <td className="py-2">Best For</td>
                      <td className="py-2">Initial setup, known markets</td>
                      <td className="py-2">Ongoing optimization</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center">
                <Target className="mr-3 h-6 w-6 text-[var(--trilogy-orange)]" />
                Stage 3: Revenue Growth Target Integration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                Revenue Growth Targets provide a strategic overlay that adjusts AI pricing based on performance 
                against defined annual revenue goals. This integration applies to AI pricing only (not Modulo) 
                and helps automatically adjust pricing to meet or exceed revenue targets.
              </p>

              <div className="bg-[var(--trilogy-orange)]/5 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">How Revenue Targets Work</h4>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--trilogy-success)]/20 flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="h-4 w-4 text-[var(--trilogy-success)]" />
                    </div>
                    <div>
                      <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Ahead of Target</h5>
                      <p className="text-sm">
                        When actual YOY growth exceeds the target, the system allows premium pricing opportunities. 
                        A slight positive adjustment (up to +2%) enables capturing additional revenue when demand is strong.
                        Display shows "Premium Allowance" in blue.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--trilogy-orange)]/20 flex items-center justify-center flex-shrink-0">
                      <Activity className="h-4 w-4 text-[var(--trilogy-orange)]" />
                    </div>
                    <div>
                      <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Behind Target</h5>
                      <p className="text-sm">
                        When actual YOY growth falls short of the target, the system applies upward pricing pressure 
                        (up to +5%) to help close the gap. The more behind target, the stronger the pressure.
                        Display shows "Pricing Pressure" in amber.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">Revenue Gap Formula</h4>
                <div className="font-mono text-sm bg-white p-3 rounded border border-gray-200 mb-3">
                  Revenue Gap = Target Growth % - Actual YOY Growth %
                </div>
                <div className="text-sm space-y-2">
                  <p><strong>If Gap ≥ 0 (ahead of target):</strong> Adjustment = min(0.02, Gap/10)</p>
                  <p><strong>If Gap &lt; 0 (behind target):</strong> Adjustment = min(0.05, |Gap|/10)</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Setting Targets</h5>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Navigate to Pricing Controls page</li>
                    <li>Set target growth % by location and service line</li>
                    <li>Use "Save Targets" to persist settings</li>
                    <li>AI generates optimal weights and guardrails</li>
                  </ul>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">AI Analysis Inputs</h5>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Current occupancy levels</li>
                    <li>Vacancy patterns and trends</li>
                    <li>Sales velocity metrics</li>
                    <li>Competitor rate landscape</li>
                    <li>Service line performance breakdown</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center">
                <Shield className="mr-3 h-6 w-6 text-[var(--trilogy-teal)]" />
                Guardrails System
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-[var(--trilogy-grey)]">
              <p>
                Guardrails provide safety limits that constrain all pricing recommendations, ensuring rates stay 
                within acceptable business boundaries regardless of what the algorithm calculates.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Rate Change Limits</h5>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Maximum single increase: configurable (default 25%)</li>
                    <li>Maximum single decrease: configurable (default 15%)</li>
                    <li>Prevents excessive price swings</li>
                  </ul>
                </div>

                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Absolute Price Limits</h5>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Minimum absolute price floor</li>
                    <li>Maximum absolute price ceiling</li>
                    <li>Competitor variance limits (±10% default)</li>
                  </ul>
                </div>
              </div>

              <p className="text-sm italic">
                Guardrails can be configured at the portfolio, location, or service line level, providing 
                granular control over pricing boundaries across different segments.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-r from-[var(--trilogy-dark-blue)]/10 to-[var(--trilogy-teal)]/10 border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)]">
                Summary: The Complete Workflow
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[var(--trilogy-grey)]">
              <ol className="space-y-3 list-decimal list-inside">
                <li className="pl-2">
                  <strong>Base Rate Calculation:</strong> Modulo algorithm calculates initial recommendation 
                  using 7 weighted factors (occupancy, vacancy, attributes, seasonality, competitors, market, demand)
                </li>
                <li className="pl-2">
                  <strong>AI Optimization:</strong> Machine learning adjusts weights based on historical outcomes 
                  (adoptions and sales), continuously improving recommendations
                </li>
                <li className="pl-2">
                  <strong>Revenue Target Overlay:</strong> For AI pricing, revenue growth gaps add strategic 
                  pressure to help meet annual targets
                </li>
                <li className="pl-2">
                  <strong>Guardrail Enforcement:</strong> Final prices are clamped to configured min/max limits 
                  to ensure business boundaries are respected
                </li>
                <li className="pl-2">
                  <strong>Continuous Improvement:</strong> Daily automated calculations and learning loops 
                  ensure pricing stays optimized as market conditions evolve
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 text-center">
          <Button
            variant="outline"
            onClick={() => setLocation("/about")}
            className="border-[var(--trilogy-teal)] text-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/10"
            data-testid="button-return-about"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Return to About Us
          </Button>
        </div>
      </div>
    </div>
  );
}

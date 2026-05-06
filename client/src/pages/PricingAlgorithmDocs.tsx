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
  RefreshCw,
  SlidersHorizontal,
  CalendarClock,
  Zap,
  ArrowRightLeft,
  Layers
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

        <div className="text-center -mt-6 mb-8 text-sm text-[var(--trilogy-grey)]/70">
          Jump to:{" "}
          <a href="#stage1" className="text-[var(--trilogy-teal)] hover:underline">Modulo</a> ·{" "}
          <a href="#stage2" className="text-[var(--trilogy-teal)] hover:underline">AI Engine</a> ·{" "}
          <a href="#stage3" className="text-[var(--trilogy-teal)] hover:underline">Strategy Layer</a> ·{" "}
          <a href="#stage4" className="text-[var(--trilogy-teal)] hover:underline">Revenue Targets</a> ·{" "}
          <a href="#guardrails" className="text-[var(--trilogy-teal)] hover:underline">Rules &amp; Guardrails</a>
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
                Modulo uses a four-stage pricing pipeline to generate rate recommendations for vacant units. Each stage builds on the previous, and guardrails are applied at the end to enforce business boundaries.
              </p>
              <div className="flex flex-col md:flex-row gap-2 items-center justify-center flex-wrap">
                <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-lg border border-[var(--trilogy-teal)]/30 text-sm">
                  <Calculator className="h-4 w-4 text-[var(--trilogy-teal)]" />
                  <span className="font-medium">1. Modulo Algorithm</span>
                </div>
                <ChevronRight className="h-5 w-5 text-[var(--trilogy-grey)] hidden md:block flex-shrink-0" />
                <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-lg border border-[var(--trilogy-dark-blue)]/30 text-sm">
                  <Brain className="h-4 w-4 text-[var(--trilogy-dark-blue)]" />
                  <span className="font-medium">2. AI Pricing Engine</span>
                </div>
                <ChevronRight className="h-5 w-5 text-[var(--trilogy-grey)] hidden md:block flex-shrink-0" />
                <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-lg border-2 border-[var(--trilogy-teal)] text-sm">
                  <Layers className="h-4 w-4 text-[var(--trilogy-teal)]" />
                  <span className="font-medium text-[var(--trilogy-teal)]">3. Strategy Layer</span>
                </div>
                <ChevronRight className="h-5 w-5 text-[var(--trilogy-grey)] hidden md:block flex-shrink-0" />
                <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-lg border border-[var(--trilogy-orange)]/30 text-sm">
                  <Target className="h-4 w-4 text-[var(--trilogy-orange)]" />
                  <span className="font-medium">4. Revenue Targets</span>
                </div>
                <ChevronRight className="h-5 w-5 text-[var(--trilogy-grey)] hidden md:block flex-shrink-0" />
                <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-lg border border-gray-300 text-sm">
                  <Shield className="h-4 w-4 text-[var(--trilogy-grey)]" />
                  <span className="font-medium text-[var(--trilogy-grey)]">Guardrails</span>
                </div>
              </div>
              <p className="text-xs text-center mt-4 text-[var(--trilogy-grey)]/60">
                The Strategy Layer (step 3) only applies to vacant units. Occupied units skip directly from the AI Rate to guardrails.
              </p>
            </CardContent>
          </Card>

          <Card id="stage1" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
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

              <div className="bg-[var(--trilogy-dark-blue)]/5 rounded-lg p-4 mt-4 border border-[var(--trilogy-dark-blue)]/20">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">AI-Generated Weights & Guardrails</h4>
                </div>
                <p className="text-sm mb-3">
                  While Modulo weights can be configured manually, the system also offers <strong>AI-powered weight and 
                  guardrail generation</strong>. This feature uses the same machine learning technology as the AI Pricing 
                  Engine to analyze your portfolio's performance and generate optimal settings.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="bg-white rounded-lg p-3">
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-1">How It Works</h5>
                    <ul className="list-disc list-inside space-y-1 text-[var(--trilogy-grey)]">
                      <li>Analyzes portfolio occupancy, vacancy patterns, and sales velocity</li>
                      <li>Reviews competitor positioning and market conditions</li>
                      <li>Examines historical pricing outcomes and adoption rates</li>
                      <li>Generates optimized weights and guardrails per service line</li>
                    </ul>
                  </div>
                  <div className="bg-white rounded-lg p-3">
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-1">Benefits</h5>
                    <ul className="list-disc list-inside space-y-1 text-[var(--trilogy-grey)]">
                      <li>Data-driven initial configuration instead of guesswork</li>
                      <li>Tailored to your specific portfolio characteristics</li>
                      <li>Can be used to optimize Modulo rates directly</li>
                      <li>Provides a baseline that improves with AI learning</li>
                    </ul>
                  </div>
                </div>
                <p className="text-sm mt-3 text-[var(--trilogy-grey)]/80 italic">
                  Access this feature from the Pricing Controls page by using the "Generate with AI" option 
                  when setting revenue growth targets.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card id="stage2" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
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

          {/* ── Stage 3: Revenue Target Strategy Layer ─────────────────────── */}
          <Card id="stage3" className="bg-white/95 backdrop-blur border-[var(--trilogy-teal)]/40">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center">
                <Layers className="mr-3 h-6 w-6 text-[var(--trilogy-teal)]" />
                Stage 3: Revenue Target Strategy Layer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                After the AI Rate is calculated, and before guardrails are applied, every <strong>vacant</strong> unit
                passes through the Revenue Target Strategy Layer. This stage classifies each unit, generates a set of
                candidate rates, estimates the expected revenue each would produce by year-end, and selects the best
                one. Occupied units are never touched.
              </p>

              {/* Pipeline diagram */}
              <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-4 border border-[var(--trilogy-teal)]/20">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3 text-sm uppercase tracking-wide">
                  Per-Vacant-Unit Pipeline
                </h4>
                <div className="flex flex-col md:flex-row gap-2 items-center text-sm">
                  {[
                    { label: "Compute Urgency", sub: "gap × months remaining" },
                    { label: "Classify Unit", sub: "Volume / Premium / Neutral" },
                    { label: "Generate Candidates", sub: "discount, premium, or ±1%" },
                    { label: "Score Each Candidate", sub: "expected revenue by Dec 31" },
                    { label: "Select Best Rate", sub: "highest score wins" },
                  ].map((step, i, arr) => (
                    <div key={i} className="flex items-center gap-2 flex-shrink-0">
                      <div className="bg-white rounded-lg border border-[var(--trilogy-teal)]/30 px-3 py-2 text-center">
                        <div className="font-medium text-[var(--trilogy-dark-blue)] whitespace-nowrap">{step.label}</div>
                        <div className="text-[var(--trilogy-grey)]/70 text-xs mt-0.5 whitespace-nowrap">{step.sub}</div>
                      </div>
                      {i < arr.length - 1 && (
                        <ChevronRight className="h-4 w-4 text-[var(--trilogy-teal)] hidden md:block flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 1: Urgency */}
              <div>
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] text-lg mb-3">Step 1 — Urgency Score</h4>
                <p className="text-sm mb-3">
                  An urgency score between 0 and 1 is computed from two inputs: how far behind the revenue growth
                  target the campus is, and how many months remain in the calendar year.
                </p>
                <div className="font-mono text-sm bg-gray-50 border border-gray-200 rounded p-3">
                  Urgency = clamp( |growth gap %| ÷ (months remaining × urgencyDivisor), 0, 1 )
                </div>
                <p className="text-xs text-[var(--trilogy-grey)]/70 mt-2">
                  A campus 8 percentage points behind target with 4 months remaining scores 1.0 (maximum urgency).
                  A campus ahead of target has urgency = 0. Default urgencyDivisor = 2.0.
                </p>
              </div>

              {/* Step 2: Segmentation */}
              <div>
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] text-lg mb-3">Step 2 — Unit Classification</h4>
                <p className="text-sm mb-3">
                  Each vacant unit is scored across five criteria. The side with the higher cumulative score wins.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border-2 border-[var(--trilogy-orange)]/40 bg-[var(--trilogy-orange)]/5 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="h-5 w-5 text-[var(--trilogy-orange)]" />
                      <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Volume Driver</h5>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)] leading-relaxed">
                      High urgency · unit vacant longer than peers · AI Rate above competitor average ·
                      low occupancy · below-average unit attributes
                    </p>
                    <p className="text-xs font-medium text-[var(--trilogy-orange)] mt-2">Action: 3–8% discount</p>
                  </div>
                  <div className="rounded-lg border-2 border-[var(--trilogy-teal)]/40 bg-[var(--trilogy-teal)]/5 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-5 w-5 text-[var(--trilogy-teal)]" />
                      <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Premium Driver</h5>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)] leading-relaxed">
                      Strong leasing velocity · unit filling faster than peers · AI Rate below competitor average ·
                      high occupancy · premium unit attributes
                    </p>
                    <p className="text-xs font-medium text-[var(--trilogy-teal)] mt-2">Action: 2–10% increase</p>
                  </div>
                  <div className="rounded-lg border-2 border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="h-5 w-5 text-[var(--trilogy-grey)]" />
                      <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Neutral</h5>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)] leading-relaxed">
                      Balanced signals or low confidence — neither volume nor premium case is clearly supported
                    </p>
                    <p className="text-xs font-medium text-[var(--trilogy-grey)] mt-2">Action: ±1% only</p>
                  </div>
                </div>
                <div className="mt-3 bg-gray-50 rounded-lg p-3 text-xs text-[var(--trilogy-grey)]">
                  <strong>Scoring criteria and weights:</strong> Urgency 20% · Sales velocity vs pace 20% ·
                  Days vacant vs unit-type average 15% · Competitor gap 20% · Unit attribute quality 25%.
                  Confidence score = |volumeScore − premiumScore| ÷ totalScore.
                </div>
              </div>

              {/* Step 3: Sale probability */}
              <div>
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] text-lg mb-3">Step 3 — Sale Probability Model</h4>
                <p className="text-sm mb-3">
                  For each candidate rate, an adjusted weekly sale probability is estimated and used to project
                  expected revenue by December 31.
                </p>
                <div className="space-y-2 font-mono text-xs bg-gray-50 border border-gray-200 rounded p-3">
                  <div>adjustedWeeklyProb = baseProb × elasticityMult × daysVacantFactor × occupancyFactor × competitorFactor × attributeFactor</div>
                  <div>expectedSaleProb = 1 − exp(−adjustedWeeklyProb × weeksRemaining)</div>
                  <div>expectedRevenue = expectedSaleProb × candidateRate × revenueMonthsRemaining</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm">
                  <div className="bg-white rounded border border-gray-200 p-3">
                    <h6 className="font-medium text-[var(--trilogy-dark-blue)] mb-1">Sales velocity source</h6>
                    <p className="text-xs text-[var(--trilogy-grey)]">
                      Base probability is drawn from a velocity cache built at run-time from recent move-in dates
                      in the current rent roll. Fallback chain: room type → service line → campus → 10%/week default.
                    </p>
                  </div>
                  <div className="bg-white rounded border border-gray-200 p-3">
                    <h6 className="font-medium text-[var(--trilogy-dark-blue)] mb-1">Price elasticity</h6>
                    <p className="text-xs text-[var(--trilogy-grey)]">
                      Each 1% discount multiplies weekly sale probability by (1 + 0.8×discount). Each 1% premium
                      reduces it by (1 − 0.8×increase). Stale vacant units are more responsive to discounts.
                    </p>
                  </div>
                </div>
              </div>

              {/* Step 4: Selection rule */}
              <div className="bg-[var(--trilogy-dark-blue)]/5 rounded-lg p-4 border border-[var(--trilogy-dark-blue)]/20">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-2">Step 4 — Best Candidate Selection Rules</h4>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li><strong>Volume Driver:</strong> Discount selected only if expected revenue improves by ≥ 0.5%</li>
                  <li><strong>Premium Driver:</strong> Increase selected if revenue improves, or if the exit-rate value rises and sale probability drops by less than 15 percentage points</li>
                  <li><strong>Neutral:</strong> Only applied if revenue improvement exceeds the 0.5% minimum threshold</li>
                  <li><strong>No improvement:</strong> If no candidate clears the threshold, the existing AI Rate is preserved unchanged</li>
                  <li><strong>No target set:</strong> If no revenue growth target exists for the location / service line, the existing AI Rate passes through untouched</li>
                </ul>
              </div>

              {/* What gets stored */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">What Gets Stored</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {[
                    { field: "targetAwareAiRate", desc: "Rate chosen by strategy layer" },
                    { field: "unitStrategySegment", desc: "volume_driver / premium_driver / neutral" },
                    { field: "urgencyScore", desc: "0–1 urgency from gap × time" },
                    { field: "expectedRevenueExistingAi", desc: "Projected revenue at existing rate" },
                    { field: "expectedRevenueTargetAware", desc: "Projected revenue at new rate" },
                    { field: "incrementalExpectedRevenue", desc: "Difference between the two" },
                    { field: "strategyLayerDetails", desc: "Full audit trail (JSON)" },
                    { field: "strategyLayerProjection", desc: "Portfolio summary in API response" },
                  ].map(({ field, desc }) => (
                    <div key={field} className="bg-white rounded border border-gray-200 p-2">
                      <div className="font-mono text-[var(--trilogy-teal)] mb-0.5">{field}</div>
                      <div className="text-[var(--trilogy-grey)]/80">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card id="stage4" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center">
                <Target className="mr-3 h-6 w-6 text-[var(--trilogy-orange)]" />
                Stage 4: Revenue Growth Target Integration
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
                        When actual YOY growth falls short of the target, the system <strong>signals attention needed</strong> rather 
                        than blindly pushing rates higher (which could slow sales). The amber "Attention Needed" indicator 
                        alerts operators to review the location's strategy. The algorithm's occupancy and vacancy decay 
                        factors continue to appropriately price hard-to-fill units to drive sales velocity.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">Revenue Gap Formula</h4>
                <div className="font-mono text-sm bg-white p-3 rounded border border-gray-200 mb-3">
                  Revenue Gap = Actual YOY Growth % - Target Growth %
                </div>
                <div className="text-sm space-y-2">
                  <p><strong>If Gap ≥ 0 (ahead of target):</strong> Allow modest premium (up to +2%)</p>
                  <p><strong>If Gap &lt; 0 (behind target):</strong> Signal for operator review - no automatic price increase</p>
                </div>
                <p className="text-sm mt-3 text-[var(--trilogy-grey)]/80 italic">
                  Note: When behind target, the algorithm relies on occupancy pressure and vacancy decay factors 
                  (which naturally reduce rates for hard-to-fill units) to drive sales velocity rather than 
                  counterproductively raising prices.
                </p>
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

          <Card id="guardrails" className="bg-white/95 backdrop-blur border-[var(--trilogy-teal)]/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Shield className="mr-1 h-6 w-6 text-[var(--trilogy-teal)]" />
                Rules Engine &amp; Guardrails
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
                The foundation of controlled pricing — and the primary reason Modulo rates and AI rates are kept separate
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                The Rules Engine — also called Guardrails — is one of Modulo's most important features.
                It gives operators precise control over how pricing recommendations are generated and applied,
                without requiring constant manual review of every unit. Rules define the hard boundaries within
                which any rate change can occur. No recommendation ever leaves these boundaries, regardless of
                what the algorithm or AI calculates.
              </p>

              {/* Why Modulo and AI are separate */}
              <div className="rounded-lg border border-[var(--trilogy-grey)]/20 bg-[var(--dashboard-bg)] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <ArrowRightLeft className="h-5 w-5 text-[var(--trilogy-teal)]" />
                  <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">Why Modulo Rates and AI Rates Are Separate</h3>
                </div>
                <p className="text-sm">
                  The Modulo rate is a deterministic, rules-governed recommendation — fully auditable, repeatable,
                  and bounded by your guardrails. The AI rate is a second, independent suggestion generated by
                  the AI Pricing Engine and shown alongside it for comparison. Keeping them separate lets operators
                  see both perspectives without one overwriting the other. Operators decide which rate to adopt,
                  when to adopt it, and at what frequency — the system never forces a change.
                </p>
              </div>

              {/* Two operating modes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-[var(--trilogy-teal)]/30 bg-[var(--trilogy-teal)]/5 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <SlidersHorizontal className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">Dynamic Weights Mode</h3>
                  </div>
                  <p className="text-sm">
                    Use Modulo's full multi-factor engine with configurable weights for occupancy, competitor
                    rates, vacancy duration, room attributes, seasonal factors, and more. The algorithm
                    continuously balances these signals and outputs a recommendation that shifts dynamically
                    as market conditions change — the same way hotel and airline revenue management works.
                    Guardrails keep every suggestion within safe bounds while the weights handle nuance.
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--trilogy-dark-blue)]/30 bg-[var(--trilogy-dark-blue)]/5 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <CalendarClock className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                    <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">Traditional Rules Mode</h3>
                  </div>
                  <p className="text-sm">
                    Operators can configure Modulo as a rules-based pricing engine — set your floors, ceilings,
                    and change limits, then run calculations at whatever cadence fits your workflow: daily, weekly,
                    monthly, or on-demand. This makes Modulo an immediate upgrade over manual spreadsheet pricing,
                    requiring no change to how teams already think about rate decisions — just faster, more
                    consistent execution with a full audit trail.
                  </p>
                </div>
              </div>

              {/* What rules control */}
              <div className="rounded-lg border border-[var(--trilogy-grey)]/20 bg-[var(--dashboard-bg)] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="h-5 w-5 text-[var(--trilogy-teal)]" />
                  <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">What the Rules Engine Controls</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-gray-200 rounded-lg p-4 bg-white">
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Rate Change Limits</h5>
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      <li>Maximum single increase: configurable (default 25%)</li>
                      <li>Maximum single decrease: configurable (default 15%)</li>
                      <li>Prevents excessive price swings between cycles</li>
                    </ul>
                  </div>
                  <div className="border border-gray-200 rounded-lg p-4 bg-white">
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Absolute Price Limits</h5>
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      <li>Minimum absolute price floor per service line</li>
                      <li>Maximum absolute price ceiling per service line</li>
                      <li>Competitor variance limits (±10% default)</li>
                    </ul>
                  </div>
                  <div className="border border-gray-200 rounded-lg p-4 bg-white">
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Occupancy &amp; Demand Triggers</h5>
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      <li>Occupancy thresholds that activate pricing pressure</li>
                      <li>Vacancy day triggers for progressive discounts</li>
                    </ul>
                  </div>
                  <div className="border border-gray-200 rounded-lg p-4 bg-white">
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Scope &amp; Configuration</h5>
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      <li>Configurable at portfolio, location, or service line level</li>
                      <li>Seasonal adjustment overrides</li>
                      <li>Granular control across different segments</li>
                    </ul>
                  </div>
                </div>
              </div>
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
                  <strong>Base Rate Calculation:</strong> Modulo algorithm calculates an initial recommendation
                  using 7 weighted factors — occupancy, vacancy decay, room attributes, seasonality, competitor
                  positioning, market conditions, and demand signals.
                </li>
                <li className="pl-2">
                  <strong>AI Optimization:</strong> Machine learning adjusts weights based on historical outcomes
                  (adoptions and sales within 30 days), continuously improving recommendations through a daily
                  learning loop.
                </li>
                <li className="pl-2">
                  <strong>Revenue Target Strategy Layer</strong>{" "}
                  <span className="inline-flex items-center gap-1 text-xs bg-[var(--trilogy-teal)]/15 text-[var(--trilogy-teal)] rounded px-1.5 py-0.5 font-medium align-middle">
                    <Layers className="h-3 w-3" /> New
                  </span>
                  <span className="block mt-0.5">
                    For each <em>vacant</em> unit: computes urgency from the revenue gap and months remaining,
                    classifies the unit as Volume Driver, Premium Driver, or Neutral, generates candidate rates
                    within the segment's range, and selects the candidate with the highest expected revenue by
                    December 31 using a Poisson sale-probability model. Occupied units are skipped.
                  </span>
                </li>
                <li className="pl-2">
                  <strong>Revenue Target Integration:</strong> High-level strategic overlay — tracks actual
                  YOY growth vs. target and surfaces "Attention Needed" signals when a campus is falling behind.
                  Applies a modest premium allowance (up to +2%) when a campus is ahead of target.
                </li>
                <li className="pl-2">
                  <strong>Guardrail Enforcement:</strong> Final rates are clamped to configured min/max limits
                  (absolute floors, ceilings, and max change fractions) to ensure business boundaries are
                  respected regardless of algorithmic output.
                </li>
                <li className="pl-2">
                  <strong>Continuous Improvement:</strong> Daily automated calculations and ML learning loops
                  keep pricing optimised as occupancy, competitor rates, and market conditions evolve.
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

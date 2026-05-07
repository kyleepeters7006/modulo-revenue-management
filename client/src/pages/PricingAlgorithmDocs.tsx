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
  Layers,
  ArrowDown,
} from "lucide-react";
import { useLocation } from "wouter";

export default function PricingAlgorithmDocs() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-[var(--dashboard-bg)] p-8">
      <div className="max-w-5xl mx-auto">

        {/* Back button */}
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

        {/* Title */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-light text-[var(--trilogy-dark-blue)] mb-4">
            Pricing Algorithm Documentation
          </h1>
          <p className="text-xl text-[var(--trilogy-grey)]">
            Understanding How Modulo Calculates Optimal Rates
          </p>
        </div>

        {/* Jump links */}
        <div className="text-center -mt-4 mb-10 text-sm text-[var(--trilogy-grey)]/70 flex flex-wrap justify-center gap-x-2 gap-y-1">
          <span>Jump to:</span>
          <a href="#overview" className="text-[var(--trilogy-teal)] hover:underline">Overview</a>
          <span>·</span>
          <a href="#workflow" className="text-[var(--trilogy-teal)] hover:underline">Workflow</a>
          <span>·</span>
          <a href="#modulo-rate" className="text-[var(--trilogy-teal)] hover:underline">Modulo Rate</a>
          <span>·</span>
          <a href="#smart-rules" className="text-[var(--trilogy-teal)] hover:underline">Smart Adjustment Rules</a>
          <span>·</span>
          <a href="#ai-rate" className="text-[var(--trilogy-teal)] hover:underline">AI Rate</a>
          <span>·</span>
          <a href="#revenue-strategy" className="text-[var(--trilogy-teal)] hover:underline">Revenue Target Strategy</a>
          <span>·</span>
          <a href="#guardrails" className="text-[var(--trilogy-teal)] hover:underline">Guardrails</a>
          <span>·</span>
          <a href="#summary" className="text-[var(--trilogy-teal)] hover:underline">Summary</a>
        </div>

        <div className="space-y-8">

          {/* ── 1. OVERVIEW ──────────────────────────────────────────────────── */}
          <Card id="overview" className="bg-gradient-to-r from-[var(--trilogy-teal)]/10 to-[var(--trilogy-dark-blue)]/10 border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <GitBranch className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-[var(--trilogy-grey)]">
              <p>
                Modulo generates <strong className="text-[var(--trilogy-dark-blue)]">two separate pricing recommendations</strong> for every unit — the <strong>Modulo Rate</strong> and the <strong>AI Rate</strong>. Both are bounded by Guardrails. Operators see both side-by-side and choose which rate to adopt, and when.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-lg border border-[var(--trilogy-teal)]/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calculator className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">Modulo Rate</h4>
                  </div>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Deterministic and fully auditable</li>
                    <li>Driven by six operator-configured weighted signals</li>
                    <li>Room attributes applied as a separate quality multiplier</li>
                    <li>Smart Adjustment Rules apply here — not to the AI Rate</li>
                    <li>Guardrails apply after Smart Adjustment Rules</li>
                  </ul>
                </div>
                <div className="bg-white rounded-lg border border-[var(--trilogy-dark-blue)]/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                    <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">AI Rate</h4>
                  </div>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>AI-enhanced, independently generated</li>
                    <li>Uses GPT-generated weights based on current portfolio snapshot</li>
                    <li>Refined over time by ML learning from outcomes</li>
                    <li>Revenue Target Strategy applies here — not to the Modulo Rate</li>
                    <li>Revenue Target Strategy applies to vacant units only</li>
                    <li>Guardrails apply after Revenue Target Strategy</li>
                  </ul>
                </div>
              </div>

              <div className="bg-white/70 rounded-lg border border-[var(--trilogy-grey)]/20 p-4 text-sm">
                <strong className="text-[var(--trilogy-dark-blue)]">Key rule:</strong> Smart Adjustment Rules belong to the Modulo Rate path only. The Revenue Target Strategy Layer belongs to the AI Rate path only. Guardrails apply to both.
              </div>
            </CardContent>
          </Card>

          {/* ── 2. COMPLETE PRICING WORKFLOW ─────────────────────────────────── */}
          <Card id="workflow" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Layers className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Complete Pricing Workflow
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p className="text-sm">
                Modulo runs two independent pricing paths in parallel. Each path starts from the same base unit data and ends at a guardrail-bounded rate recommendation.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Modulo path */}
                <div>
                  <div className="text-center mb-3">
                    <span className="inline-flex items-center gap-1.5 bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal)] font-semibold text-sm px-3 py-1 rounded-full border border-[var(--trilogy-teal)]/30">
                      <Calculator className="h-4 w-4" /> Modulo Rate Path
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    {[
                      { label: "Base Unit Data", sub: "occupancy, rates, vacancy, attributes" },
                      { label: "Modulo Core Engine", sub: "6 weighted signals + attribute multiplier" },
                      { label: "Smart Adjustment Rules", sub: "operator-defined rules, stacked in priority order" },
                      { label: "Guardrails", sub: "max increase/decrease, competitor variance" },
                      { label: "Modulo Rate", sub: "deterministic recommendation", highlight: true },
                    ].map((step, i) => (
                      <div key={i} className="flex flex-col items-center w-full">
                        <div className={`w-full rounded-lg border px-4 py-2.5 text-center text-sm ${step.highlight ? "bg-[var(--trilogy-teal)] text-white border-[var(--trilogy-teal)] font-semibold" : "bg-white border-[var(--trilogy-teal)]/20"}`}>
                          <div className={`font-medium ${step.highlight ? "text-white" : "text-[var(--trilogy-dark-blue)]"}`}>{step.label}</div>
                          <div className={`text-xs mt-0.5 ${step.highlight ? "text-white/80" : "text-[var(--trilogy-grey)]/70"}`}>{step.sub}</div>
                        </div>
                        {i < 4 && <ArrowDown className="h-4 w-4 text-[var(--trilogy-teal)] my-0.5 flex-shrink-0" />}
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI path */}
                <div>
                  <div className="text-center mb-3">
                    <span className="inline-flex items-center gap-1.5 bg-[var(--trilogy-dark-blue)]/10 text-[var(--trilogy-dark-blue)] font-semibold text-sm px-3 py-1 rounded-full border border-[var(--trilogy-dark-blue)]/30">
                      <Brain className="h-4 w-4" /> AI Rate Path
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    {[
                      { label: "Base Unit Data", sub: "occupancy, rates, vacancy, attributes" },
                      { label: "AI Pricing Engine", sub: "GPT-generated weights + ML-refined learning" },
                      { label: "Revenue Target Strategy", sub: "vacant units only — occupied units pass through" },
                      { label: "Guardrails", sub: "max increase/decrease, competitor variance" },
                      { label: "AI Rate", sub: "AI-enhanced recommendation", highlight: true },
                    ].map((step, i) => (
                      <div key={i} className="flex flex-col items-center w-full">
                        <div className={`w-full rounded-lg border px-4 py-2.5 text-center text-sm ${step.highlight ? "bg-[var(--trilogy-dark-blue)] text-white border-[var(--trilogy-dark-blue)] font-semibold" : "bg-white border-[var(--trilogy-dark-blue)]/20"}`}>
                          <div className={`font-medium ${step.highlight ? "text-white" : "text-[var(--trilogy-dark-blue)]"}`}>{step.label}</div>
                          <div className={`text-xs mt-0.5 ${step.highlight ? "text-white/80" : "text-[var(--trilogy-grey)]/70"}`}>{step.sub}</div>
                        </div>
                        {i < 4 && <ArrowDown className="h-4 w-4 text-[var(--trilogy-dark-blue)] my-0.5 flex-shrink-0" />}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── WHY TWO RATES ────────────────────────────────────────────────── */}
          <Card className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <ArrowRightLeft className="h-5 w-5 text-[var(--trilogy-teal)]" />
                Why Modulo Rate and AI Rate Are Separate
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[var(--trilogy-grey)]">
              <p className="text-sm leading-relaxed">
                The <strong className="text-[var(--trilogy-dark-blue)]">Modulo Rate</strong> is the deterministic, rules-governed recommendation — fully auditable, repeatable, and bounded by operator-configured guardrails. The <strong className="text-[var(--trilogy-dark-blue)]">AI Rate</strong> is a second, independent AI-enhanced recommendation generated by a separate engine and shown alongside it for comparison. Keeping them separate lets operators see both perspectives without one automatically overwriting the other. Operators decide which rate to adopt, when to adopt it, and at what frequency — the system never forces a change.
              </p>
            </CardContent>
          </Card>

          {/* ── 3. MODULO RATE CALCULATION ───────────────────────────────────── */}
          <Card id="modulo-rate" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Calculator className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Modulo Rate Calculation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                The Modulo engine is a deterministic, multi-factor pricing model. It blends six weighted pricing signals into a single adjustment, applies a room attribute quality multiplier, then clamps the result with guardrails. The same inputs always produce the same output — making every recommendation fully auditable.
              </p>

              {/* Formula */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">Core Formula</h4>
                <div className="font-mono text-sm bg-white p-3 rounded border border-gray-200">
                  Final Price = Base Rate × (1 + Blended Adjustment)
                </div>
                <p className="text-sm mt-2">
                  Where <strong>Blended Adjustment</strong> = Σ(Signal × Normalized Weight), capped at ±25%
                </p>
                <p className="text-sm mt-1 text-[var(--trilogy-grey)]/80">
                  After blending, a room attribute multiplier of up to ±10% is applied separately based on unit quality.
                </p>
              </div>

              {/* 6 signals */}
              <div>
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] text-lg mb-4">The 6 Weighted Pricing Signals</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-gray-200 rounded-lg p-4 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="h-5 w-5 text-[var(--trilogy-teal)]" />
                      <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Occupancy Pressure</h5>
                    </div>
                    <p className="text-sm">
                      <strong>Range:</strong> −12% to +6%<br />
                      Campus-level occupancy drives pricing pressure. Below 85% triggers stronger reductions; above 90% supports premium pricing.
                    </p>
                  </div>

                  <div className="border border-gray-200 rounded-lg p-4 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="h-5 w-5 text-[var(--trilogy-teal)]" />
                      <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Days Vacant Decay</h5>
                    </div>
                    <p className="text-sm">
                      <strong>Range:</strong> −15% to 0%<br />
                      Progressive discounts begin after a 7-day grace period and increase with extended vacancy duration.
                    </p>
                  </div>

                  <div className="border border-gray-200 rounded-lg p-4 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="h-5 w-5 text-[var(--trilogy-teal)]" />
                      <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Seasonality</h5>
                    </div>
                    <p className="text-sm">
                      <strong>Range:</strong> ±5%<br />
                      Monthly demand patterns adjust pricing. Peak months (May–July) support increases; slower months (Oct–Dec) may see modest reductions.
                    </p>
                  </div>

                  <div className="border border-gray-200 rounded-lg p-4 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="h-5 w-5 text-[var(--trilogy-teal)]" />
                      <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Competitor Positioning</h5>
                    </div>
                    <p className="text-sm">
                      <strong>Range:</strong> ±8%<br />
                      Compares rates against the market median and targets a service-line-specific premium (10–25% above median) to reflect quality and care value.
                    </p>
                  </div>

                  <div className="border border-gray-200 rounded-lg p-4 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="h-5 w-5 text-[var(--trilogy-teal)]" />
                      <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Market Conditions</h5>
                    </div>
                    <p className="text-sm">
                      <strong>Range:</strong> ±3%<br />
                      S&amp;P 500 performance provides macroeconomic context. Strong markets support higher pricing; weak markets suggest caution.
                    </p>
                  </div>

                  <div className="border border-gray-200 rounded-lg p-4 bg-white">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="h-5 w-5 text-[var(--trilogy-teal)]" />
                      <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Demand Signals</h5>
                    </div>
                    <p className="text-sm">
                      <strong>Range:</strong> ±15%<br />
                      Inquiry and tour volume. High volume justifies premium pricing; low volume indicates market softness.
                    </p>
                  </div>
                </div>
              </div>

              {/* Room attributes note */}
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-[var(--trilogy-grey)] flex items-start gap-2">
                <Home className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                <span>
                  <strong className="text-[var(--trilogy-dark-blue)]">Room attributes</strong> (location within building, unit size, view quality, renovation status, amenity level)
                  are applied as a <em>separate quality multiplier</em> after the six signals are blended — not as one of the weighted signals.
                  Premium rooms earn up to ±10% relative to their base rate.
                </span>
              </div>

              {/* Service line premiums */}
              <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-2">Service Line Premium Targets</h4>
                <p className="text-sm mb-3">
                  The Competitor Positioning signal targets these premiums above the local competitor median:
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  {[
                    { label: "AL", value: "+25%" },
                    { label: "HC", value: "+20%" },
                    { label: "AL/MC, HC/MC", value: "+20%" },
                    { label: "SL", value: "+10%" },
                    { label: "VIL", value: "+10%" },
                    { label: "Default", value: "+18%" },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white rounded px-3 py-2">
                      <span className="font-medium">{label}:</span> {value} premium
                    </div>
                  ))}
                </div>
              </div>

              {/* Two operating modes */}
              <div>
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] text-lg mb-4">Operating Modes</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-[var(--trilogy-teal)]/30 bg-[var(--trilogy-teal)]/5 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <SlidersHorizontal className="h-5 w-5 text-[var(--trilogy-teal)]" />
                      <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Dynamic Weights Mode</h5>
                    </div>
                    <p className="text-sm">
                      Operators configure signal weights to reflect their priorities — heavily weighted toward occupancy in high-vacancy markets, toward competitor positioning in competitive markets, etc. The algorithm continuously blends these signals as conditions change. Guardrails keep every suggestion within safe bounds.
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--trilogy-dark-blue)]/30 bg-[var(--trilogy-dark-blue)]/5 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <CalendarClock className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                      <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Traditional Rules Mode</h5>
                    </div>
                    <p className="text-sm">
                      Configure floors, ceilings, and change limits and run calculations at whatever cadence fits your workflow — daily, weekly, monthly, or on-demand. An immediate upgrade over manual spreadsheet pricing with a full audit trail and no change to how teams think about rate decisions.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── 4. SMART ADJUSTMENT RULES ────────────────────────────────────── */}
          <Card id="smart-rules" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Sparkles className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Smart Adjustment Rules
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
                Applies to the Modulo Rate path only — runs after Modulo, before Guardrails
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                Smart Adjustment Rules are operator-defined pricing rules written in plain English — for example, <em>"Reduce vacant AL rates by $100 after 30 days vacant."</em> They are parsed by AI into structured conditions and applied automatically on every Modulo calculation cycle. Multiple active rules stack in priority order, each building on the rate produced by the previous rule.
              </p>

              {/* Placement callout */}
              <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-3 border border-[var(--trilogy-teal)]/20 text-sm flex items-start gap-2">
                <Zap className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                <span>
                  Smart Adjustment Rules apply <strong>after</strong> the core Modulo Rate is calculated and <strong>before</strong> Guardrails clamp the result.
                  They do <strong>not</strong> apply to the AI Rate path.
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-4">
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-[var(--trilogy-teal)]" />
                    Trigger Types
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Immediate</p><p>Applies to every unit in scope on every calculation run.</p></div>
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Occupancy Status</p><p>Triggers only for vacant or only for occupied units.</p></div>
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Vacancy Duration</p><p>Triggers when a unit has been vacant for a configurable number of days (e.g. ≥ 30 days).</p></div>
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Service Line</p><p>Restricts a trigger to a specific service line (AL, MC, IL, etc.).</p></div>
                  </div>
                </div>

                <div className="bg-[var(--trilogy-dark-blue)]/5 rounded-lg p-4">
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3 flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-[var(--trilogy-dark-blue)]" />
                    Action Types &amp; Scope
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Percentage Adjustment</p><p>Multiplies the current rate by 1 + value/100. E.g. +5% or −3%.</p></div>
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Fixed Dollar Adjustment</p><p>Adds or subtracts a flat dollar amount. E.g. −$100 or +$50.</p></div>
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Scope options</p><ul className="list-disc list-inside mt-1 space-y-0.5"><li>Portfolio-wide</li><li>Location-specific</li><li>Service-line-specific</li><li>Location + service line</li></ul></div>
                  </div>
                </div>
              </div>

              {/* Stacking example */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">Rule Stacking Example</h4>
                <p className="text-sm mb-3">
                  Rules are applied in descending priority order. Each rule receives the rate produced by the previous rule — adjustments compound rather than conflict.
                </p>
                <div className="font-mono text-xs bg-white p-3 rounded border border-gray-200 space-y-1">
                  <p>Base Modulo Rate: $4,500</p>
                  <p>Rule 1 (priority 10) — +5% AL all vacant → $4,500 × 1.05 = <strong>$4,725</strong></p>
                  <p>Rule 2 (priority 5) — −$100 after 30 days vacant → $4,725 − $100 = <strong>$4,625</strong></p>
                  <p className="text-[var(--trilogy-teal)] mt-1">Final Rule-Adjusted Modulo Rate: $4,625</p>
                </div>
                <p className="text-xs text-[var(--trilogy-grey)]/70 mt-2">
                  The <code className="bg-white rounded px-1 border border-gray-200">applied_rule_name</code> column records each rule that fired so operators can audit exactly which rules affected each unit.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Where in the pipeline</h5>
                  <p className="text-sm">After Modulo calculates the base rate, before Guardrails clamp the result. Modulo Rate path only.</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">When they run</h5>
                  <p className="text-sm">Automatically on every Modulo calculation — daily automated runs and manual triggers. Also executable on-demand via the Smart Adjustments panel.</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">How to configure</h5>
                  <p className="text-sm">Navigate to <strong>Pricing Controls → Smart Adjustments</strong>. Type a rule in plain English, preview its impact, then activate it. Rules can be toggled on/off without deletion.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── 5. AI RATE CALCULATION ───────────────────────────────────────── */}
          <Card id="ai-rate" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Brain className="h-6 w-6 text-[var(--trilogy-dark-blue)]" />
                AI Rate Calculation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                The AI Pricing Engine generates a separate AI Rate using two complementary mechanisms: a per-run GPT-5 weight suggestion and an ongoing ML learning loop. These operate independently — the GPT suggestion shapes each run, while the ML system refines the model over time.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-[var(--trilogy-dark-blue)]/20 rounded-lg p-4 bg-[var(--trilogy-dark-blue)]/5">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Per-Run: GPT-5 Weight Suggestion</h5>
                  </div>
                  <ol className="text-sm space-y-2 list-decimal list-inside">
                    <li>Current portfolio snapshot is sent to GPT-5 (occupancy, vacancy, competitor rates, service line breakdown)</li>
                    <li>GPT-5 returns suggested pricing weights with reasoning</li>
                    <li>Suggested weights are used for that calculation batch</li>
                    <li>Per-unit AI Rates are produced using those weights</li>
                    <li>Guardrails clamp the final rates before storage</li>
                  </ol>
                </div>

                <div className="border border-[var(--trilogy-dark-blue)]/20 rounded-lg p-4 bg-[var(--trilogy-dark-blue)]/5">
                  <div className="flex items-center gap-2 mb-3">
                    <RefreshCw className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Ongoing: ML Learning Loop</h5>
                  </div>
                  <ul className="text-sm space-y-2 list-disc list-inside">
                    <li>Tracks when AI-suggested rates are adopted by operators</li>
                    <li>Monitors whether adopted rates result in move-ins within 30 days</li>
                    <li>Regularized regression identifies which factors predicted success</li>
                    <li>Weight versions are stored for rollback</li>
                    <li>Models train per service line or globally</li>
                    <li>Portfolio-wide daily calculations run at 6:00 AM EST</li>
                  </ul>
                </div>
              </div>

              {/* Comparison table */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">Modulo Rate vs AI Rate: Key Differences</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-[var(--trilogy-dark-blue)]">Aspect</th>
                      <th className="text-left py-2 text-[var(--trilogy-dark-blue)]">Modulo Rate</th>
                      <th className="text-left py-2 text-[var(--trilogy-dark-blue)]">AI Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2">Weight source</td>
                      <td className="py-2">Operator-configured</td>
                      <td className="py-2">GPT-5 suggested, ML-refined</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2">Determinism</td>
                      <td className="py-2">Fully deterministic</td>
                      <td className="py-2">AI-enhanced, adapts over time</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2">Adjustment layer</td>
                      <td className="py-2">Smart Adjustment Rules</td>
                      <td className="py-2">Revenue Target Strategy (vacant units only)</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2">Outcome tracking</td>
                      <td className="py-2">Not used</td>
                      <td className="py-2">Adoption + move-in outcomes</td>
                    </tr>
                    <tr>
                      <td className="py-2">Best for</td>
                      <td className="py-2">Predictable, auditable pricing</td>
                      <td className="py-2">Continuous optimization</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── 6. REVENUE TARGET STRATEGY LAYER ────────────────────────────── */}
          <Card id="revenue-strategy" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Target className="h-6 w-6 text-[var(--trilogy-orange)]" />
                Revenue Target Strategy Layer
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-orange)] font-medium mt-1">
                Add-on overlay for the AI Rate — applies to vacant units only
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                The Revenue Target Strategy Layer is an add-on overlay to the AI Rate — not a replacement. It starts with the AI Rate, then evaluates whether a vacant unit should preserve that rate, discount modestly to accelerate leasing, or increase modestly to improve exit-rate value. Occupied units pass through unchanged to Guardrails.
              </p>

              <div className="bg-[var(--trilogy-orange)]/5 rounded-lg p-3 border border-[var(--trilogy-orange)]/20 text-sm flex items-start gap-2">
                <Target className="h-4 w-4 text-[var(--trilogy-orange)] mt-0.5 flex-shrink-0" />
                <span>
                  If no revenue growth target exists for a location or service line, the AI Rate passes through this layer unchanged.
                  If a unit is occupied, it passes through unchanged regardless of targets.
                </span>
              </div>

              {/* Per-unit pipeline */}
              <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-4 border border-[var(--trilogy-teal)]/20">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3 text-sm uppercase tracking-wide">
                  Per-Vacant-Unit Pipeline
                </h4>
                <div className="flex flex-col md:flex-row gap-2 items-center text-sm flex-wrap">
                  {[
                    { label: "Compute Urgency", sub: "gap × months remaining" },
                    { label: "Classify Unit", sub: "Volume / Premium / Neutral" },
                    { label: "Generate Candidates", sub: "discount, premium, or ±1%" },
                    { label: "Score Each Candidate", sub: "expected revenue by Dec 31" },
                    { label: "Select Best Rate", sub: "highest score above threshold" },
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
                  A score between 0 and 1 is computed from two inputs: how far behind the revenue growth target the campus is, and how many months remain in the calendar year.
                </p>
                <div className="font-mono text-sm bg-gray-50 border border-gray-200 rounded p-3">
                  Urgency = clamp( |growth gap %| ÷ (months remaining × urgencyDivisor), 0, 1 )
                </div>
                <p className="text-xs text-[var(--trilogy-grey)]/70 mt-2">
                  A campus 8 percentage points behind target with 4 months remaining scores 1.0 (maximum urgency). A campus ahead of target has urgency = 0. Default urgencyDivisor = 2.0.
                </p>
              </div>

              {/* Step 2: Classification */}
              <div>
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] text-lg mb-3">Step 2 — Unit Classification</h4>
                <p className="text-sm mb-3">
                  Each vacant unit is scored across five criteria. The side with the higher cumulative score determines the classification.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border-2 border-[var(--trilogy-orange)]/40 bg-[var(--trilogy-orange)]/5 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="h-5 w-5 text-[var(--trilogy-orange)]" />
                      <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Volume Driver</h5>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)] leading-relaxed">
                      High urgency · unit vacant longer than peers · AI Rate above competitor average · low occupancy · below-average unit attributes
                    </p>
                    <p className="text-xs font-medium text-[var(--trilogy-orange)] mt-2">Action: 3–8% discount</p>
                  </div>
                  <div className="rounded-lg border-2 border-[var(--trilogy-teal)]/40 bg-[var(--trilogy-teal)]/5 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-5 w-5 text-[var(--trilogy-teal)]" />
                      <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Premium Driver</h5>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)] leading-relaxed">
                      Strong leasing velocity · filling faster than peers · AI Rate below competitor average · high occupancy · premium unit attributes
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
                  <strong>Scoring criteria:</strong> Urgency 20% · Sales velocity vs pace 20% · Days vacant vs unit-type average 15% · Competitor gap 20% · Unit attribute quality 25%.
                </div>
              </div>

              {/* Step 3: Sale probability */}
              <div>
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] text-lg mb-3">Step 3 — Expected Revenue Model</h4>
                <p className="text-sm mb-3">
                  For each candidate rate, an adjusted weekly sale probability is estimated and used to project expected revenue by December 31.
                </p>
                <div className="space-y-1 font-mono text-xs bg-gray-50 border border-gray-200 rounded p-3">
                  <div>adjustedWeeklyProb = baseProb × elasticityMult × daysVacantFactor × occupancyFactor × competitorFactor × attributeFactor</div>
                  <div>expectedSaleProb = 1 − exp(−adjustedWeeklyProb × weeksRemaining)</div>
                  <div>expectedRevenue = expectedSaleProb × candidateRate × revenueMonthsRemaining</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm">
                  <div className="bg-white rounded border border-gray-200 p-3">
                    <h6 className="font-medium text-[var(--trilogy-dark-blue)] mb-1">Sales velocity source</h6>
                    <p className="text-xs text-[var(--trilogy-grey)]">Base probability is drawn from recent move-in dates in the current rent roll. Fallback chain: room type → service line → campus → 10%/week default.</p>
                  </div>
                  <div className="bg-white rounded border border-gray-200 p-3">
                    <h6 className="font-medium text-[var(--trilogy-dark-blue)] mb-1">Price elasticity</h6>
                    <p className="text-xs text-[var(--trilogy-grey)]">Each 1% discount multiplies weekly sale probability by (1 + 0.8×discount). Each 1% premium reduces it by (1 − 0.8×increase). Stale vacant units are more responsive to discounts.</p>
                  </div>
                </div>
              </div>

              {/* Selection rules */}
              <div className="bg-[var(--trilogy-dark-blue)]/5 rounded-lg p-4 border border-[var(--trilogy-dark-blue)]/20">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-2">Step 4 — Best Candidate Selection</h4>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li><strong>Volume Driver:</strong> Discount selected only if expected revenue improves by ≥ 0.5%</li>
                  <li><strong>Premium Driver:</strong> Increase selected if revenue improves, or if exit-rate value rises and sale probability drops by less than 15 percentage points</li>
                  <li><strong>Neutral:</strong> Only applied if revenue improvement exceeds the 0.5% minimum threshold</li>
                  <li><strong>No improvement:</strong> If no candidate clears the threshold, the existing AI Rate is preserved unchanged</li>
                  <li><strong>No target:</strong> If no revenue growth target exists, the AI Rate passes through untouched</li>
                </ul>
              </div>

              {/* Stored fields */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">What Gets Stored</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {[
                    { field: "targetAwareAiRate", desc: "Rate chosen by strategy layer" },
                    { field: "unitStrategySegment", desc: "volume_driver / premium_driver / neutral" },
                    { field: "urgencyScore", desc: "0–1 urgency from gap × time" },
                    { field: "expectedRevenueExistingAi", desc: "Projected revenue at existing AI Rate" },
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

          {/* ── 7. GUARDRAILS ────────────────────────────────────────────────── */}
          <Card id="guardrails" className="bg-white/95 backdrop-blur border-[var(--trilogy-teal)]/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Shield className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Guardrails
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
                Final safety layer — applies to both the Modulo Rate path and the AI Rate path
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                Guardrails are the last step in both pricing paths. They enforce hard business boundaries regardless of what the Modulo engine, AI Pricing Engine, Smart Adjustment Rules, or Revenue Target Strategy produce. No recommendation ever leaves these boundaries.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Rate Change Limits</h5>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Maximum single increase: configurable (default 15%)</li>
                    <li>Maximum single decrease: configurable (default 5%)</li>
                    <li>Prevents excessive price swings between calculation cycles</li>
                  </ul>
                </div>
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Competitor Variance Limit</h5>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Caps how far a rate can deviate from competitor median (default ±10%)</li>
                    <li>Applies independently of the percentage change limits above</li>
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
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Configuration Scope</h5>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Configurable at portfolio, location, or service line level</li>
                    <li>Seasonal adjustment overrides available</li>
                    <li>Granular control across different segments</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── 8. FINAL SUMMARY ─────────────────────────────────────────────── */}
          <Card id="summary" className="bg-gradient-to-r from-[var(--trilogy-dark-blue)]/10 to-[var(--trilogy-teal)]/10 border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)]">
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[var(--trilogy-grey)]">
              <ol className="space-y-3 list-decimal list-inside">
                <li className="pl-2">
                  <strong>Modulo Rate:</strong> The Modulo engine calculates a deterministic rate using six weighted pricing signals — Occupancy Pressure, Days Vacant Decay, Seasonality, Competitor Positioning, Market Conditions, and Demand Signals. Room attribute quality is applied separately as a multiplier, up to ±10%.
                </li>
                <li className="pl-2">
                  <strong>Smart Adjustment Rules:</strong> Operator-defined rules modify the Modulo Rate only. They apply after the Modulo engine, before Guardrails, and stack in priority order. They do not affect the AI Rate.
                </li>
                <li className="pl-2">
                  <strong>AI Rate:</strong> The AI Pricing Engine independently calculates a second recommendation using GPT-5-generated weights based on the current portfolio snapshot. An ML learning loop refines these weights over time using adoption and move-in outcome data.
                </li>
                <li className="pl-2">
                  <strong>Revenue Target Strategy:</strong> For vacant units with an active revenue growth target, the strategy layer evaluates whether the AI Rate should be preserved, discounted to accelerate leasing, or increased to improve exit-rate value — choosing only the option with the highest expected revenue by year-end. Occupied units pass through unchanged. This layer applies to the AI Rate only.
                </li>
                <li className="pl-2">
                  <strong>Guardrails:</strong> Both final recommendations — the Modulo Rate and the AI Rate — are clamped by Guardrails before being stored or displayed. No recommendation can exceed configured increase or decrease limits, regardless of what the algorithm or AI produces.
                </li>
                <li className="pl-2">
                  <strong>Operator decision:</strong> Operators see both the Modulo Rate and the AI Rate side-by-side and decide which rate to adopt, when, and at what frequency. The system never forces a change.
                </li>
              </ol>
            </CardContent>
          </Card>

        </div>

        {/* Footer button */}
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

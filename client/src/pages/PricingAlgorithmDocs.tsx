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
          <a href="#modulo-rate" className="text-[var(--trilogy-teal)] hover:underline">Rules Rate</a>
          <span>·</span>
          <a href="#smart-rules" className="text-[var(--trilogy-teal)] hover:underline">Rule Designer</a>
          <span>·</span>
          <a href="#ai-rate" className="text-[var(--trilogy-teal)] hover:underline">Revenue Target AI Rate</a>
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
                Modulo generates <strong className="text-[var(--trilogy-dark-blue)]">two separate pricing recommendations</strong> for every unit — the <strong>Rules Rate</strong> and the <strong>Revenue Target AI Rate</strong>. Both are bounded by Guardrails. Operators see both side-by-side and choose which rate to adopt, and when.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-lg border border-[var(--trilogy-teal)]/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calculator className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">Rules Rate</h4>
                  </div>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Deterministic and fully auditable</li>
                    <li>Driven by six operator-configured weighted signals</li>
                    <li>Room attributes reflected in the base rate (the unit's current street rate)</li>
                    <li>Rule Designer rules apply here — not to the Revenue Target AI Rate</li>
                    <li>Guardrails apply after Rule Designer rules</li>
                  </ul>
                </div>
                <div className="bg-white rounded-lg border border-[var(--trilogy-dark-blue)]/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                    <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">Revenue Target AI Rate</h4>
                  </div>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>AI-enhanced, independently generated</li>
                    <li>Uses GPT-generated weights based on current portfolio snapshot</li>
                    <li>Refined over time by ML learning from outcomes</li>
                    <li>Revenue Target Strategy applies here — not to the Rules Rate</li>
                    <li>Revenue Target Strategy applies to vacant units only</li>
                    <li>Guardrails apply after Revenue Target Strategy</li>
                  </ul>
                </div>
              </div>

              <div className="bg-white/70 rounded-lg border border-[var(--trilogy-grey)]/20 p-4 text-sm">
                <strong className="text-[var(--trilogy-dark-blue)]">Key rule:</strong> Rule Designer rules belong to the Rules Rate path only. The Revenue Target Strategy Layer belongs to the Revenue Target AI Rate path only. Guardrails apply to both.
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
                      <Calculator className="h-4 w-4" /> Rules Rate Path
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    {[
                      { label: "Base Unit Data", sub: "occupancy, rates, vacancy, attributes" },
                      { label: "Modulo Core Engine", sub: "6 weighted signals applied to attribute-inclusive base rate" },
                      { label: "Rule Designer", sub: "operator-defined rules, stacked in priority order" },
                      { label: "Guardrails", sub: "max increase/decrease, competitor variance" },
                      { label: "Rules Rate", sub: "deterministic recommendation", highlight: true },
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
                      <Brain className="h-4 w-4" /> Revenue Target AI Rate Path
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    {[
                      { label: "Base Unit Data", sub: "occupancy, rates, vacancy, attributes" },
                      { label: "AI Pricing Engine", sub: "GPT-generated weights + ML-refined learning" },
                      { label: "Revenue Target Strategy", sub: "vacant units only — occupied units pass through" },
                      { label: "Guardrails", sub: "max increase/decrease, competitor variance" },
                      { label: "Revenue Target AI Rate", sub: "AI-enhanced recommendation", highlight: true },
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

          {/* ── 3. MODULO RATE CALCULATION ───────────────────────────────────── */}
          <Card id="modulo-rate" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Calculator className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Rules Rate Calculation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                The Modulo engine is a deterministic, multi-factor pricing model. It blends six weighted pricing signals into a single adjustment applied to the unit's current street rate — a base that already reflects the room's physical attributes. The result is then clamped by guardrails. The same inputs always produce the same output — making every recommendation fully auditable.
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
                  The Base Rate is the unit's current street rate, which already incorporates any room attribute premiums or discounts for that specific unit.
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
                      Compares rates against the local competitor median and moves pricing toward a service-line-specific premium: AL +25%, HC / AL-MC / HC-MC +20%, SL / VIL +10%, default +18%.
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
                  are reflected in the base rate the algorithm starts from — the unit's current street rate, which already incorporates premiums or discounts for that room's specific features.
                  They are not applied as a separate step after signal blending.{" "}
                  You can update a unit's attribute ratings directly from the <strong className="text-[var(--trilogy-dark-blue)]">Room Attributes</strong> page.
                  When a rating changes (for example, upgrading a unit from B to A view quality), the recalculated attributed rate flows into the next calculation cycle automatically.
                </span>
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
                Rule Designer
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
                Applies to the Rules Rate path only — runs after Rules Rate engine, before Guardrails
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                The Rule Designer lets operators create pricing rules in plain English or using structured IF / THEN logic — for example, <em>"Reduce vacant AL rates by $100 after 30 days vacant."</em> Rules are parsed by AI into structured conditions and applied automatically on every Modulo calculation cycle. Multiple active rules stack in priority order, each building on the rate produced by the previous rule.
              </p>

              {/* Placement callout */}
              <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-3 border border-[var(--trilogy-teal)]/20 text-sm flex items-start gap-2">
                <Zap className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                <span>
                  Rule Designer rules apply <strong>after</strong> the core Rules Rate is calculated and <strong>before</strong> Guardrails clamp the result.
                  They do <strong>not</strong> apply to the Revenue Target AI Rate path.
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
                  <p>Base Rules Rate: $4,500</p>
                  <p>Rule 1 (priority 10) — +5% AL all vacant → $4,500 × 1.05 = <strong>$4,725</strong></p>
                  <p>Rule 2 (priority 5) — −$100 after 30 days vacant → $4,725 − $100 = <strong>$4,625</strong></p>
                  <p className="text-[var(--trilogy-teal)] mt-1">Final Rule-Adjusted Rules Rate: $4,625</p>
                </div>
                <p className="text-xs text-[var(--trilogy-grey)]/70 mt-2">
                  The <code className="bg-white rounded px-1 border border-gray-200">applied_rule_name</code> column records each rule that fired so operators can audit exactly which rules affected each unit.
                  To configure rules, navigate to <strong>Pricing Controls → Rule Designer</strong>, type a rule or use the Structured Builder, preview its impact, then save. Rules can be toggled on/off without deletion.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ── 5. AI RATE CALCULATION ───────────────────────────────────────── */}
          <Card id="ai-rate" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Brain className="h-6 w-6 text-[var(--trilogy-dark-blue)]" />
                Revenue Target AI Rate Calculation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                The AI Pricing Engine generates a separate Revenue Target AI Rate using two complementary mechanisms: a per-run GPT-5 weight suggestion and an ongoing ML learning loop. These operate independently — the GPT suggestion shapes each run, while the ML system refines the model over time.
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
                    <li>Per-unit Revenue Target AI Rates are produced using those weights</li>
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
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">Rules Rate vs Revenue Target AI Rate: Key Differences</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-[var(--trilogy-dark-blue)]">Aspect</th>
                      <th className="text-left py-2 text-[var(--trilogy-dark-blue)]">Rules Rate</th>
                      <th className="text-left py-2 text-[var(--trilogy-dark-blue)]">Revenue Target AI Rate</th>
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
                      <td className="py-2">Rule Designer</td>
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
                Add-on overlay for the Revenue Target AI Rate — applies to vacant units only
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                This layer takes each vacant unit's Revenue Target AI Rate and asks one question: would a small price change generate more revenue between now and the end of the year than holding the current rate? Based on the answer, every vacant unit gets one of three outcomes:
              </p>

              <ul className="text-sm list-disc list-outside ml-5 space-y-1">
                <li><strong className="text-[var(--trilogy-dark-blue)]">Keep</strong> the Revenue Target AI Rate unchanged when no small adjustment improves expected revenue.</li>
                <li><strong className="text-[var(--trilogy-dark-blue)]">Discount</strong> modestly when a faster lease — and more months of rent collected — outweighs the lower rate.</li>
                <li><strong className="text-[var(--trilogy-dark-blue)]">Raise</strong> modestly when the unit can absorb a higher rate without meaningfully delaying the lease.</li>
              </ul>

              <div className="bg-[var(--trilogy-orange)]/5 rounded-lg p-3 border border-[var(--trilogy-orange)]/20 text-sm flex items-start gap-2">
                <Target className="h-4 w-4 text-[var(--trilogy-orange)] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-[var(--trilogy-dark-blue)] mb-1">Pass-through cases (Revenue Target AI Rate is forwarded unchanged):</p>
                  <ul className="list-disc list-outside ml-5 space-y-0.5">
                    <li>The unit is occupied — this layer only acts on vacant units.</li>
                    <li>The location or service line has no revenue growth target configured.</li>
                  </ul>
                </div>
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
                    { label: "Generate Candidates", sub: "rates to test based on class" },
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
                      High urgency · unit vacant longer than peers · Revenue Target AI Rate above competitor average · low occupancy · below-average unit attributes
                    </p>
                    <p className="text-xs font-medium text-[var(--trilogy-orange)] mt-2">Action: 3–8% discount</p>
                  </div>
                  <div className="rounded-lg border-2 border-[var(--trilogy-teal)]/40 bg-[var(--trilogy-teal)]/5 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-5 w-5 text-[var(--trilogy-teal)]" />
                      <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Premium Driver</h5>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)] leading-relaxed">
                      Strong leasing velocity · filling faster than peers · Revenue Target AI Rate below competitor average · high occupancy · premium unit attributes
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
                  For each candidate rate, the system estimates how likely the unit is to lease by December 31 and projects the revenue that lease would generate. A discount that pushes the sale probability high enough can produce more total revenue than holding the current rate — even though the rate itself is lower.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="bg-white rounded border border-gray-200 p-3">
                    <h6 className="font-medium text-[var(--trilogy-dark-blue)] mb-1">Sale probability inputs</h6>
                    <p className="text-xs text-[var(--trilogy-grey)]">Base weekly lease rate comes from recent move-ins in the rent roll (fallback: room type → service line → campus → 10%/week). Price changes, days-vacant staleness, campus occupancy, competitor position, and unit attributes all adjust that base probability up or down.</p>
                  </div>
                  <div className="bg-white rounded border border-gray-200 p-3">
                    <h6 className="font-medium text-[var(--trilogy-dark-blue)] mb-1">Expected revenue</h6>
                    <p className="text-xs text-[var(--trilogy-grey)]">Expected revenue = sale probability × candidate rate × months remaining after the expected move-in date. The candidate with the highest expected revenue wins — provided it clears the minimum improvement threshold.</p>
                  </div>
                </div>
              </div>

              {/* Step 4 */}
              <div>
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] text-lg mb-3">Step 4 — Best Candidate Selection</h4>
                <p className="text-sm mb-3">All scored candidates are compared. The one with the highest expected revenue is selected — but only if it improves on the existing Revenue Target AI Rate by at least 0.5%. If no candidate clears that bar, the existing Revenue Target AI Rate is kept unchanged.</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="bg-[var(--trilogy-orange)]/5 rounded border border-[var(--trilogy-orange)]/30 p-3">
                    <p className="font-medium text-[var(--trilogy-dark-blue)] mb-1">Volume Driver</p>
                    <p className="text-xs text-[var(--trilogy-grey)]">Discount selected if expected revenue improves by ≥ 0.5% over the existing Revenue Target AI Rate.</p>
                  </div>
                  <div className="bg-[var(--trilogy-teal)]/5 rounded border border-[var(--trilogy-teal)]/30 p-3">
                    <p className="font-medium text-[var(--trilogy-dark-blue)] mb-1">Premium Driver</p>
                    <p className="text-xs text-[var(--trilogy-grey)]">Increase selected if revenue improves, or if exit-rate value rises and sale probability drops by less than 15 percentage points.</p>
                  </div>
                  <div className="bg-gray-50 rounded border border-gray-200 p-3">
                    <p className="font-medium text-[var(--trilogy-dark-blue)] mb-1">Neutral / No improvement</p>
                    <p className="text-xs text-[var(--trilogy-grey)]">±1% only if it clears the 0.5% threshold. If nothing improves, the existing Revenue Target AI Rate passes through unchanged.</p>
                  </div>
                </div>
              </div>

              {/* Worked example */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-1 flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-[var(--trilogy-teal)]" />
                  Worked Example — Volume Driver
                </h4>
                <p className="text-xs text-[var(--trilogy-grey)]/70 mb-4 italic">
                  Illustrative values. Sunrise Gardens · AL · 7 months remaining · campus 6% behind revenue target
                </p>
                <div className="space-y-3">
                  {/* Unit context */}
                  <div className="bg-white rounded border border-gray-200 p-3">
                    <p className="text-xs font-medium text-[var(--trilogy-dark-blue)] mb-2">Unit context</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs text-[var(--trilogy-grey)]">
                      <div>Rev Target AI Rate: <strong className="text-[var(--trilogy-dark-blue)]">$4,800/mo</strong></div>
                      <div>Vacant: <strong className="text-[var(--trilogy-dark-blue)]">45 days</strong></div>
                      <div>Competitor median: <strong className="text-[var(--trilogy-dark-blue)]">$4,200/mo</strong></div>
                      <div>Occupancy: <strong className="text-[var(--trilogy-dark-blue)]">81%</strong></div>
                    </div>
                  </div>
                  {/* Steps 1-2 inline */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-white rounded border border-[var(--trilogy-orange)]/30 p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-xs font-bold text-white bg-[var(--trilogy-orange)] px-2 py-0.5 rounded">Step 1</span>
                        <span className="text-xs font-medium text-[var(--trilogy-dark-blue)]">Urgency Score</span>
                      </div>
                      <p className="font-mono text-xs text-[var(--trilogy-grey)]">|6| ÷ (7 × 2.0) = <strong className="text-[var(--trilogy-dark-blue)]">0.43</strong> — moderate</p>
                    </div>
                    <div className="bg-white rounded border border-[var(--trilogy-orange)]/30 p-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-xs font-bold text-white bg-[var(--trilogy-orange)] px-2 py-0.5 rounded">Step 2</span>
                        <span className="text-xs font-medium text-[var(--trilogy-dark-blue)]">Classification → Volume Driver</span>
                      </div>
                      <p className="text-xs text-[var(--trilogy-grey)]">Moderate urgency · Revenue Target AI Rate 14% above competitor median · vacant 25 days over campus average · low occupancy → <strong>discount candidates at 3–8% generated</strong></p>
                    </div>
                  </div>
                  {/* Step 3 table */}
                  <div className="bg-white rounded border border-[var(--trilogy-orange)]/30 p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-xs font-bold text-white bg-[var(--trilogy-orange)] px-2 py-0.5 rounded">Step 3</span>
                      <span className="text-xs font-medium text-[var(--trilogy-dark-blue)]">Expected Revenue Scoring</span>
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-1 text-[var(--trilogy-dark-blue)]">Candidate</th>
                          <th className="text-left py-1 text-[var(--trilogy-dark-blue)]">Rate</th>
                          <th className="text-left py-1 text-[var(--trilogy-dark-blue)]">Sale prob by Dec</th>
                          <th className="text-left py-1 text-[var(--trilogy-dark-blue)]">Expected revenue</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-gray-100">
                          <td className="py-1.5 text-[var(--trilogy-grey)]">No change</td>
                          <td className="py-1.5">$4,800</td>
                          <td className="py-1.5">81%</td>
                          <td className="py-1.5">$9,200</td>
                        </tr>
                        <tr className="border-b border-gray-100">
                          <td className="py-1.5 text-[var(--trilogy-grey)]">−3%</td>
                          <td className="py-1.5">$4,656</td>
                          <td className="py-1.5">95%</td>
                          <td className="py-1.5">$18,700</td>
                        </tr>
                        <tr className="border-b border-gray-100 bg-[var(--trilogy-teal)]/5">
                          <td className="py-1.5 font-semibold text-[var(--trilogy-teal)]">−5% ✓ selected</td>
                          <td className="py-1.5 font-semibold">$4,560</td>
                          <td className="py-1.5 font-semibold">97%</td>
                          <td className="py-1.5 font-semibold text-[var(--trilogy-teal)]">$19,600</td>
                        </tr>
                        <tr>
                          <td className="py-1.5 text-[var(--trilogy-grey)]">−8%</td>
                          <td className="py-1.5">$4,416</td>
                          <td className="py-1.5">97%</td>
                          <td className="py-1.5">$19,200</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="text-xs text-[var(--trilogy-grey)]/70 mt-2">
                      At $4,800, the unit is priced above the market and unlikely to lease quickly — most of the year passes before a tenant moves in, leaving little time to generate revenue. At −5% ($4,560) the lease probability jumps to 97%, locking in revenue across most of the remaining months. The −8% rate has a similar probability but the lower rate isn't offset by the tiny additional probability gain.
                    </p>
                  </div>
                  {/* Step 4 result */}
                  <div className="bg-[var(--trilogy-teal)]/5 rounded border border-[var(--trilogy-teal)]/30 p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-xs font-bold text-white bg-[var(--trilogy-teal)] px-2 py-0.5 rounded">Step 4</span>
                      <span className="text-xs font-medium text-[var(--trilogy-dark-blue)]">Selection</span>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)]">
                      The −5% candidate ($4,560) produces the highest expected revenue at $19,600 — a 113% improvement over no change ($9,200). This far exceeds the 0.5% minimum threshold.{" "}
                      <strong className="text-[var(--trilogy-teal)]">Final Revenue Target AI Rate: $4,560/mo.</strong>
                    </p>
                  </div>
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
                Final safety layer — applies to both the Rules Rate path and the Revenue Target AI Rate path
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                Guardrails are the last step in both pricing paths. They enforce hard business boundaries regardless of what the Modulo engine, AI Pricing Engine, Rule Designer rules, or Revenue Target Strategy produce. No recommendation ever leaves these boundaries.
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
                  <strong>Rules Rate:</strong> The Rules Rate engine calculates a deterministic rate using six weighted pricing signals — Occupancy Pressure, Days Vacant Decay, Seasonality, Competitor Positioning, Market Conditions, and Demand Signals — applied to the unit's current street rate. That street rate already reflects the room's physical attributes, so attribute quality is embedded in the starting base, not applied afterward.
                </li>
                <li className="pl-2">
                  <strong>Rule Designer:</strong> Operator-defined rules modify the Rules Rate only. They apply after the Rules Rate engine, before Guardrails, and stack in priority order. They do not affect the Revenue Target AI Rate.
                </li>
                <li className="pl-2">
                  <strong>Revenue Target AI Rate:</strong> The AI Pricing Engine independently calculates a second recommendation using GPT-5-generated weights based on the current portfolio snapshot. An ML learning loop refines these weights over time using adoption and move-in outcome data.
                </li>
                <li className="pl-2">
                  <strong>Revenue Target Strategy:</strong> For vacant units with an active revenue growth target, the strategy layer evaluates whether the Revenue Target AI Rate should be preserved, discounted to accelerate leasing, or increased to improve exit-rate value — choosing only the option with the highest expected revenue by year-end. Occupied units pass through unchanged. This layer applies to the Revenue Target AI Rate only.
                </li>
                <li className="pl-2">
                  <strong>Guardrails:</strong> Both final recommendations — the Rules Rate and the Revenue Target AI Rate — are clamped by Guardrails before being stored or displayed. No recommendation can exceed configured increase or decrease limits, regardless of what the algorithm or AI produces.
                </li>
                <li className="pl-2">
                  <strong>Operator decision:</strong> Operators see both the Rules Rate and the Revenue Target AI Rate side-by-side and decide which rate to adopt, when, and at what frequency. The system never forces a change.
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

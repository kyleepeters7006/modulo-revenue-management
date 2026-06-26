import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Calculator,
  Target,
  ChevronRight,
  TrendingUp,
  Clock,
  Home,
  Users,
  BarChart3,
  Activity,
  Shield,
  Sparkles,
  GitBranch,
  SlidersHorizontal,
  Zap,
  Layers,
  ArrowDown,
  Lock,
  Plus,
  PieChart,
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
          <a href="#rules-rate" className="text-[var(--trilogy-teal)] hover:underline">Rules Rate</a>
          <span>·</span>
          <a href="#rule-designer" className="text-[var(--trilogy-teal)] hover:underline">Rule Designer</a>
          <span>·</span>
          <a href="#rule-exclusivity" className="text-[var(--trilogy-teal)] hover:underline">Exclusivity</a>
          <span>·</span>
          <a href="#ai-suggestions" className="text-[var(--trilogy-teal)] hover:underline">AI Rule Suggestions</a>
          <span>·</span>
          <a href="#elasticity" className="text-[var(--trilogy-teal)] hover:underline">Elasticity &amp; Revenue Impact</a>
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
                Modulo produces a single proposed rate for each unit — the <strong className="text-[var(--trilogy-dark-blue)]">Rules Rate</strong>. It is fully rules-driven and completely auditable. Starting from the unit's base street rate, Modulo applies the adjustment rules you author in the <strong>Rule Designer</strong>, then clamps the result with <strong>Guardrails</strong>. The rate you see is always traceable to a specific rule.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-lg border border-[var(--trilogy-teal)]/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calculator className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">How the Rules Rate is built</h4>
                  </div>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Begins with the unit's base / street rate</li>
                    <li>Adjustment rules from the Rule Designer apply in priority order</li>
                    <li>Guardrails (min/max, care-level rates) clamp the result</li>
                    <li>Deterministic and fully auditable — the same inputs always produce the same rate</li>
                  </ul>
                </div>
                <div className="bg-white rounded-lg border border-[var(--trilogy-dark-blue)]/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                    <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">Where the rules come from</h4>
                  </div>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Author rules directly in natural language ("Ask AI") or structured IF / THEN logic</li>
                    <li>Accept AI rule suggestions generated from revenue growth targets</li>
                    <li>Every proposed change is evaluated with price elasticity</li>
                    <li>Revenue impact and days-to-sell are shown before you commit</li>
                  </ul>
                </div>
              </div>

              <div className="bg-white/70 rounded-lg border border-[var(--trilogy-grey)]/20 p-4 text-sm">
                <strong className="text-[var(--trilogy-dark-blue)]">Key rule:</strong> If no adjustment rule applies to a unit, there is <strong>no proposed rate</strong> for that unit — Modulo leaves it blank rather than inventing one. A unit only receives a Rules Rate when at least one rule matches it.
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
                Every unit follows one straightforward path. The base rate flows through your adjustment rules, then through guardrails, and arrives at a final Rules Rate. Units with no matching rule simply exit the pipeline without a proposed rate.
              </p>

              <div className="max-w-md mx-auto">
                <div className="text-center mb-3">
                  <span className="inline-flex items-center gap-1.5 bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal)] font-semibold text-sm px-3 py-1 rounded-full border border-[var(--trilogy-teal)]/30">
                    <Calculator className="h-4 w-4" /> Rules Rate Path
                  </span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  {[
                    { label: "Base / Street Rate", sub: "the unit's current published rate" },
                    { label: "Rule Matching", sub: "find adjustment rules whose conditions match this unit" },
                    { label: "Apply Adjustments", sub: "exclusive (priority winner) or additive (stack)" },
                    { label: "Guardrails", sub: "min / max constraints, care-level rates" },
                    { label: "Rules Rate", sub: "final proposed rate — or none if no rule matched", highlight: true },
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

              <div className="bg-gray-50 rounded-lg p-3 text-sm text-[var(--trilogy-grey)] flex items-start gap-2">
                <Zap className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                <span>
                  There is no separate weighted-signal engine and no separate AI rate. <strong className="text-[var(--trilogy-dark-blue)]">Rules are the only mechanism</strong> that moves a rate away from its base. This keeps every recommendation transparent: each unit's rate traces back to the exact rules that fired.
                </span>
              </div>
            </CardContent>
          </Card>

          {/* ── 3. RULES RATE CALCULATION ────────────────────────────────────── */}
          <Card id="rules-rate" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Calculator className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Rules Rate Calculation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                The Rules Rate is deterministic. It is the base rate after the matching adjustment rules have been applied and guardrails have clamped the result. Because every step is an explicit rule, the same inputs always produce the same output — and every rate is fully auditable.
              </p>

              {/* Formula */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">How it's computed</h4>
                <div className="font-mono text-sm bg-white p-3 rounded border border-gray-200">
                  Rules Rate = Guardrails( Base Rate + matching rule adjustments )
                </div>
                <p className="text-sm mt-2">
                  Adjustments can be a percentage change, a fixed-dollar change, an absolute set-to value, or a discount applied / removed. Each matching rule modifies the running rate in priority order.
                </p>
                <p className="text-sm mt-1 text-[var(--trilogy-grey)]/80">
                  The <strong>Base Rate</strong> is the unit's current street rate, which already incorporates any room attribute premiums or discounts for that specific unit. Room attributes are part of the starting base, not a separate step.
                </p>
              </div>

              {/* No-rule behavior */}
              <div className="bg-amber-50 rounded-lg p-4 border border-amber-200/60">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-2 flex items-center gap-2">
                  <Lock className="h-4 w-4 text-amber-500" />
                  When no rule applies
                </h4>
                <p className="text-sm">
                  If no adjustment rule matches a unit, Modulo does <strong>not</strong> propose a rate for it — the proposed rate is left empty (null). Modulo never falls back to an automatic or weighted calculation. To price a unit, author or accept a rule that covers it.
                </p>
              </div>

              {/* Room attributes note */}
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-[var(--trilogy-grey)] flex items-start gap-2">
                <Home className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                <span>
                  <strong className="text-[var(--trilogy-dark-blue)]">Room attributes</strong> (location within building, unit size, view quality, renovation status, amenity level)
                  are reflected in the base rate the calculation starts from — the unit's current street rate, which already incorporates premiums or discounts for that room's specific features.
                  You can update a unit's attribute ratings directly from the <strong className="text-[var(--trilogy-dark-blue)]">Room Attributes</strong> page.
                  When a rating changes (for example, upgrading a unit from B to A view quality), the recalculated attributed rate flows into the next calculation cycle automatically.
                </span>
              </div>
            </CardContent>
          </Card>

          {/* ── 4. RULE DESIGNER ─────────────────────────────────────────────── */}
          <Card id="rule-designer" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Sparkles className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Rule Designer
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
                The single place where pricing adjustments are authored
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                The Rule Designer lets operators create pricing rules two ways: in plain English using <strong className="text-[var(--trilogy-dark-blue)]">Ask AI</strong>, or with the <strong className="text-[var(--trilogy-dark-blue)]">Structured Builder</strong> using IF / THEN logic. For example, <em>"Reduce vacant AL rates by $100 after 30 days vacant."</em> Natural-language rules are parsed by AI into structured conditions, so both methods produce the same auditable rule format.
              </p>

              {/* Two authoring modes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-[var(--trilogy-teal)]/30 bg-[var(--trilogy-teal)]/5 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Ask AI (natural language)</h5>
                  </div>
                  <p className="text-sm">
                    Type a rule the way you'd say it out loud. AI translates the sentence into structured conditions and an action, shows you the parsed result for review, and lets you adjust before saving. Ideal for quick, expressive rules.
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--trilogy-dark-blue)]/30 bg-[var(--trilogy-dark-blue)]/5 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <SlidersHorizontal className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                    <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Structured Builder (IF / THEN)</h5>
                  </div>
                  <p className="text-sm">
                    Compose conditions explicitly — pick a metric, an operator, a value, and an optional time period — then choose the action. Precise control for complex or compound rules, with the same outcome as a parsed natural-language rule.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Conditions */}
                <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-4">
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-[var(--trilogy-teal)]" />
                    Conditions (the IF)
                  </h4>
                  <p className="text-sm mb-2">A condition combines a metric, an operator (=, ≠, &gt;, &lt;, ≥, ≤, between), a value, and an optional time period. Available metrics include:</p>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Campus, service-line, or room-type occupancy</li>
                    <li>Vacant units and days vacant</li>
                    <li>Competitor rates and street-to-comp variance</li>
                    <li>Season / time of year</li>
                    <li>Inquiry and tour volume</li>
                    <li><strong className="text-[var(--trilogy-dark-blue)]">Revenue growth target</strong> (new)</li>
                    <li><strong className="text-[var(--trilogy-dark-blue)]">Price elasticity</strong> (new)</li>
                    <li><strong className="text-[var(--trilogy-dark-blue)]">Days-to-sell</strong> — before / after / change (new)</li>
                  </ul>
                </div>

                {/* Actions */}
                <div className="bg-[var(--trilogy-dark-blue)]/5 rounded-lg p-4">
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3 flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-[var(--trilogy-dark-blue)]" />
                    Actions (the THEN)
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Increase / Decrease rate</p><p>Adjust by a percentage or a fixed dollar amount.</p></div>
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Set rate</p><p>Set the unit to a specific absolute rate.</p></div>
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Apply / Remove discount</p><p>Add or clear a discount on the running rate.</p></div>
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Caps &amp; min / max</p><p>Constrain the adjustment so the result stays within a floor or ceiling.</p></div>
                    <div><p className="font-medium text-[var(--trilogy-dark-blue)]">Scope</p><ul className="list-disc list-inside mt-1 space-y-0.5"><li>Portfolio-wide</li><li>Location-specific</li><li>Service-line-specific</li><li>Location + service line</li></ul></div>
                  </div>
                </div>
              </div>

              {/* Stacking example */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">Rule Application Example</h4>
                <p className="text-sm mb-3">
                  When rules stack, each additive rule receives the rate produced by the previous step — adjustments compound rather than conflict. Guardrails clamp the final result.
                </p>
                <div className="font-mono text-xs bg-white p-3 rounded border border-gray-200 space-y-1">
                  <p>Base Rate: $4,500</p>
                  <p>Rule 1 (priority 10) — +5% AL all vacant → $4,500 × 1.05 = <strong>$4,725</strong></p>
                  <p>Rule 2 (additive) — −$100 after 30 days vacant → $4,725 − $100 = <strong>$4,625</strong></p>
                  <p className="text-[var(--trilogy-teal)] mt-1">Final Rules Rate (after guardrails): $4,625</p>
                </div>
                <p className="text-xs text-[var(--trilogy-grey)]/70 mt-2">
                  The <code className="bg-white rounded px-1 border border-gray-200">applied_rule_name</code> column records each rule that fired so operators can audit exactly which rules affected each unit.
                  To configure rules, navigate to <strong>Pricing Controls → Rule Designer</strong>, type a rule with Ask AI or use the Structured Builder, preview its impact, then save. Rules can be toggled on/off without deletion.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ── 4b. RULE EXCLUSIVITY ─────────────────────────────────────────── */}
          <Card id="rule-exclusivity" className="bg-white/95 backdrop-blur border-amber-200/60">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Lock className="h-6 w-6 text-amber-500" />
                Rule Exclusivity &amp; Priority
              </CardTitle>
              <p className="text-sm text-amber-600 font-medium mt-1">
                One rule per unit by default — stacking is opt-in per rule
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                By default every Rule Designer rule is <strong className="text-[var(--trilogy-dark-blue)]">exclusive</strong>: it claims a unit and no other exclusive rule will also apply to that same unit. Active exclusive rules are ordered by priority — the highest-priority matching rule wins. Subsequent exclusive rules skip any unit already claimed by a higher-priority rule.
              </p>
              <p>
                Any rule can be switched to <strong className="text-[var(--trilogy-dark-blue)]">additive</strong> mode ("<em>Apply in addition to other rules</em>" checkbox in the Rule Designer). An additive rule always runs on top of whatever an exclusive rule already set — it stacks, regardless of priority order. Guardrails clamp the result no matter how many rules stacked.
              </p>

              {/* Visual comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Lock className="h-5 w-5 text-amber-600" />
                    <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Exclusive (default)</h5>
                    <span className="text-xs font-bold bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">#1, #2… priority badge</span>
                  </div>
                  <ul className="text-sm space-y-1.5 list-disc list-inside">
                    <li>Claims matching units on first run</li>
                    <li>Later exclusive rules skip claimed units</li>
                    <li>Priority order = amber number badge in the Rule card</li>
                    <li>Use for mutually-exclusive pricing tiers (e.g. "Vacant AL standard" vs "Vacant AL long-stay")</li>
                  </ul>
                  <div className="mt-3 font-mono text-xs bg-white rounded border border-amber-200 p-2 space-y-1">
                    <p className="text-amber-700 font-semibold">Example — unit vacant 45 days, AL:</p>
                    <p>Rule #1 (exclusive): vacant AL &gt; 30 days → −$150 → <strong>$4,350</strong></p>
                    <p className="text-gray-400">Rule #2 (exclusive): vacant AL → +5% <span className="italic">skipped — unit already claimed</span></p>
                  </div>
                </div>

                <div className="rounded-lg border-2 border-teal-300 bg-teal-50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Plus className="h-5 w-5 text-teal-600" />
                    <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Additive (stacks)</h5>
                    <span className="text-xs font-bold bg-teal-200 text-teal-900 px-2 py-0.5 rounded-full">teal "stacks" badge</span>
                  </div>
                  <ul className="text-sm space-y-1.5 list-disc list-inside">
                    <li>Always applies on top of any exclusive result</li>
                    <li>Never skipped due to exclusivity</li>
                    <li>Multiple additive rules all run on the same unit</li>
                    <li>Use for cross-cutting adjustments (e.g. "Summer premium: +$50 all vacant units")</li>
                  </ul>
                  <div className="mt-3 font-mono text-xs bg-white rounded border border-teal-200 p-2 space-y-1">
                    <p className="text-teal-700 font-semibold">Example — same unit as above:</p>
                    <p>Rule #1 (exclusive): → $4,350</p>
                    <p>Summer bonus (additive): +$50 → <strong className="text-teal-700">$4,400</strong></p>
                  </div>
                </div>
              </div>

              {/* Priority table */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3">How Priority Is Assigned</h4>
                <p className="text-sm mb-3">
                  Active exclusive rules are numbered in the order they were created (oldest = highest priority = #1). You can change the effective priority by toggling rules off and on — a rule that was toggled off and back on moves to the end of the priority list.
                </p>
                <div className="font-mono text-xs bg-white p-3 rounded border border-gray-200 space-y-1">
                  <p className="text-[var(--trilogy-teal)] font-semibold">Priority execution order (oldest-first):</p>
                  <p>#1 — "Long-stay AL vacant" (exclusive) → applies to units vacant ≥ 30 days</p>
                  <p>#2 — "Standard AL vacant" (exclusive) → applies to any remaining AL vacant not claimed by #1</p>
                  <p className="text-teal-600">+ "Summer seasonal" (additive, stacks) → applies to ALL matched units regardless</p>
                </div>
                <p className="text-xs text-[var(--trilogy-grey)]/70 mt-2">
                  The <strong>Rate Card explanation dialog</strong> shows each rule's exclusivity mode inline (amber badge for exclusive, teal badge for stacks) so operators can see exactly why a rule was applied or skipped for a given unit.
                </p>
              </div>

              {/* Bubble Map */}
              <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-4 border border-[var(--trilogy-teal)]/20 flex items-start gap-3">
                <PieChart className="h-5 w-5 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-1">Bubble Map — Visual Portfolio Impact</h4>
                  <p className="text-sm">
                    The <strong>Bubble Map</strong> button (teal, in the Rules card header on Pricing Controls) opens a visual overview of every active rule as a circle. Circle size scales with the number of affected units. Dots inside each circle represent individual units. Exclusive rules show a dashed ring and a priority number; additive rules show a solid ring. Hover any circle for name, affected campuses, and monthly / annual impact.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── 5. AI RULE SUGGESTIONS FROM REVENUE GROWTH TARGETS ───────────── */}
          <Card id="ai-suggestions" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Target className="h-6 w-6 text-[var(--trilogy-dark-blue)]" />
                AI Rule Suggestions from Revenue Growth Targets
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-dark-blue)] font-medium mt-1">
                Turn a revenue goal into reviewable adjustment rules
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                On <strong>Pricing Controls</strong>, set a <strong className="text-[var(--trilogy-dark-blue)]">target annual revenue growth %</strong> for a campus + service line. Modulo analyzes the portfolio and generates a set of <strong>suggested rules</strong> designed to move toward that target. You review each one and <strong>Accept</strong> or <strong>Deny</strong> it. Accepted suggestions become ordinary adjustment rules in the Rule Designer — the same rules that drive the Rules Rate. This replaces any previous automatically-computed AI rate.
              </p>

              {/* Pipeline */}
              <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-4 border border-[var(--trilogy-teal)]/20">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-3 text-sm uppercase tracking-wide">
                  From Target to Rule
                </h4>
                <div className="flex flex-col md:flex-row gap-2 items-center text-sm flex-wrap">
                  {[
                    { label: "Set Growth Target", sub: "annual % per campus + service line" },
                    { label: "Generate Suggestions", sub: "candidate rules with impact" },
                    { label: "Review Each", sub: "intent, detail, units, revenue" },
                    { label: "Accept / Deny", sub: "your decision" },
                    { label: "Becomes a Rule", sub: "added to Rule Designer" },
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

              {/* What each suggestion shows */}
              <div>
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] text-lg mb-3">What each suggestion shows</h4>
                <p className="text-sm mb-3">Every suggested rule is presented with the context you need to make a confident decision:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="bg-white rounded border border-gray-200 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="h-4 w-4 text-[var(--trilogy-teal)]" />
                      <h6 className="font-medium text-[var(--trilogy-dark-blue)]">Intent &amp; detail</h6>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)]">A plain-language statement of what the rule does and why it helps reach the target.</p>
                  </div>
                  <div className="bg-white rounded border border-gray-200 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="h-4 w-4 text-[var(--trilogy-teal)]" />
                      <h6 className="font-medium text-[var(--trilogy-dark-blue)]">Units impacted</h6>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)]">How many units the rule would touch and which campuses / service lines they belong to.</p>
                  </div>
                  <div className="bg-white rounded border border-gray-200 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <TrendingUp className="h-4 w-4 text-[var(--trilogy-teal)]" />
                      <h6 className="font-medium text-[var(--trilogy-dark-blue)]">Monthly / annual revenue impact</h6>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)]">The projected change in revenue if the rule is accepted, both monthly and annualized.</p>
                  </div>
                  <div className="bg-white rounded border border-gray-200 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Activity className="h-4 w-4 text-[var(--trilogy-teal)]" />
                      <h6 className="font-medium text-[var(--trilogy-dark-blue)]">Elasticity</h6>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)]">The price-elasticity assumption behind the projection, so you can see how sensitive demand is to the change.</p>
                  </div>
                </div>
              </div>

              <div className="bg-[var(--trilogy-dark-blue)]/5 rounded-lg p-3 border border-[var(--trilogy-dark-blue)]/20 text-sm flex items-start gap-2">
                <Target className="h-4 w-4 text-[var(--trilogy-dark-blue)] mt-0.5 flex-shrink-0" />
                <span>
                  Suggestions are <strong className="text-[var(--trilogy-dark-blue)]">recommendations, not actions</strong>. Nothing changes until you Accept. Once accepted, a suggestion behaves exactly like a hand-authored rule — it participates in exclusivity, priority, and guardrails, and you can edit or toggle it any time.
                </span>
              </div>
            </CardContent>
          </Card>

          {/* ── 6. ELASTICITY & REVENUE IMPACT ──────────────────────────────── */}
          <Card id="elasticity" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <TrendingUp className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Elasticity-Based Revenue Impact
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
                How proposed changes are scored before you commit
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                Whenever a rule proposes a rate change, Modulo evaluates it with <strong className="text-[var(--trilogy-dark-blue)]">price elasticity</strong> — a measure of how sensitive demand is to price. A lower rate typically sells faster; a higher rate typically sells slower. Elasticity translates a price change into an estimated change in how long the unit takes to lease, and from there into a revenue projection.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Days-to-sell: before / after / change</h5>
                  </div>
                  <p className="text-sm">
                    For each proposed change, Modulo estimates the unit's days-to-sell at the current rate and at the proposed rate, then reports the difference. A discount that meaningfully shortens days-to-sell can collect more months of rent over the year.
                  </p>
                </div>
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Monthly &amp; annual revenue impact</h5>
                  </div>
                  <p className="text-sm">
                    The estimated days-to-sell change is combined with the new rate to project the monthly and annual revenue impact of the change — so a lower rate that leases faster can still come out ahead of holding a higher, slower-leasing rate.
                  </p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-3 text-sm text-[var(--trilogy-grey)] flex items-start gap-2">
                <Activity className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                <span>
                  These elasticity outputs — days-to-sell before/after/change and the monthly / annual revenue impact — are surfaced in <strong className="text-[var(--trilogy-dark-blue)]">Reference Data</strong>, alongside the rules and rates, so operators can verify the trade-off behind every proposed change. Elasticity, days-to-sell, and revenue growth target are also available as <strong>conditions</strong> in the Rule Designer.
                </span>
              </div>
            </CardContent>
          </Card>

          {/* ── 7. GUARDRAILS ────────────────────────────────────────────────── */}
          <Card id="guardrails" className="bg-white/95 backdrop-blur border-[var(--trilogy-teal)]/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Shield className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Guardrails &amp; Care-Level Rates
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
                Final safety layer — clamps the Rules Rate after every rule has been applied
              </p>
            </CardHeader>
            <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
              <p>
                Guardrails are the last step in the pricing path. They enforce hard business boundaries regardless of what the adjustment rules produced. No Rules Rate ever leaves these boundaries.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Min / Max Rate Constraints</h5>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Hard floor and ceiling on the final rate</li>
                    <li>Maximum single increase / decrease limits</li>
                    <li>Prevents excessive price swings between calculation cycles</li>
                  </ul>
                </div>
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Care-Level Rates</h5>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Level 2 care rates and similar care-level pricing remain in effect</li>
                    <li>Applied alongside the min / max constraints</li>
                    <li>Ensures care-driven pricing is honored regardless of rules</li>
                  </ul>
                </div>
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">Competitor Variance Limit</h5>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Caps how far a rate can deviate from competitor median</li>
                    <li>Applies independently of the percentage change limits</li>
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
                  <strong>Rules Rate:</strong> Modulo produces one proposed rate per unit. It is the base / street rate after the matching Rule Designer adjustments and guardrails. There is no weighted-signal engine and no separate AI rate — rules are the only thing that moves a rate.
                </li>
                <li className="pl-2">
                  <strong>No rule, no rate:</strong> If no adjustment rule matches a unit, there is no proposed rate (null). Modulo never falls back to an automatic calculation.
                </li>
                <li className="pl-2">
                  <strong>Rule Designer:</strong> Author rules in natural language with Ask AI or with the Structured Builder using IF / THEN conditions (occupancy, vacant units, days vacant, competitor rates, street-to-comp variance, season, inquiry/tour volume, revenue growth target, price elasticity, days-to-sell) and actions (increase / decrease / set rate, apply / remove discount, caps, min / max).
                </li>
                <li className="pl-2">
                  <strong>Exclusivity &amp; priority:</strong> By default each rule is <em>exclusive</em> — the highest-priority matching rule wins and claims the unit. Any rule can be switched to <em>additive</em> to stack on top of the exclusive result.
                </li>
                <li className="pl-2">
                  <strong>AI rule suggestions:</strong> Set a target annual revenue growth % per campus + service line on Pricing Controls, and Modulo generates suggested rules (intent, detail, units impacted, monthly / annual revenue impact, elasticity). Accept or Deny each one; accepted suggestions become adjustment rules.
                </li>
                <li className="pl-2">
                  <strong>Elasticity-based impact:</strong> Proposed changes are scored with price elasticity to estimate days-to-sell before / after / change and the monthly / annual revenue impact, all shown in Reference Data.
                </li>
                <li className="pl-2">
                  <strong>Guardrails &amp; care-level rates:</strong> The final Rules Rate is clamped by min / max constraints, competitor variance limits, and care-level rates (e.g. Level 2) before it is stored or displayed.
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

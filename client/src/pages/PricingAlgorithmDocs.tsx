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

        <div className="text-center mb-10">
          <h1 className="text-4xl font-light text-[var(--trilogy-dark-blue)] mb-4">
            Pricing Algorithm Documentation
          </h1>
          <p className="text-xl text-[var(--trilogy-grey)]">
            How Modulo calculates, tracks, and improves rates over time
          </p>
        </div>

        {/* Jump links */}
        <div className="text-center -mt-4 mb-10 text-sm text-[var(--trilogy-grey)]/70 flex flex-wrap justify-center gap-x-2 gap-y-1">
          <span>Jump to:</span>
          {[
            ["#overview", "Overview"],
            ["#workflow", "Workflow"],
            ["#rule-designer", "Rule Designer"],
            ["#rule-exclusivity", "Exclusivity"],
            ["#ai-suggestions", "AI Suggestions"],
            ["#revenue-measurement", "Revenue Measurement"],
            ["#elasticity", "Elasticity"],
            ["#guardrails", "Guardrails"],
            ["#summary", "Summary"],
          ].map(([href, label], i, arr) => (
            <span key={href} className="flex items-center gap-x-2">
              <a href={href} className="text-[var(--trilogy-teal)] hover:underline">{label}</a>
              {i < arr.length - 1 && <span>·</span>}
            </span>
          ))}
        </div>

        <div className="space-y-8">

          {/* ── 1. OVERVIEW ─────────────────────────────────────────────── */}
          <Card id="overview" className="bg-gradient-to-r from-[var(--trilogy-teal)]/10 to-[var(--trilogy-dark-blue)]/10 border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <GitBranch className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-[var(--trilogy-grey)]">
              <p>
                Modulo produces one proposed rate per unit — the <strong className="text-[var(--trilogy-dark-blue)]">Rules Rate</strong>. It starts from the unit's current street rate, applies the adjustment rules you author in the <strong>Rule Designer</strong>, then clamps the result with <strong>Guardrails</strong>. Every rate traces back to a specific rule.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-lg border border-[var(--trilogy-teal)]/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Calculator className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">How the rate is built</h4>
                  </div>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Starts with the unit's street rate</li>
                    <li>Adjustment rules apply in priority order</li>
                    <li>Guardrails clamp the result</li>
                    <li>Deterministic — same inputs, same rate, always auditable</li>
                  </ul>
                </div>
                <div className="bg-white rounded-lg border border-[var(--trilogy-dark-blue)]/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                    <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">How performance is tracked</h4>
                  </div>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>T3 (trailing 3-month) revenue measured before and after each rule</li>
                    <li>Elasticity predictions compared to actual days-to-sell</li>
                    <li>Rule Performance table shows impact by strategy group</li>
                    <li>Active rules without history appear as projected rows</li>
                  </ul>
                </div>
              </div>

              <div className="bg-white/70 rounded-lg border border-[var(--trilogy-grey)]/20 p-3 text-sm">
                <strong className="text-[var(--trilogy-dark-blue)]">Key rule:</strong> If no adjustment rule matches a unit, Modulo leaves the proposed rate blank — it never invents one. A unit is only priced when a rule applies to it.
              </div>
            </CardContent>
          </Card>

          {/* ── 2. WORKFLOW ─────────────────────────────────────────────── */}
          <Card id="workflow" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Layers className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Complete Pricing Workflow
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-[var(--trilogy-grey)]">
              <p className="text-sm">
                Every unit follows one path. The base rate flows through adjustment rules, then guardrails, arriving at a final Rules Rate. Units with no matching rule exit the pipeline without a proposed rate.
              </p>

              <div className="max-w-md mx-auto">
                <div className="flex flex-col items-center gap-1">
                  {[
                    { label: "Base / Street Rate", sub: "unit's current published rate" },
                    { label: "Rule Matching", sub: "find rules whose conditions match this unit" },
                    { label: "Apply Adjustments", sub: "exclusive (priority winner) or additive (stack)" },
                    { label: "Guardrails", sub: "min / max, competitor variance, care-level rates" },
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
                  <strong className="text-[var(--trilogy-dark-blue)]">Rules are the only mechanism</strong> that moves a rate. There is no separate weighted-signal engine. Each unit's rate traces back to the exact rules that fired.
                </span>
              </div>
            </CardContent>
          </Card>

          {/* ── 4. RULE DESIGNER ────────────────────────────────────────── */}
          <Card id="rule-designer" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Sparkles className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Rule Designer
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
                Where all pricing adjustments are authored
              </p>
            </CardHeader>
            <CardContent className="space-y-5 text-[var(--trilogy-grey)]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-[var(--trilogy-teal)]/30 bg-[var(--trilogy-teal)]/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Ask AI</h5>
                  </div>
                  <p className="text-sm">Type a rule in plain English — <em>"Reduce vacant AL rates by $100 after 30 days."</em> AI parses it into structured conditions for review before saving.</p>
                </div>
                <div className="rounded-lg border border-[var(--trilogy-dark-blue)]/30 bg-[var(--trilogy-dark-blue)]/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <SlidersHorizontal className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                    <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Structured Builder</h5>
                  </div>
                  <p className="text-sm">Build conditions explicitly — metric, operator, value, time period — then choose the action. Same result as a parsed natural-language rule.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-4">
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-2 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-[var(--trilogy-teal)]" />
                    Conditions (the IF)
                  </h4>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Campus / service-line / room-type occupancy</li>
                    <li>Vacant units and days vacant</li>
                    <li>Competitor rates and street-to-comp variance</li>
                    <li>Season / time of year</li>
                    <li>Inquiry and tour volume</li>
                    <li>Revenue growth target</li>
                    <li>Price elasticity</li>
                    <li>Days-to-sell before / after / change</li>
                  </ul>
                </div>
                <div className="bg-[var(--trilogy-dark-blue)]/5 rounded-lg p-4">
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-2 flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-[var(--trilogy-dark-blue)]" />
                    Actions (the THEN)
                  </h4>
                  <ul className="text-sm space-y-1 list-disc list-inside">
                    <li>Increase / Decrease by % or fixed $</li>
                    <li>Set to an absolute rate</li>
                    <li>Apply / Remove a discount</li>
                    <li>Min / max caps on the adjustment</li>
                    <li>Scope: portfolio, location, service line, or both</li>
                  </ul>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-2">Stacking example</h4>
                <div className="font-mono text-xs bg-white p-3 rounded border border-gray-200 space-y-1">
                  <p>Base Rate: $4,500</p>
                  <p>Rule 1 (exclusive, priority #1) — +5% vacant AL → $4,500 × 1.05 = <strong>$4,725</strong></p>
                  <p>Rule 2 (additive) — −$100 after 30 days vacant → $4,725 − $100 = <strong>$4,625</strong></p>
                  <p className="text-[var(--trilogy-teal)] mt-1">Rules Rate (after guardrails): $4,625</p>
                </div>
                <p className="text-xs text-[var(--trilogy-grey)]/70 mt-2">
                  The <code className="bg-white rounded px-1 border border-gray-200">applied_rule_name</code> column records every rule that fired so you can audit exactly what affected each unit.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ── 5. RULE EXCLUSIVITY ─────────────────────────────────────── */}
          <Card id="rule-exclusivity" className="bg-white/95 backdrop-blur border-amber-200/60">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Lock className="h-6 w-6 text-amber-500" />
                Rule Exclusivity &amp; Priority
              </CardTitle>
              <p className="text-sm text-amber-600 font-medium mt-1">
                One rule per unit by default — stacking is opt-in
              </p>
            </CardHeader>
            <CardContent className="space-y-5 text-[var(--trilogy-grey)]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Lock className="h-5 w-5 text-amber-600" />
                    <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Exclusive (default)</h5>
                  </div>
                  <p className="text-sm mb-3">Claims matching units. Later exclusive rules skip any unit already claimed by a higher-priority rule. Priority = creation order (oldest = #1).</p>
                  <div className="font-mono text-xs bg-white rounded border border-amber-200 p-2 space-y-1">
                    <p className="text-amber-700 font-semibold">Unit: vacant AL, 45 days</p>
                    <p>Rule #1 (exclusive): &gt;30d → −$150 → <strong>$4,350</strong></p>
                    <p className="text-gray-400">Rule #2 (exclusive): +5% <span className="italic">skipped</span></p>
                  </div>
                </div>

                <div className="rounded-lg border-2 border-teal-300 bg-teal-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Plus className="h-5 w-5 text-teal-600" />
                    <h5 className="font-semibold text-[var(--trilogy-dark-blue)]">Additive (stacks)</h5>
                  </div>
                  <p className="text-sm mb-3">Always runs on top of the exclusive result — never skipped. Multiple additive rules all apply to the same unit.</p>
                  <div className="font-mono text-xs bg-white rounded border border-teal-200 p-2 space-y-1">
                    <p className="text-teal-700 font-semibold">Same unit:</p>
                    <p>Rule #1 (exclusive): → $4,350</p>
                    <p>Summer bonus (additive): +$50 → <strong className="text-teal-700">$4,400</strong></p>
                  </div>
                </div>
              </div>

              <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-4 border border-[var(--trilogy-teal)]/20 flex items-start gap-3">
                <PieChart className="h-5 w-5 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-1">Bubble Map</h4>
                  <p className="text-sm">
                    The <strong>Bubble Map</strong> (Pricing Controls → Rules card header) shows every active rule as a circle scaled by affected units. Exclusive rules show a dashed ring and priority number; additive rules show a solid ring. Hover for campus count and monthly / annual impact.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── 6. AI RULE SUGGESTIONS ──────────────────────────────────── */}
          <Card id="ai-suggestions" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Target className="h-6 w-6 text-[var(--trilogy-dark-blue)]" />
                AI Rule Suggestions
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-dark-blue)] font-medium mt-1">
                Turn a revenue goal into reviewable adjustment rules
              </p>
            </CardHeader>
            <CardContent className="space-y-5 text-[var(--trilogy-grey)]">
              <p>
                Set a <strong className="text-[var(--trilogy-dark-blue)]">target annual revenue growth %</strong> per campus + service line on Pricing Controls. Modulo analyzes the portfolio and generates suggested rules designed to reach that target. You review each one and <strong>Accept</strong>, <strong>Edit</strong>, or <strong>Deny</strong>. Accepted suggestions become ordinary adjustment rules in the Rule Designer — identical to hand-authored rules.
              </p>

              <p>
                <strong className="text-[var(--trilogy-dark-blue)]">The generator learns from your decisions.</strong> Every Accept, Edit, and Deny is logged as a training signal. On each new run, the AI reviews your recent decision history — favoring the styles, triggers, and adjustment magnitudes you have accepted, and steering away from rule logic you have denied. The more you use it, the better calibrated the suggestions become to your portfolio strategy.
              </p>

              <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-4 border border-[var(--trilogy-teal)]/20">
                <div className="flex flex-col md:flex-row gap-2 items-center text-sm flex-wrap">
                  {[
                    { label: "Set Growth Target", sub: "% per campus + service line" },
                    { label: "Generate Suggestions", sub: "AI proposes candidate rules" },
                    { label: "Review Each", sub: "intent, units, revenue, elasticity" },
                    { label: "Accept / Edit / Deny", sub: "your decision" },
                    { label: "Becomes a Rule", sub: "added to Rule Designer" },
                    { label: "AI Learns", sub: "decisions calibrate future runs" },
                  ].map((step, i, arr) => (
                    <div key={i} className="flex items-center gap-2 flex-shrink-0">
                      <div className="bg-white rounded-lg border border-[var(--trilogy-teal)]/30 px-3 py-2 text-center">
                        <div className="font-medium text-[var(--trilogy-dark-blue)] whitespace-nowrap">{step.label}</div>
                        <div className="text-[var(--trilogy-grey)]/70 text-xs mt-0.5 whitespace-nowrap">{step.sub}</div>
                      </div>
                      {i < arr.length - 1 && <ChevronRight className="h-4 w-4 text-[var(--trilogy-teal)] hidden md:block flex-shrink-0" />}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {[
                  { icon: Sparkles, label: "Intent & detail", desc: "What the rule does and why it helps reach the target" },
                  { icon: Users, label: "Units impacted", desc: "Count, campuses, and service lines affected" },
                  { icon: TrendingUp, label: "Revenue impact", desc: "Monthly and annual projection if accepted" },
                  { icon: Activity, label: "Elasticity", desc: "Price-sensitivity assumption behind the projection" },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="bg-white rounded border border-gray-200 p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon className="h-4 w-4 text-[var(--trilogy-teal)]" />
                      <h6 className="font-medium text-[var(--trilogy-dark-blue)] text-xs">{label}</h6>
                    </div>
                    <p className="text-xs text-[var(--trilogy-grey)]">{desc}</p>
                  </div>
                ))}
              </div>

              <div className="bg-[var(--trilogy-dark-blue)]/5 rounded-lg p-3 border border-[var(--trilogy-dark-blue)]/20 text-sm flex items-start gap-2">
                <Target className="h-4 w-4 text-[var(--trilogy-dark-blue)] mt-0.5 flex-shrink-0" />
                <span>Nothing changes until you Accept. Accepted suggestions participate in exclusivity, priority, and guardrails exactly like any other rule — and can be edited or toggled any time. Denied suggestions won't be re-proposed: the learning loop remembers what you rejected.</span>
              </div>
            </CardContent>
          </Card>

          {/* ── 7. REVENUE MEASUREMENT (T3) ─────────────────────────────── */}
          <Card id="revenue-measurement" className="bg-white/95 backdrop-blur border-[var(--trilogy-teal)]/30">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <BarChart3 className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Revenue Growth Measurement
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
                T3 trailing 3-month before-and-after tracking
              </p>
            </CardHeader>
            <CardContent className="space-y-5 text-[var(--trilogy-grey)]">
              <p>
                Modulo measures the real-world impact of each pricing rule using a <strong className="text-[var(--trilogy-dark-blue)]">trailing 3-month (T3) window</strong> — the three months of move-in data immediately before and after a rule is applied. This anchors performance measurement to actual leasing outcomes rather than projected rates alone.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-8 w-8 rounded-full bg-[var(--trilogy-grey)]/10 flex items-center justify-center text-sm font-bold text-[var(--trilogy-dark-blue)]">T−</div>
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Before</h5>
                  </div>
                  <p className="text-sm">The T3 average move-in rate and monthly revenue for the three months <em>before</em> the rule's effective date. This is the baseline.</p>
                </div>
                <div className="bg-[var(--trilogy-teal)]/5 rounded-lg border border-[var(--trilogy-teal)]/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-8 w-8 rounded-full bg-[var(--trilogy-teal)]/20 flex items-center justify-center text-sm font-bold text-[var(--trilogy-teal)]">T+</div>
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">After</h5>
                  </div>
                  <p className="text-sm">The T3 average move-in rate and monthly revenue for the three months <em>after</em> the rule began applying to units. Updated as new move-ins occur.</p>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Delta</h5>
                  </div>
                  <p className="text-sm">T+ minus T− gives the observed revenue growth (or contraction) attributable to the rule, in both monthly and annualized terms.</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-2">Rule Performance table</h4>
                <p className="text-sm mb-3">
                  The <strong>Rule Performance</strong> section on Pricing Analytics groups rules into four strategy categories and shows T3-based outcomes for each:
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {[
                    { label: "Above Market / Hold", color: "bg-blue-50 border-blue-200 text-blue-800" },
                    { label: "Below Market / Push", color: "bg-teal-50 border-teal-200 text-teal-800" },
                    { label: "Concession (AL)", color: "bg-amber-50 border-amber-200 text-amber-800" },
                    { label: "Concession (SL)", color: "bg-purple-50 border-purple-200 text-purple-800" },
                  ].map(({ label, color }) => (
                    <div key={label} className={`rounded border p-2 text-center font-medium ${color}`}>{label}</div>
                  ))}
                </div>
                <p className="text-xs text-[var(--trilogy-grey)]/70 mt-3">
                  Each row shows units impacted, units sold, average days-to-sell vs. expected, and monthly / annual revenue impact. Rules with no applied history yet appear as <strong>projected</strong> rows — impact is estimated from current qualifying units so every active strategy is always visible.
                </p>
              </div>

              <div className="bg-[var(--trilogy-teal)]/5 rounded-lg p-3 border border-[var(--trilogy-teal)]/20 text-sm flex items-start gap-2">
                <Activity className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                <span>
                  <strong className="text-[var(--trilogy-dark-blue)]">Win Rate</strong> tracks how often a unit that received a Rules Rate was subsequently leased at or above that rate — closing the loop between recommended rate and actual outcome.
                </span>
              </div>
            </CardContent>
          </Card>

          {/* ── 8. ELASTICITY ───────────────────────────────────────────── */}
          <Card id="elasticity" className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <TrendingUp className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Elasticity &amp; Revenue Impact
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
                How proposed changes are scored — and how predictions improve over time
              </p>
            </CardHeader>
            <CardContent className="space-y-5 text-[var(--trilogy-grey)]">
              <p>
                Whenever a rule proposes a rate change, Modulo scores it with <strong className="text-[var(--trilogy-dark-blue)]">price elasticity</strong> — how sensitive demand is to price. A lower rate typically sells faster; a higher rate typically sells slower. Elasticity translates a price change into an estimated change in days-to-sell, then into a revenue projection.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Days-to-sell</h5>
                  </div>
                  <p className="text-sm">Estimated at the current rate and at the proposed rate. The <em>change</em> determines whether a discount pays back through faster leasing.</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Revenue impact</h5>
                  </div>
                  <p className="text-sm">The days-to-sell change combined with the new rate projects monthly and annual revenue — a lower rate that leases faster can still come out ahead.</p>
                </div>
                <div className="border border-gray-200 rounded-lg p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)]">Elasticity tracking</h5>
                  </div>
                  <p className="text-sm">Predicted days-to-sell is compared to actual days-to-sell after move-in. Over time this feedback tightens the elasticity model for each service line and location.</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold text-[var(--trilogy-dark-blue)] mb-2">Where elasticity data appears</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  <div className="flex items-start gap-2">
                    <ChevronRight className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                    <span><strong className="text-[var(--trilogy-dark-blue)]">Reference Data</strong> — elasticity coefficient, expected and actual days-to-sell per service line</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ChevronRight className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                    <span><strong className="text-[var(--trilogy-dark-blue)]">Rule Performance</strong> — days faster / slower than expected column tracks prediction accuracy</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ChevronRight className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                    <span><strong className="text-[var(--trilogy-dark-blue)]">AI Suggestions</strong> — elasticity assumption shown per suggestion so you can weigh sensitivity</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ChevronRight className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 flex-shrink-0" />
                    <span><strong className="text-[var(--trilogy-dark-blue)]">Rule Designer</strong> — price elasticity available as a trigger condition in rule authoring</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── 9. GUARDRAILS ───────────────────────────────────────────── */}
          <Card id="guardrails" className="bg-white/95 backdrop-blur border-[var(--trilogy-teal)]/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Shield className="h-6 w-6 text-[var(--trilogy-teal)]" />
                Guardrails &amp; Care-Level Rates
              </CardTitle>
              <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
                Final safety layer — clamps the Rules Rate after all adjustments
              </p>
            </CardHeader>
            <CardContent className="text-[var(--trilogy-grey)]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  {
                    title: "Min / Max Constraints",
                    items: ["Hard floor and ceiling on the final rate", "Maximum single increase / decrease limits", "Prevents large swings between calculation cycles"],
                  },
                  {
                    title: "Care-Level Rates",
                    items: ["Level 2 care rates remain in effect", "Applied alongside min / max constraints", "Care-driven pricing is always honored"],
                  },
                  {
                    title: "Competitor Variance Limit",
                    items: ["Caps deviation from competitor median", "Applies independently of % change limits"],
                  },
                  {
                    title: "Configuration Scope",
                    items: ["Portfolio, location, or service-line level", "Seasonal adjustment overrides available"],
                  },
                ].map(({ title, items }) => (
                  <div key={title} className="border border-gray-200 rounded-lg p-4 bg-white">
                    <h5 className="font-medium text-[var(--trilogy-dark-blue)] mb-2">{title}</h5>
                    <ul className="text-sm space-y-1 list-disc list-inside">
                      {items.map(item => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── 10. SUMMARY ─────────────────────────────────────────────── */}
          <Card id="summary" className="bg-gradient-to-r from-[var(--trilogy-dark-blue)]/10 to-[var(--trilogy-teal)]/10 border-[var(--trilogy-grey)]/20">
            <CardHeader>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)]">
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[var(--trilogy-grey)]">
              <ol className="space-y-2.5 list-decimal list-inside text-sm">
                {[
                  <><strong>Rules Rate:</strong> One proposed rate per unit — base / street rate after matching Rule Designer adjustments and guardrails. Rules are the only mechanism that moves a rate.</>,
                  <><strong>No rule, no rate:</strong> Modulo never proposes a rate for an unmatched unit. The field stays blank until a rule covers it.</>,
                  <><strong>Rule Designer:</strong> Author rules with Ask AI (natural language) or the Structured Builder (IF conditions → THEN action). Conditions include occupancy, vacancy, competitor variance, season, inquiries, elasticity, days-to-sell, and revenue growth targets.</>,
                  <><strong>Exclusivity &amp; priority:</strong> Exclusive rules claim units in priority order; additive rules stack on top regardless of priority. Guardrails clamp the result.</>,
                  <><strong>AI suggestions:</strong> Set a target revenue growth % per campus + service line; Modulo generates candidate rules with intent, units, revenue impact, and elasticity. Accept → becomes a rule.</>,
                  <><strong>T3 revenue measurement:</strong> Rule performance is tracked with trailing 3-month move-in data — T3 before vs T3 after — giving an observed delta attributable to each rule. Active rules with no history yet appear as projected rows.</>,
                  <><strong>Elasticity tracking:</strong> Predicted days-to-sell is compared to actual post-move-in outcomes, tightening the model over time. Elasticity data surfaces in Reference Data, Rule Performance, AI Suggestions, and as a rule condition.</>,
                  <><strong>Guardrails:</strong> Min / max, competitor variance limits, and care-level rates clamp the final Rules Rate before it is stored or displayed.</>,
                ].map((item, i) => (
                  <li key={i} className="pl-2">{item}</li>
                ))}
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

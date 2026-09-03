import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Target, TrendingUp, BarChart3, Shield,
  GitBranch, SlidersHorizontal, Users, ArrowRight, CheckCircle2,
  Database, Calculator, Gauge, LockKeyhole,
} from "lucide-react";
import { useLocation } from "wouter";

const Section = ({
  id, icon: Icon, color = "text-[var(--trilogy-teal)]", title, sub, children,
}: {
  id: string; icon: any; color?: string; title: string; sub?: string; children: React.ReactNode;
}) => (
  <Card id={id} className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
    <CardHeader className="pb-2">
      <CardTitle className="text-xl font-semibold text-[var(--trilogy-dark-blue)] flex items-center gap-2.5">
        <Icon className={`h-5 w-5 shrink-0 ${color}`} />
        {title}
      </CardTitle>
      {sub && <p className="text-sm text-[var(--trilogy-grey)] mt-0.5 pl-7">{sub}</p>}
    </CardHeader>
    <CardContent className="text-[var(--trilogy-grey)] text-sm leading-relaxed pl-7 space-y-2">
      {children}
    </CardContent>
  </Card>
);

export default function PricingAlgorithmDocs() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-[var(--dashboard-bg)] p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto">

        <div className="mb-6">
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

        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--trilogy-dark-blue)] to-[var(--trilogy-teal-dark)] p-6 sm:p-8 text-white shadow-lg mb-8">
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-[var(--trilogy-teal-light)]/20 blur-3xl" aria-hidden="true" />
          <div className="relative">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--trilogy-teal-light)] mb-3">Inside the engine</p>
            <h1 className="text-3xl sm:text-4xl font-light tracking-tight mb-3">
              How Modulo prices a unit
            </h1>
            <p className="text-white/75 max-w-3xl leading-relaxed">
              A transparent sequence: gather the right signals, qualify the right units, apply the approved pricing logic, protect the result with guardrails, and measure what happened.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              {["Unit-level", "Operator-controlled", "Measured over time"].map(label => (
                <span key={label} className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5">{label}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Jump links */}
        <div className="mb-8 text-sm text-[var(--trilogy-grey)]/60 flex flex-wrap gap-x-3 gap-y-1">
          {[
            ["#overview", "Overview"],
            ["#rate-flow", "Rate flow"],
            ["#rule-designer", "Rule Designer"],
            ["#examples", "Examples"],
            ["#ai-suggestions", "AI Suggestions"],
            ["#measurement", "Measurement"],
            ["#elasticity", "Elasticity"],
            ["#guardrails", "Guardrails"],
            ["#inhouse-increases", "In-House Increases"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="text-[var(--trilogy-teal)] hover:underline">{label}</a>
          ))}
        </div>

        <div className="space-y-4">

          <Section id="overview" icon={GitBranch} title="Overview">
            <p>
              Modulo starts with the unit's current <strong className="text-[var(--trilogy-dark-blue)]">Street Rate</strong>, then evaluates the approved rules that apply to that unit's campus, service line, room type, and attributes. The result is a traceable Rules Rate. Guardrails keep that result inside the boundaries your team configured.
            </p>
            <p>
              AI does not silently change a rate. It reads occupancy, market conditions, and community performance to propose a rule aimed at your growth target; an operator reviews the conditions, scope, affected units, and projected impact before the rule becomes active.
            </p>
          </Section>

          <Section id="rate-flow" icon={ArrowRight} title="The rate flow"
            sub="Five steps from raw signal to an explainable decision">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 not-prose">
              {[
                { icon: Database, number: "01", title: "Gather", body: "Occupancy, rates, vacancy, competitor, and outcome data." },
                { icon: SlidersHorizontal, number: "02", title: "Qualify", body: "Find the units and groups that match the rule scope." },
                { icon: Calculator, number: "03", title: "Calculate", body: "Apply the approved $ or % action to Street Rate." },
                { icon: Gauge, number: "04", title: "Protect", body: "Apply floors, ceilings, and movement limits." },
                { icon: CheckCircle2, number: "05", title: "Explain", body: "Show the winning rule, impact, and outcome." },
              ].map(({ icon: Icon, number, title, body }) => (
                <div key={number} className="rounded-xl border border-[var(--trilogy-teal)]/20 bg-[var(--trilogy-teal)]/5 p-3">
                  <div className="flex items-center justify-between mb-3">
                    <Icon className="h-4 w-4 text-[var(--trilogy-teal)]" />
                    <span className="text-[10px] font-bold tracking-widest text-[var(--trilogy-teal)]">{number}</span>
                  </div>
                  <p className="font-semibold text-[var(--trilogy-dark-blue)] text-sm">{title}</p>
                  <p className="text-xs text-[var(--trilogy-grey)] mt-1 leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-[var(--trilogy-dark-blue)]/15 bg-[var(--trilogy-dark-blue)]/[0.04] p-4 mt-4">
              <p className="text-sm font-medium text-[var(--trilogy-dark-blue)]">The mental model</p>
              <p className="font-mono text-xs sm:text-sm text-[var(--trilogy-teal)] mt-2 break-words">
                Street Rate → eligible rule adjustments → Rules Rate → guardrails → final rate
              </p>
            </div>
          </Section>

          <Section id="rule-designer" icon={SlidersHorizontal} title="Rule Designer"
            sub="Where all pricing adjustments are authored">
            <p>
              Write rules in plain English — <em>"Reduce vacant AL rates by $100 after 30 days"</em> — and AI parses them into structured conditions, or use the Structured Builder directly. Triggers include occupancy, vacancy, days vacant, competitor variance, season, inquiries, elasticity, days-to-sell, and revenue target. Actions are % or $ adjustments, absolute overrides, and discounts, scoped to portfolio, location, or service line.
            </p>
            <p>
              A condition is evaluated against the same scope used by the rule. For example, a rule scoped to AL at one campus does not use a portfolio-wide occupancy value to change every AL unit. Room attributes such as location, size, view, renovation, and amenity ratings can narrow the match further, including explicitly matching a blank rating.
            </p>
          </Section>

          <Section id="examples" icon={Calculator} title="Worked examples"
            sub="What the calculation looks like with real numbers">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-[var(--trilogy-teal)]/25 bg-[var(--trilogy-teal)]/5 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="rounded-full bg-[var(--trilogy-teal)] text-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Example 01</span>
                  <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">Vacancy rule</h3>
                </div>
                <p className="text-sm text-[var(--trilogy-grey)] leading-relaxed">
                  An AL Studio has a <strong className="text-[var(--trilogy-dark-blue)]">$4,000 Street Rate</strong> and has been vacant for 38 days. The approved rule says: “Reduce vacant AL rates by $100 after 30 days.”
                </p>
                <div className="mt-4 space-y-2 text-xs">
                  {[
                    ["Condition", "Vacant = yes AND Days Vacant > 30"],
                    ["Action", "$4,000 − $100"],
                    ["Rules Rate", "$3,900"],
                    ["Safety check", "If the floor is $3,850, $3,900 remains valid"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex gap-3 border-t border-[var(--trilogy-teal)]/15 pt-2">
                      <span className="w-20 shrink-0 font-semibold text-[var(--trilogy-dark-blue)]">{label}</span>
                      <span className="text-[var(--trilogy-grey)]">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--trilogy-dark-blue)]/20 bg-white p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="rounded-full bg-[var(--trilogy-dark-blue)] text-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Example 02</span>
                  <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">Market-position rule</h3>
                </div>
                <p className="text-sm text-[var(--trilogy-grey)] leading-relaxed">
                  A Studio has a <strong className="text-[var(--trilogy-dark-blue)]">$4,000 Street Rate</strong> while the selected top-comp benchmark is $4,200. The rule says: “Increase rates by 3% when Street Rate is more than 5% below top comp.”
                </p>
                <div className="mt-4 space-y-2 text-xs">
                  {[
                    ["Variance", "($4,000 − $4,200) ÷ $4,200 = −4.8%"],
                    ["Condition", "−4.8% is not below −5%; rule does not fire"],
                    ["Result", "$4,000 remains the Rules Rate"],
                    ["Why it matters", "The benchmark and threshold are visible before approval"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex gap-3 border-t border-[var(--trilogy-dark-blue)]/10 pt-2">
                      <span className="w-20 shrink-0 font-semibold text-[var(--trilogy-dark-blue)]">{label}</span>
                      <span className="text-[var(--trilogy-grey)]">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-amber-500/25 bg-amber-50/70 p-4 text-xs text-amber-900">
              <strong>Important:</strong> examples are illustrative. The live result depends on the current unit data, rule scope, active rule priority, and configured guardrails.
            </div>
          </Section>

          <Section id="ai-suggestions" icon={Target} color="text-[var(--trilogy-dark-blue)]" title="AI Rule Suggestions"
            sub="Turn a revenue goal into reviewable adjustment rules">
            <p>
              Set a target annual revenue growth % per campus and service line. For example, a 4% target might produce one occupancy rule for a soft AL segment and one market-position rule for a high-demand segment rather than applying one blanket increase everywhere. Each proposal includes its intent, affected units, projected revenue impact, and elasticity assumption. <strong className="text-[var(--trilogy-dark-blue)]">Accept</strong>, <strong>Edit</strong>, or <strong>Deny</strong> each one — accepted suggestions become ordinary rules in the Rule Designer.
            </p>
            <p>
              The review step is the control point: confirm that the proposed units, scope, threshold, and financial impact match the strategy. Every decision is logged so future runs can favor the trigger styles and adjustment magnitudes your team actually accepts.
            </p>
          </Section>

          <Section id="measurement" icon={BarChart3} title="Revenue Growth Measurement"
            sub="Trailing 3-month before-and-after tracking">
            <p>
              Rule performance uses a <strong className="text-[var(--trilogy-dark-blue)]">T3 window</strong> — the three months of move-ins immediately before and after a rule goes live. T+ minus T− is the observed change in average move-in rate and monthly revenue. Rules with no history yet show as <strong>projected</strong>, estimated from current qualifying units. Win Rate tracks how often a unit leased at or above its proposed rate.
            </p>
            <div className="rounded-xl border border-[var(--trilogy-teal)]/20 bg-[var(--trilogy-teal)]/5 p-4 text-xs">
              <p className="font-semibold text-[var(--trilogy-dark-blue)] mb-1">Illustrative T3 readout</p>
              <p>If the before-period average move-in rate is $4,000 and the after-period average is $4,120, the observed change is +$120 per move-in. At 8 move-ins per month, that is approximately +$960 monthly, or +$11,520 annualized, before considering mix and census changes.</p>
            </div>
          </Section>

          <Section id="elasticity" icon={TrendingUp} title="Elasticity &amp; Revenue Impact"
            sub="How proposed changes are scored — and how predictions improve">
            <p>
              A proposed rate change is scored by its estimated effect on <strong className="text-[var(--trilogy-dark-blue)]">days-to-sell</strong>: lower rates are generally expected to lease faster, while higher rates may take longer. That shift plus the new rate projects monthly and annual revenue. Predictions are compared against actual outcomes, tightening the model per service line and location.
            </p>
            <p>
              For example, if a 5% increase is predicted to move days-to-sell from 24 to 26 days, the projected revenue calculation weighs the higher rate against the expected pace change instead of assuming every unit leases at the same speed.
            </p>
          </Section>

          <Section id="guardrails" icon={Shield} title="Guardrails"
            sub="Final safety layer — clamps the Rules Rate after all adjustments">
            <p>
              Guardrails set a hard floor and ceiling on the final rate, cap the largest single-cycle move, and limit deviation from the competitor median. Care-level rates are applied here and always honored. Configurable at portfolio, location, or service-line level, with optional seasonal overrides.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              {[
                ["Floor", "Prevents a recommendation from dropping below the configured minimum."],
                ["Ceiling", "Prevents a recommendation from exceeding the configured maximum."],
                ["Movement limit", "Stops an unusually large one-cycle change even when the rule is valid."],
              ].map(([title, body]) => (
                <div key={title} className="rounded-xl border border-[var(--trilogy-grey)]/20 bg-white p-3">
                  <div className="flex items-center gap-1.5 font-semibold text-[var(--trilogy-dark-blue)] mb-1">
                    <LockKeyhole className="h-3.5 w-3.5 text-[var(--trilogy-teal)]" />
                    {title}
                  </div>
                  <p>{body}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section id="inhouse-increases" icon={Users} title="Annual In-House Increases"
            sub="Plan resident rate increases to hit a year-over-year growth target">
            <p>
              The <strong className="text-[var(--trilogy-dark-blue)]">In-House Increases</strong> planner lets you set an annual realized-rate growth target and translate it into specific increases for every current private-pay resident. It solves two things jointly: a recommended street rate increase and a per-resident in-house increase, so neither lever is ignored.
            </p>
            <p>
              The solver simulates two groups over the next four quarters — existing residents (who receive the increase on the in-house effective date and turn over at the configured rate) and new move-ins (who enter at the updated street rate). Census is held constant. The weighted projection is compared against the same quarter a year earlier; the plan is feasible when every quarter clears the target.
            </p>
            <p>
              Each resident's increase is shaped by their headroom — the gap between their current rate and the street rate cap. An equalization setting (Low / Medium / High) controls how aggressively that headroom is used to spread increases toward residents who are furthest below street. Hard limits ensure no resident ever receives a rate cut, no rate is pushed above the street cap unless you explicitly allow it, and every increase stays within the minimum and maximum you set.
            </p>
            <p>
              Example: a resident paying $3,600 with a $4,000 street-rate cap has $400 of headroom. The planner may assign a $150 increase this cycle, while a resident already at $3,950 receives only the amount allowed by the configured equalization and maximum. The plan is solved across the population, not by applying the same dollar amount blindly to every resident.
            </p>
            <p>
              Every number carries a plain-language explanation. Infeasible plans — where the target cannot be reached within your guardrails — still return a best-effort result so you can see exactly which quarter falls short and by how much, what the binding constraint is, and what the smallest single change would be to close the gap.
            </p>
          </Section>

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

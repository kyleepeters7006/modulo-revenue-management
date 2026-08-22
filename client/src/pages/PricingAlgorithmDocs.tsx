import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Target, TrendingUp, BarChart3, Shield,
  GitBranch, SlidersHorizontal,
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
    <div className="min-h-screen bg-[var(--dashboard-bg)] p-6 md:p-8">
      <div className="max-w-2xl mx-auto">

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

        <div className="mb-8">
          <h1 className="text-3xl font-light text-[var(--trilogy-dark-blue)] mb-2">
            Pricing Algorithm
          </h1>
          <p className="text-[var(--trilogy-grey)]">
            How Modulo calculates, tracks, and improves rates over time
          </p>
        </div>

        {/* Jump links */}
        <div className="mb-8 text-sm text-[var(--trilogy-grey)]/60 flex flex-wrap gap-x-3 gap-y-1">
          {[
            ["#overview", "Overview"],
            ["#rule-designer", "Rule Designer"],
            ["#ai-suggestions", "AI Suggestions"],
            ["#measurement", "Measurement"],
            ["#elasticity", "Elasticity"],
            ["#guardrails", "Guardrails"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="text-[var(--trilogy-teal)] hover:underline">{label}</a>
          ))}
        </div>

        <div className="space-y-4">

          <Section id="overview" icon={GitBranch} title="Overview">
            <p>
              Modulo recommends a rate for every unit from the pricing rules your team puts in place. An <strong className="text-[var(--trilogy-dark-blue)]">AI rule generator</strong> reads occupancy, market conditions, and community performance to propose rules aimed at your growth target — you approve them before anything goes live. Active rules move rates up or down, and guardrails keep every result inside the boundaries you set.
            </p>
          </Section>

          <Section id="rule-designer" icon={SlidersHorizontal} title="Rule Designer"
            sub="Where all pricing adjustments are authored">
            <p>
              Write rules in plain English — <em>"Reduce vacant AL rates by $100 after 30 days"</em> — and AI parses them into structured conditions, or use the Structured Builder directly. Triggers include occupancy, vacancy, days vacant, competitor variance, season, inquiries, elasticity, days-to-sell, and revenue target. Actions are % or $ adjustments, absolute overrides, and discounts, scoped to portfolio, location, or service line.
            </p>
          </Section>

          <Section id="ai-suggestions" icon={Target} color="text-[var(--trilogy-dark-blue)]" title="AI Rule Suggestions"
            sub="Turn a revenue goal into reviewable adjustment rules">
            <p>
              Set a target annual revenue growth % per campus and service line. Modulo proposes rules with their intent, affected units, projected revenue impact, and elasticity assumption. <strong className="text-[var(--trilogy-dark-blue)]">Accept</strong>, <strong>Edit</strong>, or <strong>Deny</strong> each one — accepted suggestions become ordinary rules in the Rule Designer. Every decision is logged, so future runs calibrate to your strategy.
            </p>
          </Section>

          <Section id="measurement" icon={BarChart3} title="Revenue Growth Measurement"
            sub="Trailing 3-month before-and-after tracking">
            <p>
              Rule performance uses a <strong className="text-[var(--trilogy-dark-blue)]">T3 window</strong> — the three months of move-ins immediately before and after a rule goes live. T+ minus T− is the observed change in average move-in rate and monthly revenue. Rules with no history yet show as <strong>projected</strong>, estimated from current qualifying units. Win Rate tracks how often a unit leased at or above its proposed rate.
            </p>
          </Section>

          <Section id="elasticity" icon={TrendingUp} title="Elasticity &amp; Revenue Impact"
            sub="How proposed changes are scored — and how predictions improve">
            <p>
              A proposed rate change is scored by its estimated effect on <strong className="text-[var(--trilogy-dark-blue)]">days-to-sell</strong>: lower rates lease faster, higher rates slower. That shift plus the new rate projects monthly and annual revenue. Predictions are compared against actual outcomes, tightening the model per service line and location.
            </p>
          </Section>

          <Section id="guardrails" icon={Shield} title="Guardrails"
            sub="Final safety layer — clamps the Rules Rate after all adjustments">
            <p>
              Guardrails set a hard floor and ceiling on the final rate, cap the largest single-cycle move, and limit deviation from the competitor median. Care-level rates are applied here and always honored. Configurable at portfolio, location, or service-line level, with optional seasonal overrides.
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

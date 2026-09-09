import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Linkedin, FileText, ArrowLeft, BookOpen, ChevronRight,
  Sparkles, Brain, TrendingUp, Target, Activity, Wand2,
  SlidersHorizontal, BarChart3, Zap, CheckCircle2, ArrowRight,
  Database, Calculator, ShieldCheck,
} from "lucide-react";
import { useLocation } from "wouter";

export default function AboutUs() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-[var(--dashboard-bg)] p-4 sm:p-6 md:p-8">
      <div className="max-w-6xl mx-auto">

        {/* Back */}
        <div className="mb-8">
          <Button
            variant="outline"
            onClick={() => setLocation("/overview")}
            className="border-[var(--trilogy-grey)]/30 text-[var(--trilogy-grey)] hover:bg-[var(--trilogy-grey)]/10"
            data-testid="button-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>

        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl border border-[var(--trilogy-teal)]/20 bg-gradient-to-br from-white via-white to-[var(--trilogy-teal)]/10 shadow-sm mb-10">
          <div className="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-[var(--trilogy-teal)]/10 blur-3xl" aria-hidden="true" />
          <div className="relative grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 md:gap-10 items-center p-6 sm:p-8 md:p-10">
            <img
              src="/attached_assets/modulo_flat_blue_1786491120146.png"
              alt="Modulo Revenue Management"
              className="mx-auto object-contain rounded-3xl w-44 h-44 sm:w-52 sm:h-52 md:w-[220px] md:h-[220px]"
            />
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--trilogy-teal)]/25 bg-[var(--trilogy-teal)]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--trilogy-teal)] mb-4">
                <Sparkles className="h-3.5 w-3.5" />
                Operator-led revenue management
              </div>
              <h1 className="text-4xl sm:text-5xl font-light tracking-tight text-[var(--trilogy-dark-blue)] mb-4">
                About Modulo
              </h1>
              <p className="text-lg sm:text-xl leading-relaxed text-[var(--trilogy-grey)] max-w-3xl">
                Modulo turns the signals already inside a senior housing portfolio into pricing decisions people can understand, challenge, and trust.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-[var(--trilogy-dark-blue)]">
                {["Clear inputs", "Reviewable rules", "Measured outcomes"].map(label => (
                  <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white/80 border border-[var(--trilogy-dark-blue)]/10 px-3 py-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[var(--trilogy-teal)]" />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="relative grid grid-cols-1 sm:grid-cols-3 border-t border-[var(--trilogy-teal)]/15 bg-white/60">
            {[
              { value: "One view", label: "for market, occupancy, and rate signals" },
              { value: "Every unit", label: "gets a traceable pricing decision" },
              { value: "Your rules", label: "stay in control of the outcome" },
            ].map(({ value, label }, index) => (
              <div key={value} className={`px-6 py-4 ${index > 0 ? "border-t sm:border-t-0 sm:border-l border-[var(--trilogy-teal)]/15" : ""}`}>
                <p className="text-sm font-semibold text-[var(--trilogy-dark-blue)]">{value}</p>
                <p className="text-xs text-[var(--trilogy-grey)] mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Why Modulo */}
        <div className="mb-10">
          <div className="max-w-3xl mb-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--trilogy-teal)] mb-2">Why it exists</p>
            <h2 className="text-3xl font-light text-[var(--trilogy-dark-blue)] mb-2">Pricing is a decision, not a black box.</h2>
            <p className="text-[var(--trilogy-grey)] leading-relaxed">
              Senior housing pricing sits at the intersection of local market movement, unit-level detail, and operating judgment. Modulo brings those pieces together so teams can move with the market without losing the context behind every rate.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: Database, title: "See the full signal", body: "Occupancy, vacancy, in-house rates, competitor positioning, and resident outcomes are considered together instead of in separate spreadsheets." },
              { icon: Calculator, title: "Make the math explicit", body: "Rules show their conditions, action, scope, and expected impact. Teams can inspect the calculation before approving a change." },
              { icon: ShieldCheck, title: "Keep judgment in the loop", body: "Guardrails and operator review protect the portfolio. Automation handles repetition; people set the strategy." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-[var(--trilogy-grey)]/20 bg-white p-5 shadow-sm">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--trilogy-teal)]/10">
                  <Icon className="h-5 w-5 text-[var(--trilogy-teal)]" />
                </div>
                <h3 className="font-semibold text-[var(--trilogy-dark-blue)] mb-1.5">{title}</h3>
                <p className="text-sm leading-relaxed text-[var(--trilogy-grey)]">{body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── AI Rule Design ─────────────────────────────────────────────── */}
        <Card className="mb-8 border-[var(--trilogy-teal)]/30 bg-gradient-to-br from-[var(--trilogy-teal)]/5 to-white">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--trilogy-teal)] mb-2">
                Built into Pricing Controls
              </p>
              <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
                <Wand2 className="h-6 w-6 text-[var(--trilogy-teal)]" />
                AI Rule Generator
              </CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/pricing-controls?scrollTo=ai-generator")}
              className="border-[var(--trilogy-teal)] text-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/10 shrink-0"
              data-testid="button-try-ai-rule-generator"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Try the AI Rule Generator
            </Button>
          </CardHeader>
          <CardContent className="space-y-5 text-[var(--trilogy-grey)]">
            <p>
              Modulo includes a built-in <strong className="text-[var(--trilogy-dark-blue)]">AI Rule Generator</strong> that turns a pricing strategy into a reviewable rule. Describe what you want in plain English and the AI creates structured IF / THEN logic with conditions, action, and scope — ready for an operator to review before it ever touches a rate.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border border-[var(--trilogy-teal)]/30 bg-white p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Wand2 className="h-5 w-5 text-[var(--trilogy-teal)]" />
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">Natural Language Rules</h4>
                </div>
                <p className="text-sm">
                  Describe a rule in plain English — <em className="text-[var(--trilogy-dark-blue)]">"Reduce vacant AL rates by $100 after 30 days."</em> Modulo translates it into conditions, action, and scope for your review.
                </p>
              </div>
              <div className="rounded-lg border border-[var(--trilogy-dark-blue)]/20 bg-white p-4">
                <div className="flex items-center gap-2 mb-2">
                  <SlidersHorizontal className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">Structured Rule Builder</h4>
                </div>
                <p className="text-sm">
                  Build conditions explicitly — metric, operator, value, time window — then define the action. Every rule is fully auditable: operators can see exactly which factors moved each rate.
                </p>
              </div>
              <div className="rounded-lg border border-[var(--trilogy-teal)]/30 bg-white p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-5 w-5 text-[var(--trilogy-teal)]" />
                  <h4 className="font-semibold text-[var(--trilogy-dark-blue)]">Targeted Revenue Actions</h4>
                </div>
                <p className="text-sm">
                   Set a revenue-growth target and let AI propose targeted pricing rules. Review each suggestion's impact, then accept, edit, or deny it — the system learns from every decision.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-[var(--trilogy-grey)]/20 p-4">
              <p className="text-sm font-medium text-[var(--trilogy-dark-blue)] mb-2">Rules can trigger on any combination of:</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-[var(--trilogy-grey)]">
                {[
                  "Occupancy — campus, service line, or room type",
                  "Trailing occupancy trends — 3, 6, or 12 months",
                  "Vacant units / beds & days vacant",
                  "Total units / beds",
                  "Street rate to top competitor variance",
                   "Street rate to average competitor variance",
                  "In-house to street rate variance",
                  "Inquiry volume",
                  "Tour volume",
                  "SNF private pay mix",
                   "Room attributes: location, size, view, renovation, amenity",
                ].map(t => (
                  <div key={t} className="flex items-start gap-1.5">
                    <ChevronRight className="h-3 w-3 text-[var(--trilogy-teal)] mt-0.5 shrink-0" />
                    <span>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Security ────────────────────────────────────────────────────── */}
        <Card className="mb-8 border-[var(--trilogy-teal)]/25 bg-white/95 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-[var(--trilogy-teal)]" />
              Security
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-[var(--trilogy-grey)]">
            <p>
              Modulo uses account-based access with password verification and authenticator-app multi-factor authentication. New and existing users enroll with a time-based code and receive single-use recovery codes that are displayed once.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                ["Session protection", "Authenticated sessions use server-side storage, secure production cookie settings, expiration, rotation after sign-in, and revocation after account changes."],
                ["Access boundaries", "Accounts have explicit roles and each account is scoped to its client environment. Administrative and sensitive operations are checked on the server."],
                ["Request safeguards", "State-changing browser requests are checked for same-site origin or a session CSRF token. Responses include browser security headers."],
                ["Audit and data handling", "Sign-in, MFA, recovery, password, session, and authorization events are recorded with tenant context without storing passwords, codes, secrets, session tokens, or resident data in the event details."],
              ].map(([title, body]) => (
                <div key={title} className="rounded-lg border border-[var(--trilogy-grey)]/20 bg-gray-50 p-4">
                  <h3 className="font-semibold text-[var(--trilogy-dark-blue)] mb-1">{title}</h3>
                  <p className="text-xs">{body}</p>
                </div>
              ))}
            </div>
            <p className="text-xs">
              These are application controls implemented in Modulo. This page does not make certification, regulatory, infrastructure-encryption, or legal-compliance claims.
            </p>
          </CardContent>
        </Card>

        {/* ── Machine Learning ───────────────────────────────────────────── */}
        <Card className="mb-8 border-[var(--trilogy-dark-blue)]/20 bg-gradient-to-br from-[var(--trilogy-dark-blue)]/5 to-white">
          <CardHeader>
            <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
              <Brain className="h-6 w-6 text-[var(--trilogy-dark-blue)]" />
              A System That Learns
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 text-[var(--trilogy-grey)]">
            <p>
              Modulo's AI suggestion engine doesn't just generate rules — it improves every time an operator makes a decision. Each <strong className="text-[var(--trilogy-dark-blue)]">Accept, Edit, or Deny</strong> is logged as a training signal. On each new run, the model reviews your recent decision history, favoring the trigger styles and adjustment magnitudes you've accepted, and steering away from logic you've rejected. The more you use it, the more precisely it reflects your portfolio strategy.
            </p>

            <div className="bg-white rounded-lg border border-[var(--trilogy-dark-blue)]/20 p-4">
              <div className="flex flex-wrap gap-2 items-center text-sm">
                {[
                  { label: "Set Revenue Target", sub: "% per campus + SL" },
                  { label: "AI Generates Rules", sub: "calibrated to your history" },
                  { label: "Review Each", sub: "impact, units, elasticity" },
                  { label: "Accept / Edit / Deny", sub: "your decision" },
                  { label: "AI Learns", sub: "next run is better calibrated" },
                ].map((step, i, arr) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="bg-[var(--trilogy-dark-blue)]/5 rounded-lg border border-[var(--trilogy-dark-blue)]/20 px-3 py-2 text-center">
                      <div className="font-medium text-[var(--trilogy-dark-blue)] whitespace-nowrap text-xs">{step.label}</div>
                      <div className="text-[var(--trilogy-grey)]/70 text-[10px] mt-0.5 whitespace-nowrap">{step.sub}</div>
                    </div>
                    {i < arr.length - 1 && <ChevronRight className="h-4 w-4 text-[var(--trilogy-dark-blue)]/40 hidden md:block shrink-0" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-5 w-5 text-[var(--trilogy-teal)]" />
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] text-sm">Elasticity Tracking</h5>
                </div>
                <p className="text-xs">Predicted days-to-sell is compared to actual post-move-in outcomes, tightening the model for each service line and location over time.</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-5 w-5 text-[var(--trilogy-teal)]" />
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] text-sm">T3 Performance</h5>
                </div>
                <p className="text-xs">Revenue impact is measured with trailing 3-month move-in data — before and after each rule — anchoring results to actual leasing outcomes.</p>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Activity className="h-5 w-5 text-[var(--trilogy-teal)]" />
                  <h5 className="font-medium text-[var(--trilogy-dark-blue)] text-sm">Win Rate</h5>
                </div>
                <p className="text-xs">Tracks how often a unit leased at or above its proposed rate — closing the loop between AI recommendation and real-world outcome.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Operator Control ───────────────────────────────────────────── */}
        <Card className="mb-8 bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
          <CardHeader>
            <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
              <Target className="h-6 w-6 text-[var(--trilogy-teal)]" />
              AI That Operators Control
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-[var(--trilogy-grey)]">
            <p>
              Every rate Modulo proposes traces back to a specific rule. There are no black-box weights, no silent overrides. Operators can see exactly which conditions fired, which rule won, and what guardrail clamped the result — then accept, adjust, or override it at any time.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {[
                { icon: Zap, title: "Fully auditable", body: "Every proposed rate lists the rule that created it. Nothing is unexplained." },
                { icon: Target, title: "Nothing changes until you act", body: "Accepted suggestions and new rules only affect rates on the next calculation run." },
                { icon: Sparkles, title: "Natural language to structured logic", body: "AI translates plain English strategies into conditions you can inspect, edit, and version." },
                { icon: Brain, title: "Gets smarter with use", body: "The more Accepts, Edits, and Denies you log, the more accurately the AI reflects your philosophy." },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="flex items-start gap-3 bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <Icon className="h-4 w-4 text-[var(--trilogy-teal)] mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-[var(--trilogy-dark-blue)] text-sm">{title}</p>
                    <p className="text-xs text-[var(--trilogy-grey)] mt-0.5">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Algorithm deep dive ────────────────────────────────────────── */}
        <button
          onClick={() => setLocation("/pricing-algorithm")}
          className="w-full mb-8 text-left"
          data-testid="button-algorithm-docs"
        >
          <Card className="border-2 border-[var(--trilogy-teal)] bg-gradient-to-r from-[var(--trilogy-teal)]/10 to-[var(--trilogy-dark-blue)]/10 hover:from-[var(--trilogy-teal)]/20 hover:to-[var(--trilogy-dark-blue)]/20 transition-colors cursor-pointer">
            <CardContent className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-[var(--trilogy-teal)]/20 flex items-center justify-center shrink-0">
                  <BookOpen className="h-6 w-6 text-[var(--trilogy-teal)]" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-[var(--trilogy-teal)] mb-1">Deep Dive</p>
                  <h3 className="text-xl font-semibold text-[var(--trilogy-dark-blue)]">Pricing Algorithm Documentation</h3>
                   <p className="text-sm text-[var(--trilogy-grey)] mt-1">
                     How the pricing engine works · worked rule examples · AI suggestions · guardrails · revenue tracking
                  </p>
                </div>
              </div>
              <ChevronRight className="h-6 w-6 text-[var(--trilogy-teal)] shrink-0 ml-4" />
            </CardContent>
          </Card>
        </button>

        {/* ── Where the Name Comes From ──────────────────────────────────── */}
        <Card className="mb-8 bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
          <CardHeader>
            <CardTitle className="text-xl font-light text-[var(--trilogy-dark-blue)]">
              Where the Name Comes From
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[var(--trilogy-grey)]">
            <p>
              Modulo takes its name from the mathematical operator that represents what remains after division. In programming, it manages cycles to ensure nothing is lost. We apply this philosophy to senior housing pricing — capturing overlooked opportunities and untapped revenue that often gets left on the table.
            </p>
          </CardContent>
        </Card>

        {/* ── Leadership Team ────────────────────────────────────────────── */}
        <div className="mb-8">
          <h2 className="text-3xl font-light text-[var(--trilogy-dark-blue)] mb-6 text-center">
            Leadership Team
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                name: "Kyle Peters",
                title: "Vice President – Operations Finance",
                bio: "Kyle Peters is a finance and operations executive with nearly 20 years of experience in senior housing, healthcare, and structured finance. As VP of Operations Finance at Trilogy Health Services, he drives value-based care initiatives, portfolio optimization, and revenue management across 130+ campuses. He previously led pricing and analytics at Atria Senior Living. Kyle holds a B.S. in Finance from Rutgers and an MBA from Indiana University.",
                linkedin: "https://www.linkedin.com/in/kyleedmondpeters/",
                testid: "button-linkedin-kyle",
              },
              {
                name: "Irisel Johnston",
                title: "Chief Operating Officer",
                bio: "Irisel Johnston is an operations finance analyst at Trilogy Health Services with experience in financial planning, benefits management, and operational analytics. A Beta Alpha Psi Lifetime Member, she holds a B.S. in Finance with a minor in Economics from the University of Louisville.",
                linkedin: "https://www.linkedin.com/in/iriscel-jimenez-737311237/?locale=en",
                testid: "button-linkedin-irisel",
              },
            ].map(({ name, title, bio, linkedin, testid }) => (
              <Card key={name} className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
                <CardHeader>
                  <CardTitle className="text-xl font-medium text-[var(--trilogy-dark-blue)]">{name}</CardTitle>
                  <p className="text-sm text-[var(--trilogy-grey)]">{title}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-[var(--trilogy-grey)]">{bio}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(linkedin, "_blank")}
                    className="w-full border-[var(--trilogy-teal)] text-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/10"
                    data-testid={testid}
                  >
                    <Linkedin className="mr-2 h-4 w-4" />
                    Connect on LinkedIn
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* ── Presentation CTA ───────────────────────────────────────────── */}
        <div className="text-center">
          <Button
            onClick={() => window.open("/attached_assets/Revenue Mgmt Capabilities - Modulo_1756829257557.pptx", "_blank")}
            className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
            data-testid="button-presentation"
          >
            <FileText className="mr-2 h-4 w-4" />
            View Our Presentation
          </Button>
        </div>

      </div>
    </div>
  );
}

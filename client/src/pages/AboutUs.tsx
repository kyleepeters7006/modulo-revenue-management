import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Linkedin, FileText, Building2, ArrowLeft, BookOpen, Shield, SlidersHorizontal, CalendarClock, Zap, ArrowRightLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function AboutUs() {
  const [, setLocation] = useLocation();
  
  return (
    <div className="min-h-screen bg-[var(--dashboard-bg)] p-8">
      <div className="max-w-6xl mx-auto">
        {/* Back Button */}
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
        
        {/* Header with Logo */}
        <div className="text-center mb-12">
          {/* Modulo Logo */}
          <div className="flex justify-center mb-6">
            <img 
              src="/attached_assets/image_1756172904290.png" 
              alt="Modulo Revenue Management" 
              className="h-48 object-contain"
              style={{ 
                objectPosition: 'center center',
                display: 'block'
              }}
            />
          </div>
          
          <h1 className="text-4xl font-light text-[var(--trilogy-dark-blue)] mb-4">
            About Modulo
          </h1>
          <p className="text-xl text-[var(--trilogy-grey)]">
            Revolutionizing Senior Housing Revenue Management
          </p>
        </div>

        {/* Where the Name Comes From */}
        <Card className="mb-8 bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
          <CardHeader>
            <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)]">
              Where the Name Comes From
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[var(--trilogy-grey)]">
            <p>
              Modulo takes its name from the mathematical operator that represents what remains after division. In programming, it manages cycles to ensure nothing is lost. We apply this philosophy to senior housing pricing—capturing overlooked opportunities and untapped revenue that often gets left on the table.
            </p>
          </CardContent>
        </Card>

        {/* Our Story and Promise */}
        <Card className="mb-8 bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
          <CardHeader>
            <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)]">
              Our Story and Promise
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-[var(--trilogy-grey)]">
            <p>
              Modulo brings together decades of experience in senior housing operations, technology, and revenue management. Our team has worked with leading operators to understand the unique challenges of pricing optimization in this complex market.
            </p>
            <p>
              Our mission: help senior housing communities optimize revenue while maintaining high occupancy and delivering exceptional value to residents. Just as the modulo function captures every part of a calculation, we ensure every part of your revenue cycle is optimized—so you don't leave money on the table.
            </p>
            <div className="pt-4 flex flex-wrap gap-3">
              <Button
                onClick={() => window.open('/attached_assets/Revenue Mgmt Capabilities - Modulo_1756829257557.pptx', '_blank')}
                className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
                data-testid="button-presentation"
              >
                <FileText className="mr-2 h-4 w-4" />
                View Our Presentation
              </Button>
              <Button
                onClick={() => setLocation('/pricing-algorithm')}
                variant="outline"
                className="border-[var(--trilogy-dark-blue)] text-[var(--trilogy-dark-blue)] hover:bg-[var(--trilogy-dark-blue)]/10"
                data-testid="button-algorithm-docs"
              >
                <BookOpen className="mr-2 h-4 w-4" />
                Pricing Algorithm Documentation
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Rules & Guardrails — Major Feature */}
        <Card className="mb-8 border-[var(--trilogy-teal)]/40 bg-white/95 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center gap-3">
              <Shield className="h-6 w-6 text-[var(--trilogy-teal)]" />
              Rules Engine: The Foundation of Controlled Pricing
            </CardTitle>
            <p className="text-sm text-[var(--trilogy-teal)] font-medium mt-1">
              The primary reason Modulo rates and AI rates are kept separate
            </p>
          </CardHeader>
          <CardContent className="space-y-6 text-[var(--trilogy-grey)]">
            <p>
              Modulo's Rules Engine — also called Guardrails — is one of the platform's most important features.
              It gives operators precise control over how pricing recommendations are generated and applied,
              without requiring constant manual review of every unit. Rules define the boundaries within
              which any rate change can occur: minimum and maximum percentage changes per cycle, absolute
              price floors and ceilings by service line, competitor proximity limits, occupancy thresholds,
              and vacancy-day triggers. No recommendation ever leaves these boundaries.
            </p>

            {/* Why Modulo and AI are separate */}
            <div className="rounded-lg border border-[var(--trilogy-grey)]/20 bg-[var(--dashboard-bg)] p-5">
              <div className="flex items-center gap-2 mb-3">
                <ArrowRightLeft className="h-5 w-5 text-[var(--trilogy-teal)]" />
                <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">Why Modulo Rates and AI Rates Are Separate</h3>
              </div>
              <p className="text-sm">
                The Modulo rate is a deterministic, rules-governed recommendation produced by the pricing
                algorithm — fully auditable, repeatable, and bounded by your guardrails. The AI rate is a
                second, independent suggestion generated by the AI Pricing Engine and shown alongside it
                for comparison. Keeping them separate lets operators see both perspectives without one
                overwriting the other. Operators decide which rate to adopt, when to adopt it, and at
                what frequency — the system never forces a change.
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
                  Use Modulo's full pricing engine with configurable weights for occupancy, competitor rates,
                  vacancy duration, room attributes, seasonal factors, and more. The algorithm continuously
                  balances these signals and outputs a rate recommendation that shifts dynamically as market
                  conditions change — the same way hotel and airline revenue management works. Guardrails
                  keep every suggestion within safe bounds while the weights handle nuance.
                </p>
              </div>

              <div className="rounded-lg border border-[var(--trilogy-dark-blue)]/30 bg-[var(--trilogy-dark-blue)]/5 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CalendarClock className="h-5 w-5 text-[var(--trilogy-dark-blue)]" />
                  <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">Traditional Rules Mode</h3>
                </div>
                <p className="text-sm">
                  Prefer a familiar approach? Operators can configure Modulo as a rules-based pricing engine —
                  set your floors, ceilings, and change limits, then run calculations at whatever cadence fits
                  your workflow: daily, weekly, monthly, or on-demand. This makes Modulo an immediate upgrade
                  over manual spreadsheet pricing, requiring no change to how teams already think about rate
                  decisions — just faster, more consistent execution with a full audit trail.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--trilogy-grey)]/20 bg-[var(--dashboard-bg)] p-5">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-5 w-5 text-[var(--trilogy-teal)]" />
                <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">What Rules Control</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                {[
                  "Min / Max % change per cycle",
                  "Absolute price floors & ceilings",
                  "Competitor variance limits",
                  "Occupancy trigger thresholds",
                  "Vacancy day triggers",
                  "Seasonal adjustment factors",
                ].map((rule) => (
                  <div key={rule} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--trilogy-teal)] flex-shrink-0" />
                    <span>{rule}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Leadership Team */}
        <div className="mb-8">
          <h2 className="text-3xl font-light text-[var(--trilogy-dark-blue)] mb-6 text-center">
            Leadership Team
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Kyle Peters - Co-Founder */}
            <Card className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
              <CardHeader>
                <CardTitle className="text-xl font-medium text-[var(--trilogy-dark-blue)]">
                  Kyle Peters
                </CardTitle>
                <p className="text-sm text-[var(--trilogy-grey)]">Vice President – Operations Finance</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[var(--trilogy-grey)]">
                  Kyle Peters is a finance and operations executive with nearly 20 years of experience in senior housing, healthcare, and structured finance. As VP of Operations Finance at Trilogy Health Services, he drives value-based care initiatives, portfolio optimization, and revenue management across 130+ campuses. He previously led pricing and analytics at Atria Senior Living and held finance roles at Travelex and EY. Kyle holds a B.S. in Finance from Rutgers and an MBA from Indiana University. At Modulo, he is pioneering dynamic pricing and revenue optimization tools to help operators succeed in any demand environment.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('https://www.linkedin.com/in/kyleedmondpeters/', '_blank')}
                  className="w-full border-[var(--trilogy-teal)] text-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/10"
                  data-testid="button-linkedin-kyle"
                >
                  <Linkedin className="mr-2 h-4 w-4" />
                  Connect on LinkedIn
                </Button>
              </CardContent>
            </Card>

            {/* Michael Kennedy - Co-Founder */}
            <Card className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
              <CardHeader>
                <CardTitle className="text-xl font-medium text-[var(--trilogy-dark-blue)]">
                  Michael Kennedy
                </CardTitle>
                <p className="text-sm text-[var(--trilogy-grey)]">Director of Revenue Management</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[var(--trilogy-grey)]">
                  Michael Kennedy is a revenue management professional with over 10 years of experience in pricing, financial analysis, and business optimization. He is Director of Revenue Management at Trilogy Health Services and previously led pricing strategy at Atria Senior Living after completing GE's Financial Management Program. Michael holds a B.S. in Finance from the University of Kentucky and studied international business at the Burgundy School of Business in France. At Modulo, he focuses on building data-driven pricing systems that enhance performance and market positioning.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('https://www.linkedin.com/in/michael-kennedy-58a37156/', '_blank')}
                  className="w-full border-[var(--trilogy-teal)] text-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/10"
                  data-testid="button-linkedin-michael"
                >
                  <Linkedin className="mr-2 h-4 w-4" />
                  Connect on LinkedIn
                </Button>
              </CardContent>
            </Card>

            {/* Irisel Johnston - COO */}
            <Card className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
              <CardHeader>
                <CardTitle className="text-xl font-medium text-[var(--trilogy-dark-blue)]">
                  Irisel Johnston
                </CardTitle>
                <p className="text-sm text-[var(--trilogy-grey)]">Chief Operating Officer</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[var(--trilogy-grey)]">
                  Irisel Johnston is an operations finance analyst at Trilogy Health Services with experience in financial planning, benefits management, and operational analytics. She previously worked with Yum! Brands on healthcare and retirement benefits and held leadership roles at the University of Louisville's Student Activities Center. A Beta Alpha Psi Lifetime Member, she holds a B.S. in Finance with a minor in Economics from the University of Louisville. At Modulo, Irisel applies her financial and analytical expertise to support dynamic pricing and revenue optimization solutions.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('https://www.linkedin.com/in/iriscel-jimenez-737311237/?locale=en', '_blank')}
                  className="w-full border-[var(--trilogy-teal)] text-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/10"
                  data-testid="button-linkedin-irisel"
                >
                  <Linkedin className="mr-2 h-4 w-4" />
                  Connect on LinkedIn
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Our Approach */}
        <Card className="bg-gradient-to-r from-[var(--trilogy-teal)]/10 to-[var(--trilogy-dark-blue)]/10 border-[var(--trilogy-grey)]/20">
          <CardHeader>
            <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center">
              <Building2 className="mr-3 h-6 w-6 text-[var(--trilogy-teal)]" />
              Our Approach
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[var(--trilogy-grey)]">
            <p>
              At Modulo, we believe that successful revenue management requires more than just software — 
              it requires a deep understanding of the senior housing industry's unique dynamics. Our team 
              combines hands-on operational experience with advanced analytics expertise to deliver 
              solutions that are both powerful and practical. We work closely with our clients to ensure 
              our platform fits seamlessly into their workflows, providing the insights they need to make 
              confident pricing decisions while maintaining the personal touch that defines quality senior care.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Linkedin, FileText, Building2 } from "lucide-react";

export default function AboutUs() {
  return (
    <div className="min-h-screen bg-[var(--dashboard-bg)] p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-light text-[var(--trilogy-dark-blue)] mb-4">
            About Modulo
          </h1>
          <p className="text-xl text-[var(--trilogy-grey)]">
            Revolutionizing Senior Living Revenue Management
          </p>
        </div>

        {/* Company Story */}
        <Card className="mb-8 bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
          <CardHeader>
            <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)]">
              Our Story
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-[var(--trilogy-grey)]">
            <p>
              Modulo was born from our experience building Aline at Atria Senior Living, where we 
              pioneered data-driven revenue management for the senior living industry. Our team 
              successfully developed and implemented a comprehensive pricing optimization system that 
              transformed how Atria approached revenue management across their portfolio.
            </p>
            <p>
              At Atria, we built Aline from the ground up, creating sophisticated algorithms that 
              analyzed market conditions, competitor pricing, and occupancy patterns to optimize 
              rental rates across hundreds of communities. The system we developed became instrumental 
              in driving significant revenue growth while maintaining high occupancy rates.
            </p>
            <p>
              Now with Modulo, we're bringing that same expertise and innovation to the broader 
              senior living market. Our platform combines AI-powered pricing recommendations with 
              real-time market intelligence, enabling communities to maximize revenue while providing 
              exceptional value to residents.
            </p>
            <div className="pt-4">
              <Button
                onClick={() => window.open('/attached_assets/Revenue Mgmt Capabilities - Trilogy_1756773419634.pptx', '_blank')}
                className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
                data-testid="button-presentation"
              >
                <FileText className="mr-2 h-4 w-4" />
                View Our Presentation
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Leadership Team */}
        <div className="mb-8">
          <h2 className="text-3xl font-light text-[var(--trilogy-dark-blue)] mb-6 text-center">
            Leadership Team
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Co-Founder 1 */}
            <Card className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
              <CardHeader>
                <CardTitle className="text-xl font-medium text-[var(--trilogy-dark-blue)]">
                  Co-Founder
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[var(--trilogy-grey)]">
                  As co-founder of Modulo, I bring extensive experience in revenue management 
                  and pricing optimization from our time building Aline at Atria Senior Living. 
                  My focus is on developing innovative algorithms that help senior living 
                  communities maximize their revenue potential while maintaining high 
                  occupancy rates.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('https://linkedin.com', '_blank')}
                  className="w-full border-[var(--trilogy-teal)] text-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/10"
                  data-testid="button-linkedin-cofounder1"
                >
                  <Linkedin className="mr-2 h-4 w-4" />
                  Connect on LinkedIn
                </Button>
              </CardContent>
            </Card>

            {/* Michael - Co-Founder */}
            <Card className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
              <CardHeader>
                <CardTitle className="text-xl font-medium text-[var(--trilogy-dark-blue)]">
                  Michael
                </CardTitle>
                <p className="text-sm text-[var(--trilogy-grey)]">Co-Founder</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[var(--trilogy-grey)]">
                  Michael co-founded Modulo after our successful experience building Aline at 
                  Atria Senior Living. With deep expertise in data analytics and market 
                  intelligence, Michael leads our efforts in developing AI-powered pricing 
                  models that adapt to changing market conditions and competitor dynamics.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('https://linkedin.com', '_blank')}
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
                  As COO, Irisel brings operational excellence and strategic vision to Modulo. 
                  With extensive experience in senior living operations and technology 
                  implementation, Irisel ensures our platform delivers practical, actionable 
                  insights that drive real business results for our clients.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('https://linkedin.com', '_blank')}
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

        {/* Atria Legacy */}
        <Card className="bg-gradient-to-r from-[var(--trilogy-teal)]/10 to-[var(--trilogy-dark-blue)]/10 border-[var(--trilogy-grey)]/20">
          <CardHeader>
            <CardTitle className="text-2xl font-light text-[var(--trilogy-dark-blue)] flex items-center">
              <Building2 className="mr-3 h-6 w-6 text-[var(--trilogy-teal)]" />
              The Aline Legacy at Atria
            </CardTitle>
          </CardHeader>
          <CardContent className="text-[var(--trilogy-grey)]">
            <p>
              Our journey began at Atria Senior Living, where we built Aline - a groundbreaking 
              revenue management system that revolutionized pricing strategies across their entire 
              portfolio. Aline's success demonstrated the power of data-driven decision making in 
              senior living, achieving measurable improvements in both revenue per unit and 
              portfolio-wide occupancy. This experience laid the foundation for Modulo, where we're 
              now bringing these proven strategies to the broader senior living market with even 
              more advanced AI capabilities and market intelligence tools.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
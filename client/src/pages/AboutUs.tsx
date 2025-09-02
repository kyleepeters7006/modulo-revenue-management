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
              Modulo brings together decades of experience in senior living operations, technology, 
              and revenue management. Our team has worked extensively with leading senior living 
              operators to understand the unique challenges of pricing optimization in this complex market.
            </p>
            <p>
              We've built Modulo to address the real-world needs of senior living communities - from 
              managing diverse service lines and care levels to navigating competitive markets and 
              regulatory requirements. Our platform combines practical industry knowledge with 
              advanced analytics to deliver actionable pricing recommendations.
            </p>
            <p>
              Our mission is simple: help senior living communities optimize their revenue while 
              maintaining high occupancy and delivering exceptional value to residents. We believe 
              that data-driven decision making, combined with deep industry expertise, is the key 
              to sustainable growth in senior living.
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
            {/* Kyle Peters - Co-Founder */}
            <Card className="bg-white/95 backdrop-blur border-[var(--trilogy-grey)]/20">
              <CardHeader>
                <CardTitle className="text-xl font-medium text-[var(--trilogy-dark-blue)]">
                  Kyle Peters
                </CardTitle>
                <p className="text-sm text-[var(--trilogy-grey)]">Co-Founder</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[var(--trilogy-grey)]">
                  Kyle brings deep expertise in senior living operations and technology innovation. 
                  With experience spanning healthcare technology and data analytics, Kyle focuses on 
                  building practical solutions that address the real challenges faced by senior living 
                  operators in today's competitive market.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open('https://linkedin.com', '_blank')}
                  className="w-full border-[var(--trilogy-teal)] text-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/10"
                  data-testid="button-linkedin-kyle"
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
                  Michael brings extensive experience in financial analysis and business intelligence 
                  to Modulo. With a background in developing data-driven strategies for healthcare 
                  organizations, Michael leads our efforts in creating intuitive analytics tools that 
                  help operators make confident pricing decisions.
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
              At Modulo, we believe that successful revenue management requires more than just software - 
              it requires a deep understanding of the senior living industry's unique dynamics. Our team 
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
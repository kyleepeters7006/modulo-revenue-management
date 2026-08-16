import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronRight,
  ChevronDown,
  FileSpreadsheet,
  FileBarChart,
  FileText,
  Building2,
  Home,
  Calculator,
  BookOpen,
  Sparkles,
  Loader2,
} from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface StrategyDocumentation {
  campus: string;
  serviceLine?: string;
  sentenceVersion: string;
  equationVersion: string;
  currentMetrics: {
    occupancy: number;
    avgRate: number;
    unitCount: number;
  };
}

interface CampusGroup {
  campus: string;
  campusLevel?: StrategyDocumentation;
  serviceLines: StrategyDocumentation[];
}

interface AiRuleSummary {
  ruleId: string;
  ruleName: string;
  description: string;
}

interface AiContent {
  executiveSummary: string;
  ruleSummaries: AiRuleSummary[];
}

const SL_NAMES: Record<string, string> = {
  AL: "Assisted Living",
  MC: "Memory Care",
  "AL/MC": "Assisted Living / Memory Care",
  HC: "Health Center",
  "HC/MC": "Health Center / Memory Care",
  IL: "Independent Living",
  SL: "Senior Living",
  VIL: "Village",
  SNF: "Skilled Nursing",
};

export default function PricingStrategyDocumentation() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [expandedCampuses, setExpandedCampuses] = useState<Set<string>>(new Set());
  const [selectedView, setSelectedView] = useState<StrategyDocumentation | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(true);

  const { data: documentation, isLoading } = useQuery<StrategyDocumentation[]>({
    queryKey: ["/api/pricing-strategy-documentation"],
  });

  const { data: aiContent, isLoading: aiLoading } = useQuery<AiContent>({
    queryKey: ["/api/pricing-strategy-documentation/ai-summary"],
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const groupedDocumentation = documentation?.reduce(
    (acc, doc) => {
      const campus = doc.campus;
      if (!acc[campus]) acc[campus] = { campus, serviceLines: [] };
      if (doc.serviceLine) {
        acc[campus].serviceLines.push(doc);
      } else {
        acc[campus].campusLevel = doc;
      }
      return acc;
    },
    {} as Record<string, CampusGroup>
  );

  const toggleCampus = (campus: string) => {
    const next = new Set(expandedCampuses);
    if (next.has(campus)) next.delete(campus);
    else next.add(campus);
    setExpandedCampuses(next);
  };

  const handleExportAi = async (format: "excel" | "pdf") => {
    const setLoading = format === "excel" ? setExportingExcel : setExportingPdf;
    setLoading(true);
    try {
      const res = await fetch(`/api/pricing-strategy-documentation/export-ai?format=${format}`);
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pricing_strategy_${new Date().toISOString().split("T")[0]}.${format === "excel" ? "xlsx" : "pdf"}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: "Export Ready",
        description: `Pricing strategy exported as ${format.toUpperCase()} with AI summaries.`,
      });
    } catch {
      toast({
        title: "Export Failed",
        description: "Could not generate the export. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-[var(--trilogy-teal)]/20 bg-white dark:bg-gray-900 shadow-lg">
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[var(--trilogy-teal)]/20 bg-white dark:bg-gray-900 shadow-lg">
      <CardHeader>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-2xl font-bold flex items-center gap-2 text-gray-900 dark:text-gray-100">
              <BookOpen className="h-6 w-6 text-[var(--trilogy-teal)]" />
              Pricing Strategy Documentation
            </CardTitle>
            <CardDescription className="text-gray-600 dark:text-gray-400 mt-1">
              AI-generated summaries of every pricing rule and campus strategy — export to Excel or PDF, or view the full report
            </CardDescription>
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExportAi("excel")}
              disabled={exportingExcel || exportingPdf}
              className="border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950"
            >
              {exportingExcel ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4 mr-2" />
              )}
              Export Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExportAi("pdf")}
              disabled={exportingExcel || exportingPdf}
              className="border-rose-600 text-rose-700 hover:bg-rose-50 dark:border-rose-500 dark:text-rose-400 dark:hover:bg-rose-950"
            >
              {exportingPdf ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <FileText className="w-4 h-4 mr-2" />
              )}
              Export PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/pricing-controls?openReport=true")}
              className="border-slate-600 text-slate-700 hover:bg-slate-50 dark:border-slate-500 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <FileBarChart className="w-4 h-4 mr-2" />
              View Pricing Strategy Report
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        {/* ── AI Executive Summary ──────────────────────────────────── */}
        <Collapsible open={aiExpanded} onOpenChange={setAiExpanded}>
          <div className="border border-[var(--trilogy-teal)]/30 rounded-lg overflow-hidden">
            <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-3 bg-gradient-to-r from-teal-50 to-emerald-50 dark:from-teal-950/40 dark:to-emerald-950/40 hover:from-teal-100 dark:hover:from-teal-900/40 transition-colors">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[var(--trilogy-teal)]" />
                <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                  AI Executive Summary
                </span>
                {aiLoading && (
                  <Loader2 className="h-3.5 w-3.5 text-[var(--trilogy-teal)] animate-spin" />
                )}
              </div>
              {aiExpanded ? (
                <ChevronDown className="h-4 w-4 text-gray-500" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-500" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="p-4 bg-white dark:bg-gray-900">
                {aiLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/5" />
                    <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Generating AI analysis of your pricing strategy…
                    </p>
                  </div>
                ) : aiContent?.executiveSummary ? (
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {aiContent.executiveSummary}
                  </p>
                ) : (
                  <p className="text-sm text-gray-400 italic">
                    AI summary unavailable. Export to Excel or PDF to trigger generation.
                  </p>
                )}
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>

        {/* ── Main Grid: Campus Tree + Detail View ─────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Campus Tree Navigation */}
          <div className="lg:col-span-1">
            <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
              <h3 className="font-semibold text-sm mb-3 text-gray-700 dark:text-gray-300">
                Select Campus / Service Line
              </h3>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {Object.values(groupedDocumentation || {}).map(
                    ({ campus, campusLevel, serviceLines }) => (
                      <div
                        key={campus}
                        className="border rounded-lg bg-white dark:bg-gray-900"
                      >
                        <Collapsible
                          open={expandedCampuses.has(campus)}
                          onOpenChange={() => toggleCampus(campus)}
                        >
                          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                            <div className="flex items-center gap-2">
                              {expandedCampuses.has(campus) ? (
                                <ChevronDown className="h-4 w-4 text-gray-500" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-gray-500" />
                              )}
                              <Building2 className="h-4 w-4 text-[var(--trilogy-teal)]" />
                              <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                                {campus}
                              </span>
                            </div>
                            <Badge variant="secondary" className="text-xs">
                              {serviceLines.length} service{serviceLines.length !== 1 ? "s" : ""}
                            </Badge>
                          </CollapsibleTrigger>

                          <CollapsibleContent>
                            <div className="border-t">
                              {campusLevel && (
                                <button
                                  onClick={() => setSelectedView(campusLevel)}
                                  className={`w-full text-left p-3 pl-10 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b ${selectedView === campusLevel ? "bg-teal-50 dark:bg-teal-900/30" : ""}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <Building2 className="h-3 w-3 text-gray-400" />
                                    <span className="text-sm text-gray-900 dark:text-gray-100">
                                      All Service Lines
                                    </span>
                                  </div>
                                </button>
                              )}
                              {serviceLines.map((doc) => (
                                <button
                                  key={`${campus}-${doc.serviceLine}`}
                                  onClick={() => setSelectedView(doc)}
                                  className={`w-full text-left p-3 pl-10 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${selectedView === doc ? "bg-teal-50 dark:bg-teal-900/30" : ""}`}
                                >
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Home className="h-3 w-3 text-gray-400" />
                                      <span className="text-sm text-gray-900 dark:text-gray-100">
                                        {SL_NAMES[doc.serviceLine || ""] || doc.serviceLine}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-gray-500">
                                        {doc.currentMetrics.unitCount} units
                                      </span>
                                      <Badge variant="outline" className="text-xs">
                                        {Math.round(doc.currentMetrics.occupancy * 100)}%
                                      </Badge>
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    )
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* Detail View */}
          <div className="lg:col-span-2">
            {selectedView ? (
              <div className="border rounded-lg p-6 bg-white dark:bg-gray-900 space-y-4">
                {/* Header */}
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-gray-100">
                    <Building2 className="h-5 w-5 text-[var(--trilogy-teal)]" />
                    {selectedView.campus}
                    {selectedView.serviceLine && (
                      <span className="text-gray-500 font-normal">
                        &nbsp;•&nbsp;{SL_NAMES[selectedView.serviceLine] || selectedView.serviceLine}
                      </span>
                    )}
                  </h3>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <Badge variant="secondary">
                      {selectedView.currentMetrics.unitCount} units
                    </Badge>
                    <Badge variant="outline">
                      {Math.round(selectedView.currentMetrics.occupancy * 100)}% occupancy
                    </Badge>
                    <Badge variant="outline">
                      ${selectedView.currentMetrics.avgRate.toLocaleString()}/mo avg
                    </Badge>
                  </div>
                </div>

                <Tabs defaultValue="sentence" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="sentence" className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Plain English
                    </TabsTrigger>
                    <TabsTrigger value="equation" className="flex items-center gap-2">
                      <Calculator className="h-4 w-4" />
                      Mathematical Formula
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="sentence" className="mt-4">
                    <ScrollArea className="h-[360px] rounded-lg border p-4 bg-gray-50 dark:bg-gray-800">
                      <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 dark:text-gray-200">
                        {selectedView.sentenceVersion}
                      </pre>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="equation" className="mt-4">
                    <ScrollArea className="h-[360px] rounded-lg border p-4 bg-gray-50 dark:bg-gray-800">
                      <pre className="whitespace-pre-wrap font-mono text-sm text-gray-700 dark:text-gray-200">
                        {selectedView.equationVersion}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              /* Rule AI Descriptions — shown when no campus selected */
              <div className="border rounded-lg bg-white dark:bg-gray-900 overflow-hidden">
                <div className="px-4 py-3 border-b bg-gray-50 dark:bg-gray-800">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-[var(--trilogy-teal)]" />
                    Active Rules — AI Descriptions
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Select a campus on the left to view its strategy, or review per-rule AI summaries below.
                  </p>
                </div>
                <ScrollArea className="h-[480px]">
                  {aiLoading ? (
                    <div className="p-4 space-y-4">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="space-y-2">
                          <Skeleton className="h-5 w-48" />
                          <Skeleton className="h-3 w-full" />
                          <Skeleton className="h-3 w-4/5" />
                        </div>
                      ))}
                    </div>
                  ) : aiContent?.ruleSummaries?.length ? (
                    <div className="divide-y">
                      {aiContent.ruleSummaries.map((rs) => (
                        <div key={rs.ruleId} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
                            {rs.ruleName}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                            {rs.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                      <Calculator className="h-10 w-10 mb-3" />
                      <p className="text-sm">Select a campus to view its pricing strategy</p>
                      <p className="text-xs mt-1">AI rule descriptions will appear here once loaded</p>
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

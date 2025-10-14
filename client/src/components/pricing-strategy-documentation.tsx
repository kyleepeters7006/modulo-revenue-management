import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  ChevronRight, 
  ChevronDown, 
  Download, 
  FileText, 
  FileJson,
  Building2,
  Home,
  Calculator,
  BookOpen
} from "lucide-react";
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

export default function PricingStrategyDocumentation() {
  const { toast } = useToast();
  const [expandedCampuses, setExpandedCampuses] = useState<Set<string>>(new Set());
  const [selectedView, setSelectedView] = useState<StrategyDocumentation | null>(null);

  const { data: documentation, isLoading, error } = useQuery<StrategyDocumentation[]>({
    queryKey: ['/api/pricing-strategy-documentation'],
  });

  // Group documentation by campus and service line
  const groupedDocumentation = documentation?.reduce((acc, doc) => {
    const campus = doc.campus;
    if (!acc[campus]) {
      acc[campus] = {
        campus,
        serviceLines: []
      };
    }
    
    if (doc.serviceLine) {
      acc[campus].serviceLines.push(doc);
    } else {
      acc[campus].campusLevel = doc;
    }
    
    return acc;
  }, {} as Record<string, CampusGroup>);

  const toggleCampus = (campus: string) => {
    const newExpanded = new Set(expandedCampuses);
    if (newExpanded.has(campus)) {
      newExpanded.delete(campus);
    } else {
      newExpanded.add(campus);
    }
    setExpandedCampuses(newExpanded);
  };

  const handleExport = async (format: 'text' | 'json', campus?: string, serviceLine?: string) => {
    try {
      const params = new URLSearchParams({ format });
      if (campus) params.append('campus', campus);
      if (serviceLine) params.append('serviceLine', serviceLine);
      
      const response = await fetch(`/api/pricing-strategy-documentation/export?${params}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const campusLabel = campus || 'all';
      const serviceLineLabel = serviceLine ? `_${serviceLine}` : '';
      const extension = format === 'json' ? 'json' : 'txt';
      a.download = `pricing_strategy_${campusLabel}${serviceLineLabel}_${new Date().toISOString().split('T')[0]}.${extension}`;
      
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Export Successful",
        description: `Pricing strategy documentation exported as ${format.toUpperCase()}.`,
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export pricing strategy documentation.",
        variant: "destructive",
      });
    }
  };

  const getServiceLineName = (code: string) => {
    const names: Record<string, string> = {
      'AL': 'Assisted Living',
      'MC': 'Memory Care', 
      'HC': 'Health Center',
      'IL': 'Independent Living',
      'SNF': 'Skilled Nursing'
    };
    return names[code] || code;
  };

  if (isLoading) {
    return (
      <Card className="border-[var(--trilogy-teal)]/20 bg-white dark:bg-gray-900 shadow-lg">
        <CardContent className="p-6">
          <div className="flex justify-center items-center h-64">
            <div className="text-gray-500">Loading pricing strategies...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-[var(--trilogy-teal)]/20 bg-white dark:bg-gray-900 shadow-lg">
        <CardContent className="p-6">
          <div className="text-red-500">Error loading pricing strategies</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[var(--trilogy-teal)]/20 bg-white dark:bg-gray-900 shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-[var(--trilogy-teal)]" />
              Pricing Strategy Documentation
            </CardTitle>
            <CardDescription className="text-gray-600 dark:text-gray-400 mt-1">
              View and download pricing strategies in sentence and equation formats
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('text')}
              data-testid="button-export-all-text"
            >
              <FileText className="w-4 h-4 mr-2" />
              Export All (TXT)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('json')}
              data-testid="button-export-all-json"
            >
              <FileJson className="w-4 h-4 mr-2" />
              Export All (JSON)
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Campus Tree Navigation */}
          <div className="lg:col-span-1">
            <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
              <h3 className="font-semibold text-sm mb-3 text-gray-700 dark:text-gray-300">
                Select Campus / Service Line
              </h3>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {Object.values(groupedDocumentation || {}).map(({ campus, campusLevel, serviceLines }) => (
                    <div key={campus} className="border rounded-lg bg-white dark:bg-gray-900">
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
                            <span className="font-medium text-sm">{campus}</span>
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {serviceLines.length} services
                          </Badge>
                        </CollapsibleTrigger>
                        
                        <CollapsibleContent>
                          <div className="border-t">
                            {/* Campus level view */}
                            {campusLevel && (
                              <button
                                onClick={() => setSelectedView(campusLevel)}
                                className="w-full text-left p-3 pl-10 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b"
                                data-testid={`button-view-${campus}-campus`}
                              >
                                <div className="flex items-center gap-2">
                                  <Building2 className="h-3 w-3 text-gray-400" />
                                  <span className="text-sm">All Service Lines</span>
                                </div>
                              </button>
                            )}
                            
                            {/* Service line views */}
                            {serviceLines.map(doc => (
                              <button
                                key={`${campus}-${doc.serviceLine}`}
                                onClick={() => setSelectedView(doc)}
                                className="w-full text-left p-3 pl-10 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                data-testid={`button-view-${campus}-${doc.serviceLine}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Home className="h-3 w-3 text-gray-400" />
                                    <span className="text-sm">
                                      {getServiceLineName(doc.serviceLine || '')}
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
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>

          {/* Documentation View */}
          <div className="lg:col-span-2">
            {selectedView ? (
              <div className="border rounded-lg p-6 bg-white dark:bg-gray-900">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Building2 className="h-5 w-5 text-[var(--trilogy-teal)]" />
                      {selectedView.campus}
                      {selectedView.serviceLine && (
                        <span className="text-gray-500">
                          • {getServiceLineName(selectedView.serviceLine)}
                        </span>
                      )}
                    </h3>
                    <div className="flex items-center gap-4 mt-2">
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
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExport('text', selectedView.campus, selectedView.serviceLine)}
                      data-testid="button-export-selected"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export
                    </Button>
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
                    <ScrollArea className="h-[400px] rounded-lg border p-4 bg-gray-50 dark:bg-gray-800">
                      <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700 dark:text-gray-200">
                        {selectedView.sentenceVersion}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                  
                  <TabsContent value="equation" className="mt-4">
                    <ScrollArea className="h-[400px] rounded-lg border p-4 bg-gray-50 dark:bg-gray-800">
                      <pre className="whitespace-pre-wrap font-mono text-sm text-gray-700 dark:text-gray-200">
                        {selectedView.equationVersion}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <div className="border rounded-lg p-12 bg-gray-50 dark:bg-gray-800 text-center">
                <Calculator className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400">
                  Select a campus or service line to view its pricing strategy
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mic, MicOff, Sparkles, Play, History, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface AdjustmentRule {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  lastExecuted?: Date;
  executionCount: number;
  affectedUnits?: number;
  impactSummary?: {
    totalRevenueDelta: number;
    unitsAffected: number;
  };
}

const exampleRules = [
  "Increase all studio rates by 5% next month",
  "Reduce vacant unit rates by $100 after 30 days",
  "When occupancy drops below 85%, reduce rates by 3%",
  "Increase memory care rates by 2% every quarter",
  "If a unit sells, increase nearby units by 3%",
];

export function NaturalLanguageAdjustments() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [rules, setRules] = useState<AdjustmentRule[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const { toast } = useToast();
  const recognitionRef = useRef<any>(null);
  
  // Fetch existing rules on mount
  useEffect(() => {
    fetchRules();
  }, []);
  
  const fetchRules = async () => {
    try {
      const response = await fetch('/api/adjustment-rules');
      if (response.ok) {
        const data = await response.json();
        setRules(data);
      }
    } catch (error) {
      console.error('Failed to fetch rules:', error);
    }
  };

  // Check for browser support
  const isSpeechSupported = typeof window !== 'undefined' && 
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  useEffect(() => {
    if (!isSpeechSupported) return;

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interimTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      
      setTranscript(prev => prev + finalTranscript);
      
      // Show interim results for better UX
      if (interimTranscript) {
        setTranscript(prev => prev + ' [listening...]');
      }
    };
    
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error);
      toast({
        title: "Voice input error",
        description: "Please check your microphone permissions",
        variant: "destructive",
      });
      setIsRecording(false);
    };
    
    recognition.onend = () => {
      setIsRecording(false);
      // Clean up the [listening...] indicator
      setTranscript(prev => prev.replace(' [listening...]', ''));
    };
    
    recognitionRef.current = recognition;
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [isSpeechSupported, toast]);

  const toggleRecording = () => {
    if (!isSpeechSupported) {
      toast({
        title: "Voice input not supported",
        description: "Please use a modern browser with microphone support",
        variant: "destructive",
      });
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    } else {
      recognitionRef.current?.start();
      setIsRecording(true);
      
      // Provide audio feedback
      const audio = new Audio();
      audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAABagBq';
      audio.play().catch(() => {});
    }
  };

  const processRule = async () => {
    if (!transcript.trim()) {
      toast({
        title: "No rule entered",
        description: "Please enter or speak a rule to create",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      // Send to backend for parsing and creation
      const response = await fetch('/api/adjustment-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          description: transcript,
          preview: previewMode 
        }),
      });

      if (!response.ok) throw new Error('Failed to process rule');

      const result = await response.json();
      
      if (previewMode) {
        // Show preview with annual impact
        const monthlyImpact = result.monthlyImpact || result.estimatedImpact;
        const annualImpact = result.annualImpact || monthlyImpact * 12;
        const volumeAdjustedAnnualImpact = result.volumeAdjustedAnnualImpact || annualImpact * 1.05;
        
        toast({
          title: "Rule Preview",
          description: `${result.affectedUnits} units • Monthly: $${monthlyImpact.toLocaleString()} • Annual (5% vol.↑): $${volumeAdjustedAnnualImpact.toLocaleString()}`,
        });
      } else {
        // Rule created successfully
        setRules([...rules, result.rule]);
        setTranscript('');
        
        const annualImpact = result.volumeAdjustedAnnualImpact || (result.estimatedImpact * 12 * 1.05);
        
        toast({
          title: "Rule created successfully",
          description: `"${result.rule.name}" will affect ${result.affectedUnits} units with annual impact of $${annualImpact.toLocaleString()}`,
        });
        
        // Audio confirmation
        const audio = new Audio();
        audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAACAGwAbA==';
        audio.play().catch(() => {});
      }
    } catch (error) {
      toast({
        title: "Failed to process rule",
        description: "Please try rephrasing your rule",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleRuleStatus = async (ruleId: string) => {
    try {
      const response = await fetch(`/api/adjustment-rules/${ruleId}/toggle`, {
        method: 'PATCH',
      });
      
      if (!response.ok) throw new Error('Failed to toggle rule');
      
      setRules(rules.map(rule => 
        rule.id === ruleId ? { ...rule, isActive: !rule.isActive } : rule
      ));
      
      toast({
        title: "Rule updated",
        description: "Rule status changed successfully",
      });
    } catch (error) {
      toast({
        title: "Failed to update rule",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Smart Adjustments
            </CardTitle>
            <CardDescription>
              Speak or type natural language rules to adjust portfolio pricing
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
            data-testid="button-history"
          >
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Voice Input Section */}
        <div className="space-y-4">
          <div className="relative">
            <Textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Click the microphone or type your adjustment rule here..."
              className="min-h-[100px] pr-16"
              aria-label="Adjustment rule input"
              data-testid="input-rule-text"
            />
            <Button
              size="icon"
              variant={isRecording ? "destructive" : "secondary"}
              className="absolute bottom-2 right-2"
              onClick={toggleRecording}
              aria-label={isRecording ? "Stop recording" : "Start recording"}
              data-testid="button-microphone"
            >
              {isRecording ? (
                <MicOff className="h-4 w-4 animate-pulse" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
          </div>
          
          {/* Example Rules */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Try saying:</Label>
            <div className="flex flex-wrap gap-2">
              {exampleRules.map((example, index) => (
                <Button
                  key={index}
                  variant="outline"
                  size="sm"
                  onClick={() => setTranscript(example)}
                  className="text-xs"
                  data-testid={`button-example-${index}`}
                >
                  "{example}"
                </Button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Switch
                id="preview-mode"
                checked={previewMode}
                onCheckedChange={setPreviewMode}
                data-testid="switch-preview"
              />
              <Label htmlFor="preview-mode" className="text-sm">
                Preview impact before applying
              </Label>
            </div>
            
            <Button
              onClick={processRule}
              disabled={!transcript.trim() || isProcessing}
              className="min-w-[120px]"
              data-testid="button-apply-rule"
            >
              {isProcessing ? (
                <>Processing...</>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  {previewMode ? 'Preview' : 'Apply'} Rule
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Active Rules */}
        {rules.length > 0 && (
          <div className="space-y-2">
            <Label>Active Rules</Label>
            <ScrollArea className="h-[200px] rounded-md border p-4">
              <div className="space-y-3">
                {rules.map((rule) => (
                  <div 
                    key={rule.id}
                    className="flex items-start justify-between p-3 rounded-lg bg-muted/50"
                    data-testid={`rule-${rule.id}`}
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        {rule.isActive ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium text-sm">{rule.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{rule.description}</p>
                      <div className="flex gap-2 mt-2">
                        <Badge variant="secondary" className="text-xs">
                          {rule.executionCount} executions
                        </Badge>
                        {rule.affectedUnits && (
                          <Badge variant="outline" className="text-xs">
                            {rule.affectedUnits} units affected
                          </Badge>
                        )}
                        {rule.volumeAdjustedAnnualImpact && (
                          <Badge variant="default" className="text-xs">
                            ${(rule.volumeAdjustedAnnualImpact || 0).toLocaleString()}/yr (5% vol.↑)
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={rule.isActive}
                      onCheckedChange={() => toggleRuleStatus(rule.id)}
                      aria-label={`Toggle rule ${rule.name}`}
                      data-testid={`switch-rule-${rule.id}`}
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Info Banner */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
          <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-blue-900 dark:text-blue-100">How it works:</p>
            <ul className="mt-1 space-y-1 text-xs text-blue-800 dark:text-blue-200">
              <li>• Speak naturally or type your pricing adjustment rules</li>
              <li>• Rules apply automatically based on your conditions</li>
              <li>• Preview mode shows impact before applying</li>
              <li>• All changes are logged and reversible</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
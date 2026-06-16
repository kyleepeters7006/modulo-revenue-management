import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Mic, MicOff, Sparkles, Play, History, AlertCircle, CheckCircle2, XCircle,
  Trash2, Plus, ChevronRight, ChevronDown, Copy, Pencil, TrendingDown, TrendingUp, AlertTriangle,
  Info, Eye, Save, X, Wand2, ArrowRight
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

const METRICS = [
  'Campus Occupancy', 'Service Line Occupancy', 'Room Type Occupancy',
  'Vacant Units/Beds', 'Total Units/Beds', 'Service Line',
  'Competitor Rate', 'Days Vacant', 'Room Attributes',
  'Days To Sell Previously', 'Season', 'Stock Market', 'Inquiry and Tour Volume',
  'Quality Mix',
];

const TIME_PERIODS = ['Current Spot', 'Current Month', 'Trailing 3', 'Trailing 6', 'Trailing 12'];

const OPERATORS = [
  'is greater than', 'is greater than or equal to',
  'is less than', 'is less than or equal to',
  'equals', 'does not equal',
  'increases by more than', 'decreases by more than',
  'is between', 'contains', 'does not contain',
];

const ACTIONS = [
  { value: 'increase_rate', label: 'Increase rate' },
  { value: 'decrease_rate', label: 'Decrease rate' },
  { value: 'set_rate', label: 'Set rate' },
  { value: 'apply_discount', label: 'Apply discount' },
  { value: 'remove_discount', label: 'Remove discount' },
  { value: 'cap_rate_increase', label: 'Cap rate increase' },
  { value: 'set_minimum_rate', label: 'Set minimum rate' },
  { value: 'set_maximum_rate', label: 'Set maximum rate' },
];

const SCOPES = [
  'All selected campuses', 'Selected campus', 'Selected service line',
  'Selected room type', 'Vacant units only', 'Units matching room attributes',
  'Units with days vacant above threshold',
];

const EXAMPLE_RULES = [
  "If campus occupancy drops below 85%, reduce rates by 3%",
  "Reduce vacant unit rates by $100 after 30 days",
  "If a unit sells, increase nearby units by 3%",
  "Increase memory care rates by 2% every quarter",
];

let conditionIdCounter = 0;
const newConditionId = () => `cond-${++conditionIdCounter}`;

interface Condition {
  id: string;
  metric: string;
  timePeriod: string;
  operator: string;
  value: string;
}

interface RuleAction {
  type: string;
  amountType: 'percent' | 'dollar';
  amountValue: string;
  scope: string;
}

interface AdjustmentRule {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  lastExecuted?: string;
  executionCount: number;
  affectedUnits?: number;
  affectedCampuses?: number;
  monthlyImpact?: number;
  annualImpact?: number;
  volumeAdjustedAnnualImpact?: number;
  trigger?: unknown;
  action?: unknown;
}

interface ImpactData {
  affectedUnits: number;
  monthlyImpact: number;
  annualImpact: number;
  volumeAdjustedAnnualImpact: number;
  confidence?: 'high' | 'medium' | 'needs_review';
  reasonabilityCheck?: { risk: string; explanation: string; isReasonable: boolean };
}

const defaultCondition = (): Condition => ({
  id: newConditionId(),
  metric: 'Campus Occupancy',
  timePeriod: 'Current Month',
  operator: 'is less than',
  value: '',
});

const defaultAction = (): RuleAction => ({
  type: 'decrease_rate',
  amountType: 'percent',
  amountValue: '',
  scope: 'Vacant units only',
});

function buildDescription(conditions: Condition[], operator: string, action: RuleAction): string {
  const condParts = conditions
    .filter(c => c.value.trim())
    .map(c => `${c.metric} (${c.timePeriod}) ${c.operator} ${c.value}`);
  if (!condParts.length && !action.amountValue) return '';
  const ifPart = condParts.length ? `If ${condParts.join(` ${operator} `)}` : '';
  const actionLabel = ACTIONS.find(a => a.value === action.type)?.label || action.type;
  const amountStr = action.amountValue
    ? (action.amountType === 'percent' ? `${action.amountValue}%` : `$${action.amountValue}`)
    : '[amount]';
  const thenPart = `${actionLabel} by ${amountStr}`;
  const scopePart = action.scope ? ` for ${action.scope.toLowerCase()}` : '';
  return [ifPart, thenPart + scopePart].filter(Boolean).join(', ');
}

function computeValidation(conditions: Condition[], action: RuleAction, tab: string, aiInput: string): string[] {
  const msgs: string[] = [];
  if (tab === 'structured') {
    const filled = conditions.filter(c => c.value.trim());
    if (!filled.length) msgs.push('Add at least one condition value to complete this rule.');
    if (!action.amountValue) msgs.push('Set an amount for the pricing action.');
    if (!action.scope) msgs.push('This rule does not have a target scope.');
    if (conditions.some(c => c.metric === 'Competitor Rate'))
      msgs.push('This rule uses Competitor Rate — confirm competitor data is available for all campuses.');
    if (action.scope === 'All selected campuses' || !action.scope)
      msgs.push('This rule applies broadly. Confirm before applying.');
  } else {
    if (!aiInput.trim()) msgs.push('Enter or speak a rule to get started.');
  }
  return msgs;
}

interface RuleDesignerProps {
  locationId?: string;
  serviceLine?: string;
  locationName?: string;
}

export function RuleDesigner({ locationId, serviceLine, locationName }: RuleDesignerProps) {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'ask-ai' | 'structured'>('ask-ai');
  const [aiInput, setAiInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [rules, setRules] = useState<AdjustmentRule[]>([]);
  const [rulesOpen, setRulesOpen] = useState(true);
  const [impactData, setImpactData] = useState<ImpactData | null>(null);
  const [isLoadingImpact, setIsLoadingImpact] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleName, setEditingRuleName] = useState<string>('');

  // Structured builder state
  const [conditions, setConditions] = useState<Condition[]>([defaultCondition()]);
  const [conditionOperator, setConditionOperator] = useState<'AND' | 'OR'>('AND');
  const [ruleAction, setRuleAction] = useState<RuleAction>(defaultAction());

  const recognitionRef = useRef<any>(null);

  const isSpeechSupported = typeof window !== 'undefined' &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  // Fetch existing rules
  const fetchRules = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (locationId) params.set('locationId', locationId);
      if (serviceLine) params.set('serviceLine', serviceLine);
      const res = await fetch(`/api/adjustment-rules${params.toString() ? `?${params}` : ''}`);
      if (res.ok) setRules(await res.json());
    } catch { /* silent */ }
  }, [locationId, serviceLine]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  // Speech recognition setup
  useEffect(() => {
    if (!isSpeechSupported) return;
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      if (final) setAiInput(prev => (prev + ' ' + final).trim());
    };
    rec.onerror = () => {
      toast({ title: 'Voice input error', description: 'Check microphone permissions', variant: 'destructive' });
      setIsRecording(false);
    };
    rec.onend = () => setIsRecording(false);
    recognitionRef.current = rec;
    return () => recognitionRef.current?.stop();
  }, [isSpeechSupported, toast]);

  const toggleRecording = () => {
    if (!isSpeechSupported) {
      toast({ title: 'Voice not supported', description: 'Use a browser with microphone support', variant: 'destructive' });
      return;
    }
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); }
    else { recognitionRef.current?.start(); setIsRecording(true); }
  };

  // Derive the description to submit
  const getDescription = () =>
    activeTab === 'ask-ai'
      ? aiInput.trim()
      : buildDescription(conditions, conditionOperator, ruleAction);

  // Preview impact (no save)
  const handlePreviewImpact = async () => {
    const description = getDescription();
    if (!description) {
      toast({ title: 'Nothing to preview', description: 'Build or type a rule first', variant: 'destructive' });
      return;
    }
    setIsLoadingImpact(true);
    setImpactData(null);
    try {
      const res = await fetch('/api/adjustment-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, preview: true, locationId: locationId || null, serviceLine: serviceLine || null }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setImpactData({
        affectedUnits: data.affectedUnits || 0,
        monthlyImpact: data.monthlyImpact || data.estimatedImpact || 0,
        annualImpact: data.annualImpact || 0,
        volumeAdjustedAnnualImpact: data.volumeAdjustedAnnualImpact || 0,
        confidence: data.reasonabilityCheck?.risk === 'low' ? 'high' : data.reasonabilityCheck?.risk === 'medium' ? 'medium' : data.reasonabilityCheck ? 'needs_review' : 'high',
        reasonabilityCheck: data.reasonabilityCheck,
      });
    } catch {
      toast({ title: 'Preview failed', description: 'Try rephrasing the rule', variant: 'destructive' });
    } finally {
      setIsLoadingImpact(false);
    }
  };

  // Save (or apply) rule — handles both create (POST) and edit (PATCH)
  const handleSaveRule = async (applyNow = false) => {
    const description = getDescription();
    if (!description) {
      toast({ title: 'Nothing to save', description: 'Build or type a rule first', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const isEditing = !!editingRuleId;
      const url = isEditing ? `/api/adjustment-rules/${editingRuleId}` : '/api/adjustment-rules';
      const method = isEditing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, preview: false, locationId: locationId || null, serviceLine: serviceLine || null }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      await fetchRules();
      setAiInput('');
      setConditions([defaultCondition()]);
      setRuleAction(defaultAction());
      setImpactData(null);
      setEditingRuleId(null);
      setEditingRuleName('');
      toast({
        title: isEditing ? 'Rule updated' : applyNow ? 'Rule applied' : 'Rule saved',
        description: `"${data.rule?.name}" affects ${data.affectedUnits || 0} units`,
      });
    } catch {
      toast({ title: editingRuleId ? 'Failed to update rule' : 'Failed to save rule', description: 'Please try again', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = () => {
    setAiInput('');
    setConditions([defaultCondition()]);
    setRuleAction(defaultAction());
    setImpactData(null);
    setEditingRuleId(null);
    setEditingRuleName('');
  };

  const startEdit = (rule: AdjustmentRule) => {
    setEditingRuleId(rule.id);
    setEditingRuleName(rule.name);
    setImpactData(null);

    // ── Hydrate ruleAction from stored action ──────────────────────────────
    const action = rule.action as any;
    const adjValue: number = action?.adjustmentValue ?? 0;
    const adjType: string = action?.adjustmentType ?? 'percentage';
    const hydratedAction: RuleAction = {
      type: adjValue >= 0 ? 'increase_rate' : 'decrease_rate',
      amountType: adjType === 'percentage' ? 'percent' : 'dollar',
      amountValue: String(Math.abs(adjValue)),
      scope: (() => {
        const f = action?.filters ?? {};
        if (f.vacancyDuration) return 'Units with days vacant above threshold';
        if (f.roomType?.length) return 'Selected room type';
        if (f.occupancyStatus === 'vacant') return 'Vacant units only';
        return 'All selected campuses';
      })(),
    };
    setRuleAction(hydratedAction);

    // ── Hydrate conditions from stored trigger ─────────────────────────────
    const trigger = rule.trigger as any;
    const rebuilt: Condition[] = [];

    if (trigger?.type === 'condition') {
      // New parser format: trigger.condition (singular)
      if (trigger.condition?.field === 'occupancy') {
        const opMap: Record<string, string> = {
          '<': 'is less than', '>': 'is greater than',
          '<=': 'is less than or equal to', '>=': 'is greater than or equal to',
          '=': 'equals', '!=': 'does not equal',
        };
        rebuilt.push({
          id: newConditionId(),
          metric: 'Campus Occupancy',
          timePeriod: 'Current Month',
          operator: opMap[trigger.condition.operator] ?? 'is less than',
          // Parser stores as decimal (e.g. 0.85); convert back to readable percent
          value: String(Math.round((trigger.condition.value as number) * 100)),
        });
      } else if (trigger.condition?.field === 'days_vacant') {
        rebuilt.push({
          id: newConditionId(),
          metric: 'Days Vacant',
          timePeriod: 'Current Spot',
          operator: trigger.condition.operator === '>=' ? 'is greater than or equal to' : 'is greater than',
          value: String(trigger.condition.value),
        });
      }

      // Legacy format: trigger.conditions (plural) used by evaluateTrigger
      const tc = trigger.conditions ?? {};
      if (!trigger.condition && tc.occupancyStatus) {
        rebuilt.push({
          id: newConditionId(),
          metric: 'Campus Occupancy',
          timePeriod: 'Current Month',
          operator: tc.occupancyStatus === 'vacant' ? 'is less than' : 'is greater than or equal to',
          value: '85',
        });
      }
      if (tc.vacancyDuration) {
        rebuilt.push({
          id: newConditionId(),
          metric: 'Days Vacant',
          timePeriod: 'Current Spot',
          operator: tc.vacancyDuration.operator === '>=' ? 'is greater than or equal to' : 'is greater than',
          value: String(tc.vacancyDuration.days),
        });
      }
    }

    setConditions(rebuilt.length > 0 ? rebuilt : [defaultCondition()]);

    // Also pre-fill the AI tab text as fallback
    setAiInput(rule.description || rule.name || '');
    setActiveTab('structured');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleRule = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/adjustment-rules/${ruleId}/toggle`, { method: 'PATCH' });
      if (!res.ok) throw new Error();
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, isActive: !r.isActive } : r));
    } catch {
      toast({ title: 'Failed to update rule', variant: 'destructive' });
    }
  };

  const deleteRule = async (ruleId: string, name: string) => {
    try {
      const res = await fetch(`/api/adjustment-rules/${ruleId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setRules(prev => prev.filter(r => r.id !== ruleId));
      toast({ title: 'Rule deleted', description: `"${name}" removed` });
    } catch {
      toast({ title: 'Failed to delete rule', variant: 'destructive' });
    }
  };

  // Condition helpers
  const addCondition = () => setConditions(prev => [...prev, defaultCondition()]);
  const removeCondition = (id: string) => setConditions(prev => prev.filter(c => c.id !== id));
  const updateCondition = (id: string, field: keyof Condition, value: string) =>
    setConditions(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  const duplicateCondition = (id: string) => {
    const idx = conditions.findIndex(c => c.id === id);
    if (idx < 0) return;
    const copy = { ...conditions[idx], id: newConditionId() };
    const next = [...conditions];
    next.splice(idx + 1, 0, copy);
    setConditions(next);
  };

  // Derived values
  const description = getDescription();
  const validationMsgs = computeValidation(conditions, ruleAction, activeTab, aiInput);
  const isComplete = activeTab === 'ask-ai' ? !!aiInput.trim() : !validationMsgs.length;
  const actionLabel = ACTIONS.find(a => a.value === ruleAction.type)?.label || '';

  const structuredPreview = description
    ? description
    : conditions.filter(c => c.metric).length
      ? buildDescription(conditions, conditionOperator, ruleAction)
      : null;

  return (
    <div className="space-y-6">
      {/* ── Rule Designer Card ── */}
      <Card className="w-full shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wand2 className="h-5 w-5 text-[var(--trilogy-teal)]" />
              Rule Designer
            </CardTitle>
            {(locationName || serviceLine) && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground">Scope:</span>
                {locationName && (
                  <Badge variant="secondary" className="text-xs font-medium gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--trilogy-teal)] inline-block" />
                    {locationName}
                  </Badge>
                )}
                {serviceLine && (
                  <Badge className="text-xs font-medium bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal)] border-[var(--trilogy-teal)]/20" variant="outline">
                    {serviceLine}
                  </Badge>
                )}
              </div>
            )}
          </div>
          <CardDescription>
            {locationName || serviceLine
              ? `Rules will apply to ${[locationName, serviceLine].filter(Boolean).join(' · ')} only. Preview math reflects this scope.`
              : 'Build pricing rules using natural language or structured IF / THEN logic.'}
          </CardDescription>
          {editingRuleId && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-300">
              <Pencil className="h-3.5 w-3.5 shrink-0" />
              <span className="text-xs font-medium">Editing: "{editingRuleName}"</span>
              <Button variant="ghost" size="sm" className="ml-auto h-5 px-2 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-100" onClick={handleClear}>
                Cancel
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent>
          <div className="grid gap-6 lg:grid-cols-2">

            {/* ── LEFT: Builder ── */}
            <div className="space-y-4">
              <Tabs value={activeTab} onValueChange={v => { setActiveTab(v as any); setImpactData(null); }}>
                <TabsList className="w-full">
                  <TabsTrigger value="ask-ai" className="flex-1 gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" /> Ask AI
                  </TabsTrigger>
                  <TabsTrigger value="structured" className="flex-1 gap-1.5">
                    <ChevronRight className="h-3.5 w-3.5" /> Structured Builder
                  </TabsTrigger>
                </TabsList>

                {/* ── ASK AI TAB ── */}
                <TabsContent value="ask-ai" className="mt-4 space-y-4">
                  <div className="relative">
                    <Textarea
                      value={aiInput}
                      onChange={e => setAiInput(e.target.value)}
                      placeholder="Type or speak a pricing rule, e.g. 'If campus occupancy drops below 85%, reduce rates by 3%.'"
                      className="min-h-[110px] pr-14 resize-none text-sm"
                      data-testid="input-rule-text"
                    />
                    <Button
                      size="icon"
                      variant={isRecording ? 'destructive' : 'secondary'}
                      className="absolute bottom-2 right-2 h-8 w-8"
                      onClick={toggleRecording}
                      aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
                      data-testid="button-microphone"
                    >
                      {isRecording ? <MicOff className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4" />}
                    </Button>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Try an example:</p>
                    <div className="flex flex-wrap gap-2">
                      {EXAMPLE_RULES.map((ex, i) => (
                        <button
                          key={i}
                          onClick={() => setAiInput(ex)}
                          className="text-xs px-3 py-1.5 rounded-full border border-border bg-muted/40 hover:bg-muted/80 hover:border-[var(--trilogy-teal)] transition-colors text-muted-foreground hover:text-foreground"
                          data-testid={`button-example-${i}`}
                        >
                          "{ex}"
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100">
                    <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-blue-700">
                      AI will parse your rule and show an interpreted preview before saving. Always review before applying.
                    </p>
                  </div>
                </TabsContent>

                {/* ── STRUCTURED BUILDER TAB ── */}
                <TabsContent value="structured" className="mt-4 space-y-5">

                  {/* IF block */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--trilogy-dark-blue)] uppercase tracking-wide w-10">IF</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>

                    <div className="space-y-2 pl-2">
                      {conditions.map((cond, idx) => (
                        <div key={cond.id} className="space-y-2">
                          {idx > 0 && (
                            <div className="flex items-center gap-2 pl-2">
                              <button
                                onClick={() => setConditionOperator(conditionOperator === 'AND' ? 'OR' : 'AND')}
                                className="text-xs font-bold px-3 py-1 rounded-full border border-[var(--trilogy-teal)] text-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/10 transition-colors"
                              >
                                {conditionOperator}
                              </button>
                              <div className="h-px flex-1 bg-border/60" />
                            </div>
                          )}

                          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <Select value={cond.metric} onValueChange={v => updateCondition(cond.id, 'metric', v)}>
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Metric" />
                                </SelectTrigger>
                                <SelectContent>
                                  {METRICS.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                                </SelectContent>
                              </Select>

                              <Select value={cond.timePeriod} onValueChange={v => updateCondition(cond.id, 'timePeriod', v)}>
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Time Period" />
                                </SelectTrigger>
                                <SelectContent>
                                  {TIME_PERIODS.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <Select value={cond.operator} onValueChange={v => updateCondition(cond.id, 'operator', v)}>
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Operator" />
                                </SelectTrigger>
                                <SelectContent>
                                  {OPERATORS.map(op => <SelectItem key={op} value={op} className="text-xs">{op}</SelectItem>)}
                                </SelectContent>
                              </Select>

                              <Input
                                value={cond.value}
                                onChange={e => updateCondition(cond.id, 'value', e.target.value)}
                                placeholder="Value (e.g. 85%)"
                                className="h-8 text-xs"
                              />
                            </div>

                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => duplicateCondition(cond.id)} title="Duplicate condition">
                                <Copy className="h-3 w-3" />
                              </Button>
                              {conditions.length > 1 && (
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeCondition(cond.id)} title="Remove condition">
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}

                      <Button variant="outline" size="sm" onClick={addCondition} className="text-xs gap-1.5 mt-1">
                        <Plus className="h-3.5 w-3.5" /> Add Condition
                      </Button>
                    </div>
                  </div>

                  {/* THEN block */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--trilogy-teal)] uppercase tracking-wide w-10">THEN</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>

                    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 ml-2">
                      <Select value={ruleAction.type} onValueChange={v => setRuleAction(prev => ({ ...prev, type: v }))}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Pricing action" />
                        </SelectTrigger>
                        <SelectContent>
                          {ACTIONS.map(a => <SelectItem key={a.value} value={a.value} className="text-xs">{a.label}</SelectItem>)}
                        </SelectContent>
                      </Select>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex rounded-md border border-border overflow-hidden text-xs">
                          {(['percent', 'dollar'] as const).map(t => (
                            <button
                              key={t}
                              onClick={() => setRuleAction(prev => ({ ...prev, amountType: t }))}
                              className={`flex-1 py-1.5 font-medium transition-colors ${ruleAction.amountType === t ? 'bg-[var(--trilogy-teal)] text-white' : 'bg-background text-muted-foreground hover:bg-muted'}`}
                            >
                              {t === 'percent' ? '%' : '$'}
                            </button>
                          ))}
                        </div>
                        <Input
                          value={ruleAction.amountValue}
                          onChange={e => setRuleAction(prev => ({ ...prev, amountValue: e.target.value }))}
                          placeholder={ruleAction.amountType === 'percent' ? 'e.g. 3' : 'e.g. 100'}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Apply to:</p>
                        <Select value={ruleAction.scope} onValueChange={v => setRuleAction(prev => ({ ...prev, scope: v }))}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select scope" />
                          </SelectTrigger>
                          <SelectContent>
                            {SCOPES.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* ── RIGHT: Preview Panel ── */}
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-slate-50/50 p-4 space-y-4 h-full">

                {/* Plain English Summary */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Rule Summary</p>
                  {description ? (
                    <p className="text-sm text-foreground leading-relaxed">"{description}"</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">Build a rule to see the summary here.</p>
                  )}
                </div>

                {/* Structured IF/THEN preview */}
                {activeTab === 'structured' && (conditions.some(c => c.value || c.metric) || ruleAction.amountValue) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Logic Preview</p>
                    <div className="rounded-lg bg-white border border-border p-3 text-xs font-mono space-y-1">
                      <div className="text-blue-700 font-semibold">IF</div>
                      {conditions.map((c, i) => (
                        <div key={c.id} className="pl-3 text-gray-700">
                          {i > 0 && <span className="text-orange-600 font-semibold">{conditionOperator} </span>}
                          <span className="text-purple-700">{c.metric}</span>
                          {c.timePeriod && <span className="text-gray-500"> ({c.timePeriod})</span>}
                          {' '}<span className="text-gray-900">{c.operator}</span>
                          {c.value && <span className="text-green-700"> {c.value}</span>}
                        </div>
                      ))}
                      <div className="text-[var(--trilogy-teal)] font-semibold pt-1">THEN</div>
                      <div className="pl-3 text-gray-700">
                        <span className="text-purple-700">{actionLabel || 'action'}</span>
                        {ruleAction.amountValue && (
                          <span className="text-green-700"> {ruleAction.amountType === 'percent' ? `${ruleAction.amountValue}%` : `$${ruleAction.amountValue}`}</span>
                        )}
                        {ruleAction.scope && <span className="text-gray-500"> → {ruleAction.scope.toLowerCase()}</span>}
                      </div>
                    </div>
                  </div>
                )}

                {/* Validation */}
                {validationMsgs.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Validation</p>
                    {validationMsgs.map((msg, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        {msg}
                      </div>
                    ))}
                  </div>
                )}

                {/* Impact Preview */}
                {impactData && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estimated Impact</p>
                      {impactData.confidence && (
                        <Badge
                          variant="outline"
                          className={`text-xs ${impactData.confidence === 'high' ? 'border-green-400 text-green-700 bg-green-50' : impactData.confidence === 'medium' ? 'border-amber-400 text-amber-700 bg-amber-50' : 'border-red-400 text-red-700 bg-red-50'}`}
                        >
                          {impactData.confidence === 'high' ? '✓ High confidence' : impactData.confidence === 'medium' ? '⚡ Medium confidence' : '⚠ Needs review'}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Units affected', value: impactData.affectedUnits?.toLocaleString() },
                        { label: 'Monthly impact', value: `$${Math.round(impactData.monthlyImpact || 0).toLocaleString()}` },
                        { label: 'Annual impact', value: `$${Math.round(impactData.annualImpact || 0).toLocaleString()}` },
                        { label: 'Annual (5% vol.↑)', value: `$${Math.round(impactData.volumeAdjustedAnnualImpact || 0).toLocaleString()}` },
                      ].map(({ label, value }) => (
                        <div key={label} className="rounded-lg bg-white border border-border p-2.5 text-center">
                          <div className="text-sm font-semibold text-[var(--trilogy-dark-blue)]">{value}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
                        </div>
                      ))}
                    </div>
                    {impactData.reasonabilityCheck && (
                      <div className={`text-xs rounded-md px-3 py-2 ${impactData.reasonabilityCheck.isReasonable ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                        <span className="font-medium">AI Assessment:</span> {impactData.reasonabilityCheck.explanation}
                      </div>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="pt-2 space-y-2">
                  <Button
                    variant="outline"
                    className="w-full gap-2 text-sm"
                    onClick={handlePreviewImpact}
                    disabled={!description || isLoadingImpact}
                  >
                    <Eye className="h-4 w-4" />
                    {isLoadingImpact ? 'Calculating…' : 'Preview Impact'}
                  </Button>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      className="gap-2 text-sm bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/90 text-white"
                      onClick={() => handleSaveRule(false)}
                      disabled={!description || isSaving}
                      data-testid="button-save-rule"
                    >
                      <Save className="h-4 w-4" />
                      {isSaving ? (editingRuleId ? 'Updating…' : 'Saving…') : (editingRuleId ? 'Update Rule' : 'Save Rule')}
                    </Button>
                    {!editingRuleId && (
                      <Button
                        variant="outline"
                        className="gap-2 text-sm"
                        onClick={() => handleSaveRule(true)}
                        disabled={!description || isSaving}
                        data-testid="button-apply-rule"
                      >
                        <Play className="h-4 w-4" />
                        Apply Rule
                      </Button>
                    )}
                    {editingRuleId && (
                      <Button
                        variant="outline"
                        className="gap-2 text-sm"
                        onClick={handleClear}
                        disabled={isSaving}
                      >
                        <X className="h-4 w-4" />
                        Cancel Edit
                      </Button>
                    )}
                  </div>
                  {!editingRuleId && (
                    <Button variant="ghost" size="sm" className="w-full text-muted-foreground text-xs gap-1.5" onClick={handleClear}>
                      <X className="h-3.5 w-3.5" /> Clear
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Rules Panel ── */}
      {rules.length > 0 && (() => {
        const activeRules = rules.filter(r => r.isActive);
        const disabledRules = rules.filter(r => !r.isActive);
        const activeCount = activeRules.length;

        // Combined portfolio impact across all active rules
        const combinedUnits = activeRules.reduce((s, r) => s + (r.affectedUnits ?? 0), 0);
        const combinedCampuses = activeRules.reduce((s, r) => s + (r.affectedCampuses ?? 0), 0);
        const combinedAnnual = activeRules.reduce((s, r) => s + (r.annualImpact ?? 0), 0);

        const sortedRules = [...activeRules.slice().reverse(), ...disabledRules.slice().reverse()];

        const fmtImpact = (v: number) => {
          const abs = Math.abs(v);
          const sign = v >= 0 ? '+' : '-';
          if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
          if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
          return `${sign}$${abs.toLocaleString()}`;
        };

        return (
          <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
            <Card className="w-full shadow-sm">
              <CollapsibleTrigger asChild>
                <CardHeader className="pb-2 cursor-pointer select-none hover:bg-muted/30 rounded-t-lg transition-colors">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[var(--trilogy-teal)]" />
                      Rules
                      {activeCount > 0
                        ? <Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700/50 text-xs">{activeCount} active</Badge>
                        : <Badge variant="secondary" className="text-xs">none active</Badge>
                      }
                      {disabledRules.length > 0 && (
                        <Badge variant="secondary" className="text-xs text-muted-foreground">{disabledRules.length} off</Badge>
                      )}
                    </CardTitle>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${rulesOpen ? '' : '-rotate-90'}`} />
                  </div>
                  <CardDescription className="text-xs">
                    Select rules to apply during the next pricing round. Impact reflects expected new admissions.
                  </CardDescription>
                </CardHeader>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <CardContent className="pt-0 pb-3">

                  {/* Combined impact summary bar */}
                  {activeCount > 0 && (
                    <div className="mb-3 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700/40 px-3 py-2.5 flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5 text-teal-700 dark:text-teal-300">
                        <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-xs font-semibold">Combined Portfolio Impact</span>
                      </div>
                      <div className="flex gap-3 flex-wrap text-xs">
                        <span className="text-muted-foreground dark:text-gray-400">
                          <span className="font-medium text-foreground dark:text-gray-200">{combinedCampuses}</span> campuses
                        </span>
                        <span className="text-muted-foreground dark:text-gray-400">
                          <span className="font-medium text-foreground dark:text-gray-200">{combinedUnits.toLocaleString()}</span> units
                        </span>
                        <span className={`font-semibold ${combinedAnnual >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {fmtImpact(combinedAnnual)}/yr
                        </span>
                        <span className="text-muted-foreground dark:text-gray-500 italic">new admissions only</span>
                      </div>
                    </div>
                  )}

                  <div className="max-h-80 overflow-y-auto divide-y divide-border/30">
                    {sortedRules.map((rule) => {
                      const impact = rule.annualImpact ?? 0;
                      const isPositive = impact >= 0;
                      const hasCampuses = (rule.affectedCampuses ?? 0) > 0;
                      const hasUnits = (rule.affectedUnits ?? 0) > 0;
                      const hasImpact = impact !== 0;

                      return (
                        <div
                          key={rule.id}
                          className={`flex items-start gap-3 py-3 px-1 transition-colors ${rule.isActive ? '' : 'opacity-55'}`}
                          data-testid={`rule-${rule.id}`}
                        >
                          {/* Status dot */}
                          <div className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${rule.isActive ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'}`} />

                          {/* Name + description + stat chips */}
                          <div className="flex-1 min-w-0 space-y-1">
                            <p className={`text-sm font-semibold leading-snug ${rule.isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                              {rule.name}
                            </p>
                            {rule.description && (
                              <p className="text-xs text-muted-foreground dark:text-gray-400 leading-relaxed line-clamp-2">
                                {rule.description}
                              </p>
                            )}
                            {/* Stat chips row */}
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {hasCampuses && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  {rule.affectedCampuses} campuses
                                </span>
                              )}
                              {hasUnits && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  {(rule.affectedUnits ?? 0).toLocaleString()} units
                                </span>
                              )}
                              {hasImpact && (
                                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold
                                  ${isPositive
                                    ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                                  {isPositive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                                  {fmtImpact(impact)}/yr
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Toggle + actions — stacked vertically to save horizontal space */}
                          <div className="shrink-0 flex flex-col items-center gap-1">
                            <Switch
                              checked={rule.isActive}
                              onCheckedChange={() => toggleRule(rule.id)}
                              aria-label={`Toggle ${rule.name}`}
                              data-testid={`switch-rule-${rule.id}`}
                            />
                            <div className="flex gap-0.5">
                              <Button
                                variant="ghost" size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-[var(--trilogy-teal)]"
                                onClick={() => startEdit(rule)}
                                title="Edit rule"
                                data-testid={`button-edit-${rule.id}`}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost" size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteRule(rule.id, rule.name)}
                                title="Delete rule"
                                data-testid={`button-delete-${rule.id}`}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })()}
    </div>
  );
}

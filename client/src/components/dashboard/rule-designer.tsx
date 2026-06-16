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
  Info, Eye, Save, X, Wand2, ArrowRight, Download
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
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
  const [infoRule, setInfoRule] = useState<AdjustmentRule | null>(null);
  const [bubbleMapOpen, setBubbleMapOpen] = useState(false);
  const [hoveredBubble, setHoveredBubble] = useState<string | null>(null);

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

  const toggleAdditive = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/adjustment-rules/${ruleId}/additive`, { method: 'PATCH' });
      if (!res.ok) throw new Error();
      setRules(prev => prev.map(r => {
        if (r.id !== ruleId) return r;
        const act = (r.action as any) || {};
        return { ...r, action: { ...act, isAdditive: !act.isAdditive } };
      }));
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
        const activeRules   = rules.filter(r => r.isActive);
        const disabledRules = rules.filter(r => !r.isActive);
        const activeCount   = activeRules.length;

        // Priority-ordered active rules: exclusive rules compete for units; additive always stack
        const sortedActive   = [...activeRules].reverse(); // oldest first → priority 1, 2, 3...
        const sortedDisabled = [...disabledRules].reverse();
        const sortedRules    = [...sortedActive, ...sortedDisabled];

        const exclusiveActive = sortedActive.filter(r => !(r.action as any)?.isAdditive);
        const additiveActive  = sortedActive.filter(r =>  (r.action as any)?.isAdditive);
        const hasOverlap      = exclusiveActive.length > 1;

        // Combined impact: additive rules always count; exclusive: sum all (may overlap — noted in UI)
        const combinedUnits    = sortedActive.reduce((s, r) => s + (r.affectedUnits    ?? 0), 0);
        const combinedCampuses = sortedActive.reduce((s, r) => s + (r.affectedCampuses ?? 0), 0);
        const combinedMonthly  = sortedActive.reduce((s, r) => s + (r.monthlyImpact    ?? 0), 0);
        const combinedAnnual   = sortedActive.reduce((s, r) => s + (r.annualImpact     ?? 0), 0);

        const fmt = (v: number) => {
          const abs = Math.abs(v);
          const sign = v >= 0 ? '+' : '-';
          if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
          if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(0)}K`;
          return `${sign}$${Math.round(abs).toLocaleString()}`;
        };

        const monthsToDecember = 6;

        const exportRules = async () => {
          try {
            const params = new URLSearchParams();
            if (locationId) params.set('locationId', locationId);
            if (serviceLine) params.set('serviceLine', serviceLine);
            const res = await fetch(`/api/adjustment-rules/export${params.toString() ? '?' + params : ''}`);
            if (!res.ok) throw new Error();
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = 'rules-impact-detail.csv'; a.click();
            URL.revokeObjectURL(url);
          } catch {
            toast({ title: 'Export failed', variant: 'destructive' });
          }
        };

        // Golden-angle spiral dots for bubble map
        const genDots = (count: number, radius: number) => {
          const n = Math.min(count, 64);
          return Array.from({ length: n }, (_, i) => {
            const theta = i * 2.39996; // golden angle
            const r     = Math.sqrt((i + 0.5) / n) * (radius - 7);
            return { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
          });
        };

        // Assign a unique hue per rule for the bubble map
        const PALETTE = ['#0d9488','#7c3aed','#d97706','#0284c7','#16a34a','#dc2626','#9333ea','#ea580c'];

        return (
          <>
            <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
              <Card className="w-full shadow-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-2 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-800/40 rounded-t-lg transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CheckCircle2 className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" />
                        <span className="text-base font-semibold text-gray-900 dark:text-white">Rules</span>
                        {activeCount > 0
                          ? <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 border border-green-200 px-2 py-0.5 text-xs font-medium">{activeCount} active</span>
                          : <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-500 border border-gray-200 px-2 py-0.5 text-xs font-medium">none active</span>
                        }
                        {disabledRules.length > 0 && (
                          <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-500 border border-gray-200 px-2 py-0.5 text-xs font-medium">{disabledRules.length} off</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {activeCount > 0 && (
                          <Button
                            variant="outline" size="sm"
                            className="h-7 text-xs gap-1.5 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700 bg-teal-50 dark:bg-teal-950/40 hover:bg-teal-100"
                            onClick={e => { e.stopPropagation(); setBubbleMapOpen(true); }}
                            title="View bubble map of rule coverage"
                          >
                            <Eye className="h-3 w-3" />
                            Bubble Map
                          </Button>
                        )}
                        <Button
                          variant="outline" size="sm"
                          className="h-7 text-xs gap-1.5 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50"
                          onClick={e => { e.stopPropagation(); exportRules(); }}
                        >
                          <Download className="h-3 w-3" />
                          Export CSV
                        </Button>
                        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${rulesOpen ? '' : '-rotate-90'}`} />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Select rules to apply during the next pricing round. Impact reflects expected new admissions
                      {(locationId || serviceLine)
                        ? ` filtered to ${locationName || 'selected location'}${serviceLine ? ` · ${serviceLine}` : ''}.`
                        : ' across all campuses.'}
                    </p>
                  </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="pt-0 pb-4 px-4">

                    {/* ── Combined active rules summary ── */}
                    {activeCount > 0 && (
                      <div className="mb-4 rounded-lg border border-teal-200 dark:border-teal-700/60 bg-teal-50 dark:bg-teal-950/30 p-3">
                        <div className="flex items-center justify-between mb-2.5 gap-2 flex-wrap">
                          <p className="text-xs font-semibold text-teal-700 dark:text-teal-300 flex items-center gap-1.5">
                            <TrendingUp className="h-3.5 w-3.5 shrink-0" />
                            Combined Impact — {activeCount} Active Rule{activeCount > 1 ? 's' : ''}
                            <span className="font-normal text-teal-600 dark:text-teal-400">· new admissions only</span>
                          </p>
                          {hasOverlap && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/50 rounded-full px-2 py-0.5">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              {exclusiveActive.length} exclusive rules share units — priority order applies
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {[
                            { label: 'Campuses', value: combinedCampuses.toLocaleString(), money: false },
                            { label: 'Units',    value: combinedUnits.toLocaleString(),    money: false },
                            { label: '/Month',   value: fmt(combinedMonthly),              money: true  },
                            { label: '/Year',    value: fmt(combinedAnnual),               money: true  },
                          ].map(({ label, value, money }) => (
                            <div key={label} className="rounded-md bg-white dark:bg-gray-800 border border-teal-100 dark:border-teal-800/50 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold mb-0.5">{label}</p>
                              <p className={`text-sm font-bold ${money ? (combinedAnnual >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400') : 'text-gray-900 dark:text-white'}`}>
                                {value}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── Rule list ── */}
                    <div className="space-y-2">
                      {sortedRules.map((rule, idx) => {
                        const annual     = rule.annualImpact  ?? 0;
                        const monthly    = rule.monthlyImpact ?? 0;
                        const isPos      = annual >= 0;
                        const isAdditive = !!(rule.action as any)?.isAdditive;
                        // Priority number only applies to active exclusive rules
                        const exclusivePriority = rule.isActive && !isAdditive
                          ? sortedActive.filter(r => !(r.action as any)?.isAdditive).indexOf(rule) + 1
                          : null;

                        return (
                          <div
                            key={rule.id}
                            className={`rounded-lg border transition-all ${
                              rule.isActive
                                ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800 opacity-60'
                            }`}
                            data-testid={`rule-${rule.id}`}
                          >
                            {/* Top row: priority dot + name + toggle */}
                            <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                {exclusivePriority !== null ? (
                                  <span className="shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold flex items-center justify-center">
                                    {exclusivePriority}
                                  </span>
                                ) : (
                                  <div className={`shrink-0 w-2 h-2 rounded-full ml-1.5 ${rule.isActive ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                                )}
                                <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug truncate">{rule.name}</p>
                                {rule.isActive && (
                                  <span className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium border
                                    ${isAdditive
                                      ? 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-700/50'
                                      : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700/50'}`}>
                                    {isAdditive ? 'stacks' : 'exclusive'}
                                  </span>
                                )}
                              </div>
                              <Switch
                                checked={rule.isActive}
                                onCheckedChange={() => toggleRule(rule.id)}
                                aria-label={`Toggle ${rule.name}`}
                                data-testid={`switch-rule-${rule.id}`}
                                className="shrink-0"
                              />
                            </div>

                            {/* Description */}
                            {rule.description && (
                              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed px-3 pb-1 ml-7">
                                {rule.description}
                              </p>
                            )}

                            {/* Additive toggle */}
                            <label className="flex items-center gap-2 px-3 pb-2 ml-7 cursor-pointer group w-fit">
                              <input
                                type="checkbox"
                                checked={isAdditive}
                                onChange={() => toggleAdditive(rule.id)}
                                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 h-3 w-3"
                              />
                              <span className="text-[11px] text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300 select-none">
                                Apply in addition to other rules
                                {!isAdditive && exclusivePriority !== null && exclusivePriority > 1 && (
                                  <span className="ml-1 text-amber-600 dark:text-amber-400">(currently priority #{exclusivePriority} — units claimed by rule #{1} first)</span>
                                )}
                              </span>
                            </label>

                            {/* Chips + action buttons */}
                            <div className="flex items-center justify-between gap-2 px-3 pb-2.5 ml-7">
                              <div className="flex flex-wrap gap-1.5">
                                {(rule.affectedCampuses ?? 0) > 0 && (
                                  <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-200">
                                    {rule.affectedCampuses} campuses
                                  </span>
                                )}
                                {(rule.affectedUnits ?? 0) > 0 && (
                                  <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-200">
                                    {(rule.affectedUnits ?? 0).toLocaleString()} units
                                  </span>
                                )}
                                {monthly !== 0 && (
                                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold
                                    ${isPos ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'}`}>
                                    {fmt(monthly)}/mo
                                  </span>
                                )}
                                {annual !== 0 && (
                                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold
                                    ${isPos ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'}`}>
                                    {isPos ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                                    {fmt(annual)}/yr
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0">
                                <Button variant="ghost" size="icon"
                                  className="h-7 w-7 text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/30"
                                  onClick={() => setInfoRule(rule)} title="How this rule works">
                                  <Info className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon"
                                  className="h-7 w-7 text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/30"
                                  onClick={() => startEdit(rule)} title="Edit rule"
                                  data-testid={`button-edit-${rule.id}`}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon"
                                  className="h-7 w-7 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30"
                                  onClick={() => deleteRule(rule.id, rule.name)} title="Delete rule"
                                  data-testid={`button-delete-${rule.id}`}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Exclusivity legend */}
                    {activeCount > 1 && (
                      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-3 text-[11px] text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-bold flex items-center justify-center">1</span>
                          Exclusive — first rule in priority order claims overlapping units
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-teal-50 border border-teal-200 flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                          </span>
                          Stacks — applies on top of any other rule
                        </span>
                      </div>
                    )}

                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* ── Bubble Map Dialog ── */}
            <Dialog open={bubbleMapOpen} onOpenChange={setBubbleMapOpen}>
              <DialogContent className="max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                <DialogHeader>
                  <DialogTitle className="text-gray-900 dark:text-white text-base">Rule Coverage — Bubble Map</DialogTitle>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Each circle represents one rule. Circle size is proportional to units affected.
                    Dots inside show unit density (up to 64 sampled). Hover for details.
                  </p>
                </DialogHeader>

                {activeCount === 0 ? (
                  <div className="py-12 text-center text-gray-400 dark:text-gray-500 text-sm">No active rules to display.</div>
                ) : (
                  <div className="flex flex-wrap gap-6 p-4 bg-gray-50 dark:bg-gray-800/40 rounded-lg justify-center items-end mt-2">
                    {sortedActive.map((rule, ri) => {
                      const units      = rule.affectedUnits ?? 0;
                      const radius     = Math.max(44, Math.min(110, Math.sqrt(units) * 2.8));
                      const size       = Math.round(radius) * 2 + 8;
                      const isAdditive = !!(rule.action as any)?.isAdditive;
                      const color      = PALETTE[ri % PALETTE.length];
                      const dots       = genDots(units, radius);
                      const monthly    = rule.monthlyImpact ?? 0;
                      const annual     = rule.annualImpact  ?? 0;
                      const isHovered  = hoveredBubble === rule.id;

                      return (
                        <div
                          key={rule.id}
                          className="relative flex flex-col items-center gap-1.5"
                          onMouseEnter={() => setHoveredBubble(rule.id)}
                          onMouseLeave={() => setHoveredBubble(null)}
                          style={{ cursor: 'default' }}
                        >
                          <svg width={size} height={size} style={{ overflow: 'visible' }}>
                            {/* Outer ring for exclusive rules */}
                            {!isAdditive && (
                              <circle
                                cx={size / 2} cy={size / 2} r={radius + 4}
                                fill="none"
                                stroke={color}
                                strokeWidth={1}
                                strokeDasharray="4 3"
                                opacity={0.4}
                              />
                            )}
                            {/* Main circle */}
                            <circle
                              cx={size / 2} cy={size / 2} r={radius}
                              fill={color}
                              fillOpacity={0.1}
                              stroke={color}
                              strokeWidth={isHovered ? 2.5 : 2}
                            />
                            {/* Unit dots */}
                            {dots.map((dot, di) => (
                              <circle
                                key={di}
                                cx={size / 2 + dot.x}
                                cy={size / 2 + dot.y}
                                r={2}
                                fill={color}
                                opacity={0.55}
                              />
                            ))}
                            {/* Priority number for exclusive */}
                            {!isAdditive && (
                              <text
                                x={size / 2} y={size / 2 - radius + 14}
                                textAnchor="middle"
                                fontSize={11}
                                fontWeight="bold"
                                fill={color}
                                opacity={0.8}
                              >
                                #{sortedActive.filter(r => !(r.action as any)?.isAdditive).indexOf(rule) + 1}
                              </text>
                            )}
                          </svg>

                          {/* Label below */}
                          <div className="text-center" style={{ maxWidth: Math.max(size, 80) }}>
                            <p className="text-xs font-semibold text-gray-800 dark:text-white leading-tight" style={{ maxWidth: 110, wordBreak: 'break-word' }}>
                              {rule.name}
                            </p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400">{units.toLocaleString()} units</p>
                          </div>

                          {/* Hover tooltip */}
                          {isHovered && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none"
                                 style={{ minWidth: 180 }}>
                              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3">
                                <p className="text-xs font-semibold text-gray-900 dark:text-white mb-1">{rule.name}</p>
                                <p className="text-[11px] text-gray-600 dark:text-gray-300 mb-2 leading-snug">{rule.description}</p>
                                <div className="space-y-0.5 text-[11px]">
                                  <div className="flex justify-between gap-4">
                                    <span className="text-gray-500">Units</span>
                                    <span className="font-medium text-gray-900 dark:text-white">{units.toLocaleString()}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-gray-500">Campuses</span>
                                    <span className="font-medium text-gray-900 dark:text-white">{(rule.affectedCampuses ?? 0)}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-gray-500">Monthly</span>
                                    <span className={`font-semibold ${monthly >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(monthly)}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-gray-500">Annual</span>
                                    <span className={`font-semibold ${annual >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(annual)}</span>
                                  </div>
                                  <div className="flex justify-between gap-4 pt-1 border-t border-gray-100 dark:border-gray-800 mt-1">
                                    <span className="text-gray-500">Mode</span>
                                    <span className={`font-medium ${isAdditive ? 'text-teal-700' : 'text-amber-700'}`}>
                                      {isAdditive ? 'Stacks with others' : 'Exclusive (priority)'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              {/* Arrow */}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
                                   style={{ borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '6px solid #e5e7eb' }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Legend */}
                <div className="flex flex-wrap gap-4 text-[11px] text-gray-500 dark:text-gray-400 pt-1 px-1">
                  <span className="flex items-center gap-1.5">
                    <svg width={14} height={14}><circle cx={7} cy={7} r={6} fill="none" stroke="#0d9488" strokeWidth={1.5} /></svg>
                    Stacks (additive)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg width={14} height={14}>
                      <circle cx={7} cy={7} r={6} fill="none" stroke="#d97706" strokeWidth={1.5} strokeDasharray="3 2" />
                    </svg>
                    Exclusive — dashed ring, priority number inside
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg width={10} height={10}><circle cx={5} cy={5} r={3} fill="#6b7280" opacity={0.55} /></svg>
                    Each dot ≈ 1 unit (up to 64 shown)
                  </span>
                </div>
              </DialogContent>
            </Dialog>

            {/* ── Rule Info Dialog ── */}
            {infoRule && (() => {
              const action       = infoRule.action as any;
              const filters      = action?.filters || {};
              const adjType      = action?.adjustmentType || 'percentage';
              const adjValue: number = action?.adjustmentValue ?? 0;
              const rateTarget   = action?.target === 'care_rate' ? 'care rate' : 'street rate';

              const monthly = infoRule.monthlyImpact ?? 0;
              const units   = infoRule.affectedUnits  ?? 0;

              const periods = [
                { label: '1 Month',     months: 1 },
                { label: '3 Months',    months: 3 },
                { label: '6 Months',    months: 6 },
                { label: '12 Months',   months: 12 },
                { label: 'By Dec 2026', months: monthsToDecember, highlight: true },
              ];

              const scopeLines: string[] = [];
              if      (filters.occupancyStatus === 'vacant')   scopeLines.push('Vacant units only');
              else if (filters.occupancyStatus === 'occupied') scopeLines.push('Occupied units only');
              else                                              scopeLines.push('All units (vacant + occupied)');
              if (filters.serviceLine?.length) scopeLines.push(`Service lines: ${(filters.serviceLine as string[]).join(', ')}`);
              else                             scopeLines.push('All service lines');
              if (filters.roomType?.length)    scopeLines.push(`Room types: ${(filters.roomType as string[]).join(', ')}`);
              if (filters.vacancyDuration) {
                const vd = filters.vacancyDuration as { operator: string; days: number };
                scopeLines.push(`Vacant ${vd.operator} ${vd.days} days`);
              }
              if (locationId)   scopeLines.push(`Filtered to: ${locationName || locationId}`);
              if (serviceLine)  scopeLines.push(`Service line filter: ${serviceLine}`);

              const direction = adjValue >= 0 ? 'increases' : 'decreases';
              const amount    = adjType === 'percentage' ? `${Math.abs(adjValue)}%` : `$${Math.abs(adjValue)}`;
              const calcNote  = adjType === 'percentage'
                ? `Monthly impact = (${Math.abs(adjValue)} ÷ 100) × sum of matched ${rateTarget}s across all affected units. Only new move-ins are affected — existing residents keep their contracted rate.`
                : `Monthly impact = $${Math.abs(adjValue)} × number of matched units. Only new move-ins are affected — existing residents keep their contracted rate.`;

              return (
                <Dialog open={!!infoRule} onOpenChange={open => { if (!open) setInfoRule(null); }}>
                  <DialogContent className="max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                    <DialogHeader className="pb-0">
                      <DialogTitle className="text-gray-900 dark:text-white text-base leading-snug">{infoRule.name}</DialogTitle>
                      <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed pt-1">{infoRule.description}</p>
                    </DialogHeader>

                    <div className="space-y-4 mt-1">

                      {/* Applies to */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">Applies To</p>
                        <ul className="space-y-1.5">
                          {scopeLines.map((line, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                              <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" />
                              {line}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Revenue & RevPOR timeline */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
                          Revenue Impact Timeline &mdash; new admissions only
                        </p>
                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300">Period</th>
                                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300">Revenue</th>
                                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300">RevPOR / unit</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                              {periods.map(({ label, months, highlight }) => {
                                const rev    = monthly * months;
                                const revpor = units > 0 ? (monthly / units) * months : 0;
                                const pos    = rev >= 0;
                                return (
                                  <tr key={label} className={highlight ? 'bg-blue-50 dark:bg-blue-950/20' : ''}>
                                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 font-medium">
                                      {label}
                                      {highlight && <span className="ml-1.5 text-[10px] text-blue-600 dark:text-blue-400 font-normal">(6 mo away)</span>}
                                    </td>
                                    <td className={`px-3 py-2 text-sm text-right font-semibold ${pos ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                                      {fmt(rev)}
                                    </td>
                                    <td className={`px-3 py-2 text-sm text-right ${pos ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                                      {units > 0 ? `${pos ? '+' : '-'}$${Math.round(Math.abs(revpor)).toLocaleString()}` : '—'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 italic leading-snug">
                          RevPOR / unit = cumulative rate improvement per affected unit over the period.
                          Revenue = rate delta × affected units × months.
                        </p>
                      </div>

                      {/* How revenue is calculated */}
                      <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">How Revenue is Calculated</p>
                        <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                          This rule <strong className="text-gray-800 dark:text-gray-100">{direction}</strong> the <strong className="text-gray-800 dark:text-gray-100">{rateTarget}</strong> by <strong className="text-gray-800 dark:text-gray-100">{amount}</strong> for each matched unit. {calcNote}
                        </p>
                      </div>

                    </div>
                  </DialogContent>
                </Dialog>
              );
            })()}
          </>
        );
      })()}
    </div>
  );
}

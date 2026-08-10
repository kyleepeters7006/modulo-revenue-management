import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Mic, MicOff, Sparkles, Play, CheckCircle2,
  Trash2, Plus, ChevronDown, Copy, Pencil, TrendingDown, TrendingUp, AlertTriangle, StickyNote,
  Info, Eye, Save, X, Wand2, Download, SlidersHorizontal, Layers, History, FileBarChart, PowerOff
} from 'lucide-react';
import { HistoryReportModal } from '@/components/dashboard/pricing-reports';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { isRuleAdditive, isRuleExclusive, exclusivePriority } from '@shared/ruleStacking';

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
  'In House to Street Rate var % - Single Occupant',
  'Street Rate to Top Comp Var %',
  'Revenue Growth Target', 'Price Elasticity',
  'Days To Sell Before', 'Days To Sell After', 'Days To Sell Change',
];

// Maps backend trigger field names -> structured-builder metric labels for the
// rules-pivot metrics, so editing an existing rule rehydrates these conditions.
const NEW_METRIC_FIELDS: Record<string, string> = {
  revenue_growth_target: 'Revenue Growth Target',
  growth_target: 'Revenue Growth Target',
  price_elasticity: 'Price Elasticity',
  elasticity: 'Price Elasticity',
  days_to_sell_before: 'Days To Sell Before',
  days_to_sell_after: 'Days To Sell After',
  days_to_sell_change: 'Days To Sell Change',
};

const TIME_PERIODS = ['Current Spot', 'Current Month', 'Trailing 3', 'Trailing 6', 'Trailing 12'];
const ALL_SERVICE_LINES = ['AL', 'AL/MC', 'IL', 'SL', 'HC', 'HC/MC', 'VIL'] as const;

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
  steadyStateAnnualImpact?: number;
  volumeAdjustedAnnualImpact?: number;
  trigger?: unknown;
  action?: unknown;
  effectiveDate?: string | null;
  createdAt?: string | null;
  isHistorical?: boolean;
  locationId?: string | null;
  serviceLine?: string | null;
  category?: string;
}

// Strategy group labels — kept in lockstep with the Rule Performance section
const ADMIN_CATEGORY_LABELS: Record<string, string> = {
  'push': 'High Occ — Below Market',
  'hold': 'High Occ — Above Market',
  'ih-below-street': 'High Occ — In-House Below Street',
  'ensure': 'Street Rate Catch-Up — Below In-House',
  'concession-al': 'Low AL/MC Occ — Rate Concession',
  'concession-sl': 'Low SL/VIL Occ — Market Align',
  'apr-push': 'Apr 2026 — Push (Below Comps)',
  'apr-hold': 'Apr 2026 — Hold (Above Comps)',
  'apr-qmix': 'Apr 2026 — HC Q-Mix',
  'apr-decrease': 'Apr 2026 — Decrease',
  'apr-custom': 'Apr 2026 — Campus-Specific',
};

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
    if (conditions.some(c => c.metric === 'Competitor Rate' || c.metric === 'Street Rate to Top Comp Var %'))
      msgs.push('This rule uses competitor data — confirm adjusted competitor rates are available for all campuses.');
    if (action.scope === 'All selected campuses' || !action.scope)
      msgs.push('This rule applies broadly. Confirm before applying.');
  } else {
    if (!aiInput.trim()) msgs.push('Enter or speak a rule to get started.');
  }
  return msgs;
}

interface T3MoveIns {
  byServiceLine: Record<string, number>;
  campus: number;
  monthsUsed: number;
  asOf: string | null;
}

export interface SuggestionToEdit {
  description: string;
  serviceLines?: string[];
}

export interface RuleDesignerHelpers {
  /** Load an AI suggestion into the Natural Language editor for tweaking. */
  editSuggestion: (s: SuggestionToEdit) => void;
  /** Open the designer on the AI generator tab and scroll it into view. */
  showAiGenerator: () => void;
  /** Re-fetch the rules list (Rule Administration) — call after creating a rule outside the designer, e.g. accepting an AI suggestion. */
  refreshRules: () => void;
}

interface RuleDesignerProps {
  locationId?: string;
  serviceLine?: string;
  locationName?: string;
  /** Either a ReactNode, or a render function receiving helpers (e.g. to load an AI suggestion into the Natural Language editor). */
  aiGenerator?: React.ReactNode | ((helpers: RuleDesignerHelpers) => React.ReactNode);
}

export function RuleDesigner({ locationId, serviceLine, locationName, aiGenerator: aiGeneratorProp }: RuleDesignerProps) {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'ask-ai' | 'structured' | 'ai-generator'>('structured');
  const [designerOpen, setDesignerOpen] = useState(false);
  const designerCardRef = useRef<HTMLDivElement>(null);
  const [aiInput, setAiInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [rules, setRules] = useState<AdjustmentRule[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [impactData, setImpactData] = useState<ImpactData | null>(null);
  const [isLoadingImpact, setIsLoadingImpact] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleName, setEditingRuleName] = useState<string>('');
  const [editingRuleSLs, setEditingRuleSLs] = useState<string[]>([]);
  const [newRuleSLs, setNewRuleSLs] = useState<string[]>([]);
  const [effectiveDate, setEffectiveDate] = useState<string>(''); // '' = effective immediately (YYYY-MM-DD)
  const [saveAsHistorical, setSaveAsHistorical] = useState(false); // true = record of a past change; never applied to current rates
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFrom, setHistoryFrom] = useState<string>(`${new Date().getFullYear()}-01-01`); // Pricing History review defaults to Jan 1
  const [historyRules, setHistoryRules] = useState<AdjustmentRule[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyReportOpen, setHistoryReportOpen] = useState(false);
  const [stackRule, setStackRule] = useState(true); // true = stacks with other rules; false = exclusive
  const [slPickerOpen, setSlPickerOpen] = useState(false);
  const [newSlPickerOpen, setNewSlPickerOpen] = useState(false);
  const slPickerRef = useRef<HTMLDivElement>(null);
  const newSlPickerRef = useRef<HTMLDivElement>(null);
  const newSlPickerAiRef = useRef<HTMLDivElement>(null);
  const [infoRule, setInfoRule] = useState<AdjustmentRule | null>(null);

  // Load an AI-suggested rule into the Natural Language editor for tweaking
  // before saving (invoked from the AI Rule Generator's Edit button).
  const editSuggestion = useCallback((s: SuggestionToEdit) => {
    setDesignerOpen(true);
    setActiveTab('ask-ai');
    setAiInput(s.description || '');
    setNewRuleSLs(Array.isArray(s.serviceLines) ? s.serviceLines : []);
    setImpactData(null);
    // Wait for the tab switch to render, then bring the editor into view.
    setTimeout(() => designerCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, []);

  // Open the designer on the AI generator tab and scroll it into view
  // (used by "Draft rule" buttons elsewhere on the page).
  const showAiGenerator = useCallback(() => {
    setDesignerOpen(true);
    setActiveTab('ai-generator');
    setTimeout(() => designerCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, []);

  // Stable indirection to fetchRules (defined below) so the helpers object can
  // be built here without a temporal-dead-zone reference.
  const fetchRulesRef = useRef<() => void>(() => {});
  const refreshRules = useCallback(() => fetchRulesRef.current(), []);

  const aiGenerator = typeof aiGeneratorProp === 'function'
    ? aiGeneratorProp({ editSuggestion, showAiGenerator, refreshRules })
    : aiGeneratorProp;

  // Rule Administration filters (mirrors the Rule Performance section)
  const [adminFrom, setAdminFrom] = useState<string>('');
  const [adminTo, setAdminTo] = useState<string>('');
  const [adminGroupBy, setAdminGroupBy] = useState<'none' | 'strategy' | 'rule' | 'serviceLine' | 'campus'>('none');
  const [showHistoryRules, setShowHistoryRules] = useState(false);
  const [reselectingId, setReselectingId] = useState<string | null>(null);
  const [locNames, setLocNames] = useState<Record<string, string>>({});
  const [bubbleMapOpen, setBubbleMapOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [hoveredBubble, setHoveredBubble] = useState<string | null>(null);
  const [strategyAnalysis, setStrategyAnalysis] = useState<{
    portfolioNarrative: string;
    rules: Array<{
      id: string;
      strategyGroup: string;
      intendedStrategy: string;
      aiSummary: string;
      expectedOutcome: string;
    }>;
  } | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);

  // Combined stats (unique campus/unit counts + per-rule breakdown for click-throughs)
  const [combinedStats, setCombinedStats] = useState<{
    uniqueCampuses: number; uniqueUnits: number;
    combinedMonthly: number; combinedAnnual: number;
    breakdown: Array<{ id: string; name: string; campuses: number; units: number; monthlyImpact: number; annualImpact: number }>;
  } | null>(null);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [statsDialogFocus, setStatsDialogFocus] = useState<'campuses' | 'units' | 'monthly' | 'annual'>('campuses');

  // T3 move-in baseline
  const [t3MoveIns, setT3MoveIns] = useState<T3MoveIns | null>(null);
  const [showMoveInMethodology, setShowMoveInMethodology] = useState(false);

  // Structured builder state
  const [conditions, setConditions] = useState<Condition[]>([defaultCondition()]);
  const [conditionOperator, setConditionOperator] = useState<'AND' | 'OR'>('AND');
  const [ruleAction, setRuleAction] = useState<RuleAction>(defaultAction());

  // Manual rate overrides (shown in rule summary)
  const [manualOverrides, setManualOverrides] = useState<{
    id: string; location_name: string; service_line: string; room_type: string; override_rate: number;
  }[]>([]);

  const fetchManualOverrides = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (locationId) params.set('locationId', locationId);
      if (serviceLine) params.set('serviceLine', serviceLine);
      const res = await fetch('/api/manual-rate-overrides');
      if (res.ok) {
        const all = await res.json() as any[];
        // Filter to matching scope if props provided
        const filtered = all.filter((o: any) =>
          (!locationId || o.location_id === locationId) &&
          (!serviceLine || o.service_line === serviceLine)
        );
        setManualOverrides(filtered);
      }
    } catch { /* silent */ }
  }, [locationId, serviceLine]);

  useEffect(() => { fetchManualOverrides(); }, [fetchManualOverrides]);

  const recognitionRef = useRef<any>(null);

  const isSpeechSupported = typeof window !== 'undefined' &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  // Fetch existing rules
  const fetchRules = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (locationId) params.set('locationId', locationId);
      if (serviceLine) params.set('serviceLine', serviceLine);
      if (showHistoryRules) params.set('includeHistorical', 'true');
      const res = await fetch(`/api/adjustment-rules${params.toString() ? `?${params}` : ''}`);
      if (res.ok) setRules(await res.json());
    } catch { /* silent */ }
  }, [locationId, serviceLine, showHistoryRules]);
  fetchRulesRef.current = fetchRules;

  useEffect(() => { fetchRules(); }, [fetchRules]);

  // Location id → name map for the Campus grouping in Rule Administration
  useEffect(() => {
    fetch('/api/locations')
      .then(r => r.ok ? r.json() : [])
      .then((locs: any[]) => {
        const m: Record<string, string> = {};
        for (const l of locs || []) if (l?.id && l?.name) m[l.id] = l.name;
        setLocNames(m);
      })
      .catch(() => {});
  }, []);

  // Reselect a historical rule — creates a fresh active copy effective today
  const reselectRule = useCallback(async (ruleId: string, name: string) => {
    setReselectingId(ruleId);
    try {
      const res = await fetch(`/api/adjustment-rules/${ruleId}/reselect`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Reselect failed');
      }
      const created = await res.json();
      toast({ title: 'Rule reselected', description: `"${created.name}" is now active, effective today.` });
      fetchRules();
    } catch (e: any) {
      toast({ title: 'Reselect failed', description: e.message, variant: 'destructive' });
    } finally {
      setReselectingId(null);
    }
  }, [fetchRules, toast]);

  // Pricing History — historical records of past pricing changes (never applied to current rates)
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      if (historyFrom) params.set('from', historyFrom);
      if (locationId) params.set('locationId', locationId);
      const res = await fetch(`/api/adjustment-rules/history?${params}`);
      if (res.ok) setHistoryRules(await res.json());
    } catch { /* non-fatal */ } finally {
      setHistoryLoading(false);
    }
  }, [historyFrom, locationId]);

  useEffect(() => { if (historyOpen) fetchHistory(); }, [historyOpen, fetchHistory]);

  const clearManualOverride = useCallback(async (locationName: string, sl: string, rt: string) => {
    try {
      await fetch(`/api/manual-rate-override/${encodeURIComponent(locationName)}/${encodeURIComponent(sl)}/${encodeURIComponent(rt)}`, { method: 'DELETE' });
      fetchManualOverrides();
      fetchRules(); // refresh rules list too so impacts update
    } catch { /* silent */ }
  }, [fetchManualOverrides, fetchRules]);

  // Fetch unique campus/unit counts whenever active rules change
  const fetchCombinedStats = useCallback(async () => {
    const activeRules = rules.filter(r => r.isActive);
    if (!activeRules.length) { setCombinedStats(null); return; }
    try {
      const params = new URLSearchParams();
      if (locationId) params.set('locationId', locationId);
      if (serviceLine) params.set('serviceLine', serviceLine);
      const res = await fetch(`/api/adjustment-rules/combined-stats${params.toString() ? `?${params}` : ''}`);
      if (res.ok) setCombinedStats(await res.json());
    } catch { /* silent */ }
  }, [rules, locationId, serviceLine]);

  useEffect(() => { fetchCombinedStats(); }, [fetchCombinedStats]);

  const fetchStrategyAnalysis = useCallback(async () => {
    if (strategyAnalysis || strategyLoading) return;
    setStrategyLoading(true);
    try {
      const res = await fetch('/api/adjustment-rules/strategy-analysis');
      if (res.ok) setStrategyAnalysis(await res.json());
    } catch { /* silent */ } finally {
      setStrategyLoading(false);
    }
  }, [strategyAnalysis, strategyLoading]);

  // Fetch T3 move-in baseline
  const fetchT3MoveIns = useCallback(async () => {
    if (!locationId) { setT3MoveIns(null); return; }
    try {
      const res = await fetch(`/api/metrics/t3-moveins?locationId=${locationId}`);
      if (res.ok) setT3MoveIns(await res.json());
      else setT3MoveIns(null);
    } catch { setT3MoveIns(null); }
  }, [locationId]);

  useEffect(() => { fetchT3MoveIns(); }, [fetchT3MoveIns]);

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

  // Close SL picker dropdowns when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (slPickerRef.current && !slPickerRef.current.contains(e.target as Node)) setSlPickerOpen(false);
      const inStructuredPicker = newSlPickerRef.current && newSlPickerRef.current.contains(e.target as Node);
      const inAiPicker = newSlPickerAiRef.current && newSlPickerAiRef.current.contains(e.target as Node);
      if (!inStructuredPicker && !inAiPicker) setNewSlPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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
        body: JSON.stringify({ description, preview: false, locationId: locationId || null, serviceLines: isEditing ? editingRuleSLs : newRuleSLs, effectiveDate: effectiveDate || null, isAdditive: stackRule, isHistorical: saveAsHistorical }),
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
      setEditingRuleSLs([]);
      setNewRuleSLs([]);
      setEffectiveDate('');
      setSaveAsHistorical(false);
      setStackRule(true);
      if (saveAsHistorical) fetchHistory();
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
    setEditingRuleSLs([]);
    setNewRuleSLs([]);
    setEffectiveDate('');
    setSaveAsHistorical(false);
    setStackRule(true);
    setSlPickerOpen(false);
    setNewSlPickerOpen(false);
  };

  const startEdit = (rule: AdjustmentRule) => {
    setEditingRuleId(rule.id);
    setEditingRuleName(rule.name);
    const action0 = rule.action as any;
    const resolvedSLs: string[] =
      Array.isArray((rule as any).serviceLines) && (rule as any).serviceLines.length
        ? (rule as any).serviceLines
        : (rule as any).serviceLine
          ? [(rule as any).serviceLine]
          : Array.isArray(action0?.filters?.serviceLine) && action0.filters.serviceLine.length
            ? action0.filters.serviceLine
            : action0?.filters?.serviceLine
              ? [action0.filters.serviceLine]
              : [];
    setEditingRuleSLs(resolvedSLs);
    setEffectiveDate((rule as any).effectiveDate ? String((rule as any).effectiveDate).slice(0, 10) : '');
    setStackRule(isRuleAdditive(rule.action as any));
    setDesignerOpen(true);
    setSlPickerOpen(false);
    setImpactData(null);
    // Scroll the designer card into view so mobile users don't see a blank jump
    setTimeout(() => {
      designerCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);

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

    const opMap: Record<string, string> = {
      '<': 'is less than', '>': 'is greater than',
      '<=': 'is less than or equal to', '>=': 'is greater than or equal to',
      '=': 'equals', '!=': 'does not equal',
    };

    // Helper: convert a single NLP-array condition element to a Condition row
    const hydrateArrayCondition = (c: any): Condition | null => {
      const toPercent = (v: number) => String(Math.round(typeof v === 'number' && v < 1 ? v * 100 : v));
      switch (c.field) {
        case 'service_line_occupancy':
          return { id: newConditionId(), metric: 'Service Line Occupancy', timePeriod: 'Current Month', operator: opMap[c.operator] ?? 'is less than', value: toPercent(c.value) };
        case 'room_type_occupancy':
          return { id: newConditionId(), metric: 'Room Type Occupancy', timePeriod: c.timePeriod === 'trailing3' ? 'Trailing 3' : 'Current Month', operator: opMap[c.operator] ?? 'is less than', value: toPercent(c.value) };
        case 'room_type_occupancy_trailing3':
          return { id: newConditionId(), metric: 'Room Type Occupancy', timePeriod: 'Trailing 3', operator: opMap[c.operator] ?? 'is less than', value: toPercent(c.value) };
        case 'occupancy':
          return { id: newConditionId(), metric: 'Campus Occupancy', timePeriod: 'Current Month', operator: opMap[c.operator] ?? 'is less than', value: toPercent(c.value) };
        case 'days_vacant':
          return { id: newConditionId(), metric: 'Days Vacant', timePeriod: 'Current Spot', operator: opMap[c.operator] ?? 'is greater than', value: String(c.value) };
        case 'street_to_comp_var':
          return { id: newConditionId(), metric: 'Street Rate to Top Comp Var %', timePeriod: 'Current Spot', operator: opMap[c.operator] ?? 'is greater than', value: String(c.value) };
        default:
          if (NEW_METRIC_FIELDS[c.field]) {
            return { id: newConditionId(), metric: NEW_METRIC_FIELDS[c.field], timePeriod: 'Current Spot', operator: opMap[c.operator] ?? 'is greater than', value: String(c.value) };
          }
          return null;
      }
    };

    if (trigger?.type === 'condition') {
      // ── NLP array format: trigger.conditions is an array ──────────────────
      if (Array.isArray(trigger.conditions) && trigger.conditions.length > 0) {
        for (const c of trigger.conditions) {
          const cond = hydrateArrayCondition(c);
          if (cond) rebuilt.push(cond);
        }
        // Restore AND/OR operator if stored
        if (trigger.conditionOperator === 'OR') setConditionOperator('OR');
        else setConditionOperator('AND');
      }

      // ── Singular condition format (single-condition NLP rules) ────────────
      if (rebuilt.length === 0 && trigger.condition?.field) {
        const cond = hydrateArrayCondition(trigger.condition);
        if (cond) rebuilt.push(cond);
      }

      // ── Legacy object format: trigger.conditions is a plain object ────────
      if (rebuilt.length === 0) {
        const tc = typeof trigger.conditions === 'object' && !Array.isArray(trigger.conditions) ? trigger.conditions ?? {} : {};
        if (tc.occupancyStatus) {
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
    }

    setConditions(rebuilt.length > 0 ? rebuilt : [defaultCondition()]);

    // Also pre-fill the AI tab text as fallback
    setAiInput(rule.description || rule.name || '');
    setActiveTab('structured');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Per-rule note editing (Rule Administration list)
  const [adminNoteDraft, setAdminNoteDraft] = useState<{ ruleId: string; text: string } | null>(null);
  const [adminNoteSaving, setAdminNoteSaving] = useState(false);
  const saveRuleNote = async (ruleId: string, notes: string) => {
    setAdminNoteSaving(true);
    try {
      const res = await fetch(`/api/adjustment-rules/${ruleId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error();
      const trimmed = notes.trim();
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, notes: trimmed || null } as any : r));
      setAdminNoteDraft(null);
    } catch {
      toast({ title: 'Failed to save note', variant: 'destructive' });
    } finally {
      setAdminNoteSaving(false);
    }
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

  const disableAllRules = async () => {
    const activeIds = rules.filter(r => r.isActive).map(r => r.id);
    if (activeIds.length === 0) return;
    try {
      await Promise.all(activeIds.map(id => fetch(`/api/adjustment-rules/${id}/toggle`, { method: 'PATCH' })));
      setRules(prev => prev.map(r => ({ ...r, isActive: false })));
      toast({ title: 'All rules disabled', description: `${activeIds.length} rule${activeIds.length !== 1 ? 's' : ''} turned off.` });
    } catch {
      toast({ title: 'Failed to disable all rules', variant: 'destructive' });
    }
  };

  const toggleAdditive = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/adjustment-rules/${ruleId}/additive`, { method: 'PATCH' });
      if (!res.ok) throw new Error();
      // Use the server response as the source of truth so the badge/switch
      // can never drift from the persisted stacking state.
      const updated = await res.json();
      const updatedAction = typeof updated.action === 'string'
        ? JSON.parse(updated.action)
        : (updated.action ?? {});
      setRules(prev => prev.map(r => (r.id === ruleId ? { ...r, action: updatedAction } : r)));
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
      <Card ref={designerCardRef} className="w-full shadow-sm bg-white border border-gray-200">
        <CardHeader
          className="pb-4 cursor-pointer select-none hover:bg-gray-50 rounded-t-lg transition-colors"
          onClick={() => setDesignerOpen(o => !o)}
          data-testid="rule-designer-header"
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Wand2 className="h-4 w-4 text-[var(--trilogy-teal)]" />
              Rule Designer
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${designerOpen ? 'rotate-180' : ''}`} />
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
          <CardDescription className="text-xs text-gray-500 mt-1">
            {locationName || serviceLine
              ? `Rules will apply to ${[locationName, serviceLine].filter(Boolean).join(' · ')} only. Preview math reflects this scope.`
              : 'Build pricing rules using natural language or structured IF / THEN logic.'}
          </CardDescription>
          {editingRuleId && (
            <div onClick={e => e.stopPropagation()} className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-300">
              <Pencil className="h-3.5 w-3.5 shrink-0" />
              <div className="flex flex-col min-w-0 gap-1">
                <span className="text-xs font-medium truncate">Editing: "{editingRuleName}"</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">Service lines:</span>
                  <div className="relative" ref={slPickerRef}>
                    <button
                      type="button"
                      onClick={() => setSlPickerOpen(p => !p)}
                      className="h-5 text-[10px] px-2 inline-flex items-center gap-1 border border-amber-300 bg-amber-50 rounded text-amber-800 hover:bg-amber-100 dark:bg-amber-950/50 dark:border-amber-600 dark:text-amber-200 dark:hover:bg-amber-900/60 max-w-[160px]"
                    >
                      <span className="truncate">{editingRuleSLs.length === 0 ? 'All service lines' : editingRuleSLs.join(', ')}</span>
                      <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                    </button>
                    {slPickerOpen && (
                      <div className="absolute top-full left-0 z-50 mt-1 bg-white dark:bg-gray-900 border border-border rounded-lg shadow-lg p-2 min-w-[140px]">
                        {ALL_SERVICE_LINES.map(sl => (
                          <label key={sl} className="flex items-center gap-2 text-xs py-1 cursor-pointer text-foreground hover:text-[var(--trilogy-teal)]">
                            <input
                              type="checkbox"
                              checked={editingRuleSLs.includes(sl)}
                              onChange={e => setEditingRuleSLs(prev => e.target.checked ? [...prev, sl] : prev.filter(s => s !== sl))}
                              className="h-3 w-3"
                            />
                            {sl}
                          </label>
                        ))}
                        {editingRuleSLs.length > 0 && (
                          <button type="button" onClick={() => setEditingRuleSLs([])} className="text-[10px] text-muted-foreground hover:underline mt-1 w-full text-left">
                            Clear (all service lines)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="ml-auto h-5 px-2 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-100 shrink-0" onClick={handleClear}>
                Cancel
              </Button>
            </div>
          )}
        </CardHeader>

        {designerOpen && (
        <CardContent>
          <div className={`grid gap-6 ${activeTab === 'ai-generator' ? '' : 'lg:grid-cols-2'}`}>

            {/* ── LEFT: Builder ── */}
            <div className="space-y-4">
              <Tabs value={activeTab} onValueChange={v => { setActiveTab(v as any); setImpactData(null); setNewSlPickerOpen(false); }}>
                <TabsList className="w-full h-auto flex-wrap">
                  <TabsTrigger value="structured" className="flex-1 gap-1.5 min-w-[48%] sm:min-w-0" data-testid="tab-structured">
                    <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" /> Structured Rule Builder
                  </TabsTrigger>
                  <TabsTrigger value="ask-ai" className="flex-1 gap-1.5 min-w-[48%] sm:min-w-0" data-testid="tab-ask-ai">
                    <Wand2 className="h-3.5 w-3.5 shrink-0" /> Natural Language Rules
                  </TabsTrigger>
                  {aiGenerator && (
                    <TabsTrigger value="ai-generator" className="flex-1 gap-1.5 min-w-[48%] sm:min-w-0" data-testid="tab-ai-generator">
                      <Sparkles className="h-3.5 w-3.5 shrink-0" /> AI Rule Generator
                    </TabsTrigger>
                  )}
                </TabsList>

                {/* ── AI RULE GENERATOR TAB ── */}
                {aiGenerator && (
                  <TabsContent value="ai-generator" className="mt-4">
                    {aiGenerator}
                  </TabsContent>
                )}

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

                  {/* Service line scope picker — mirrors the Structured tab picker; hidden when editing (banner handles it) */}
                  {!editingRuleId && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Scope:</span>
                      <div className="relative" ref={newSlPickerAiRef}>
                        <button
                          type="button"
                          data-testid="scope-picker-ask-ai"
                          onClick={() => setNewSlPickerOpen(p => !p)}
                          className="h-7 text-xs px-2.5 inline-flex items-center gap-1.5 border border-border rounded-md bg-muted/40 hover:bg-muted/80 hover:border-[var(--trilogy-teal)] transition-colors"
                        >
                          <span data-testid="scope-label-ask-ai">{newRuleSLs.length === 0 ? 'All service lines' : newRuleSLs.join(', ')}</span>
                          <ChevronDown className="h-3 w-3 shrink-0" />
                        </button>
                        {newSlPickerOpen && (
                          <div className="absolute top-full left-0 z-50 mt-1 bg-white dark:bg-gray-900 border border-border rounded-lg shadow-lg p-2 min-w-[140px]">
                            {ALL_SERVICE_LINES.map(sl => (
                              <label key={sl} className="flex items-center gap-2 text-xs py-1 cursor-pointer text-foreground hover:text-[var(--trilogy-teal)]">
                                <input
                                  type="checkbox"
                                  data-testid={`scope-checkbox-ask-ai-${sl}`}
                                  checked={newRuleSLs.includes(sl)}
                                  onChange={e => setNewRuleSLs(prev => e.target.checked ? [...prev, sl] : prev.filter(s => s !== sl))}
                                  className="h-3 w-3"
                                />
                                {sl}
                              </label>
                            ))}
                            {newRuleSLs.length > 0 && (
                              <button type="button" onClick={() => setNewRuleSLs([])} className="text-[10px] text-muted-foreground hover:underline mt-1 w-full text-left">
                                Clear (all service lines)
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Effective date — rule starts applying on this date (blank = immediately) */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Effective date:</span>
                    <input
                      type="date"
                      data-testid="effective-date-ask-ai"
                      value={effectiveDate}
                      onChange={e => setEffectiveDate(e.target.value)}
                      className="h-7 text-xs px-2 border border-border rounded-md bg-muted/40 hover:border-[var(--trilogy-teal)] transition-colors text-foreground"
                    />
                    {effectiveDate ? (
                      <button type="button" onClick={() => setEffectiveDate('')} className="text-[10px] text-muted-foreground hover:underline">
                        Clear (immediate)
                      </button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Blank = effective immediately</span>
                    )}
                  </div>

                  {/* Historical record — only offered when effective date is in the past */}
                  {effectiveDate && effectiveDate < new Date().toISOString().slice(0, 10) && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Historical record:</span>
                      <Switch
                        checked={saveAsHistorical}
                        onCheckedChange={setSaveAsHistorical}
                        data-testid="historical-toggle-ask-ai"
                        aria-label="Save as historical record"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {saveAsHistorical ? 'Saved to Pricing History only — will not change current rates' : 'Off — rule will apply to current rates'}
                      </span>
                    </div>
                  )}

                  {/* Stack rule — stacks with other rules vs exclusive */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Stack rule:</span>
                    <Switch
                      checked={stackRule}
                      onCheckedChange={setStackRule}
                      data-testid="stack-rule-ask-ai"
                      aria-label="Stack rule"
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {stackRule ? 'Stacks with other matching rules' : 'Exclusive — only the highest-priority exclusive rule applies'}
                    </span>
                  </div>

                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-gray-50 border border-gray-200">
                    <Sparkles className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-gray-600 leading-relaxed">
                      AI parses your rule into a structured trigger + action, estimates impact, and saves it. Always review the preview before saving.
                    </p>
                  </div>
                </TabsContent>

                {/* ── STRUCTURED BUILDER TAB ── */}
                <TabsContent value="structured" className="mt-4 space-y-5">

                  {/* Service line scope picker — only shown for new rules (edit uses the banner) */}
                  {!editingRuleId && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Scope:</span>
                      <div className="relative" ref={newSlPickerRef}>
                        <button
                          type="button"
                          data-testid="scope-picker-structured"
                          onClick={() => setNewSlPickerOpen(p => !p)}
                          className="h-7 text-xs px-2.5 inline-flex items-center gap-1.5 border border-border rounded-md bg-muted/40 hover:bg-muted/80 hover:border-[var(--trilogy-teal)] transition-colors"
                        >
                          <span data-testid="scope-label-structured">{newRuleSLs.length === 0 ? 'All service lines' : newRuleSLs.join(', ')}</span>
                          <ChevronDown className="h-3 w-3 shrink-0" />
                        </button>
                        {newSlPickerOpen && (
                          <div className="absolute top-full left-0 z-50 mt-1 bg-white dark:bg-gray-900 border border-border rounded-lg shadow-lg p-2 min-w-[140px]">
                            {ALL_SERVICE_LINES.map(sl => (
                              <label key={sl} className="flex items-center gap-2 text-xs py-1 cursor-pointer text-foreground hover:text-[var(--trilogy-teal)]">
                                <input
                                  type="checkbox"
                                  data-testid={`scope-checkbox-structured-${sl}`}
                                  checked={newRuleSLs.includes(sl)}
                                  onChange={e => setNewRuleSLs(prev => e.target.checked ? [...prev, sl] : prev.filter(s => s !== sl))}
                                  className="h-3 w-3"
                                />
                                {sl}
                              </label>
                            ))}
                            {newRuleSLs.length > 0 && (
                              <button type="button" onClick={() => setNewRuleSLs([])} className="text-[10px] text-muted-foreground hover:underline mt-1 w-full text-left">
                                Clear (all service lines)
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Effective date — rule starts applying on this date (blank = immediately) */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Effective date:</span>
                    <input
                      type="date"
                      data-testid="effective-date-structured"
                      value={effectiveDate}
                      onChange={e => setEffectiveDate(e.target.value)}
                      className="h-7 text-xs px-2 border border-border rounded-md bg-muted/40 hover:border-[var(--trilogy-teal)] transition-colors text-foreground"
                    />
                    {effectiveDate ? (
                      <button type="button" onClick={() => setEffectiveDate('')} className="text-[10px] text-muted-foreground hover:underline">
                        Clear (immediate)
                      </button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Blank = effective immediately</span>
                    )}
                  </div>

                  {/* Historical record — only offered when effective date is in the past */}
                  {effectiveDate && effectiveDate < new Date().toISOString().slice(0, 10) && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Historical record:</span>
                      <Switch
                        checked={saveAsHistorical}
                        onCheckedChange={setSaveAsHistorical}
                        data-testid="historical-toggle-structured"
                        aria-label="Save as historical record"
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {saveAsHistorical ? 'Saved to Pricing History only — will not change current rates' : 'Off — rule will apply to current rates'}
                      </span>
                    </div>
                  )}

                  {/* Stack rule — stacks with other rules vs exclusive */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Stack rule:</span>
                    <Switch
                      checked={stackRule}
                      onCheckedChange={setStackRule}
                      data-testid="stack-rule-structured"
                      aria-label="Stack rule"
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {stackRule ? 'Stacks with other matching rules' : 'Exclusive — only the highest-priority exclusive rule applies'}
                    </span>
                  </div>

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
            {activeTab !== 'ai-generator' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-slate-50/50 p-4 space-y-4 h-full">

                {/* Plain English Summary */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Rule Summary</p>
                  {description ? (
                    <p className="text-sm text-foreground leading-relaxed">"{description}"</p>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-5 gap-2.5 text-center">
                      <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                        <Wand2 className="h-4.5 w-4.5 text-muted-foreground/40" style={{ width: 18, height: 18 }} />
                      </div>
                      <p className="text-sm text-muted-foreground italic leading-relaxed">
                        Build a rule to see the<br />plain-language summary here.
                      </p>
                    </div>
                  )}
                </div>

                {/* Structured IF/THEN preview */}
                {activeTab === 'structured' && (conditions.some(c => c.value || c.metric) || ruleAction.amountValue) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Logic Preview</p>
                    <div className="rounded-lg bg-white border border-border p-3 text-xs font-mono space-y-1">
                      <div className="text-gray-500 font-semibold">IF</div>
                      {conditions.map((c, i) => (
                        <div key={c.id} className="pl-3 text-gray-700">
                          {i > 0 && <span className="text-gray-900 font-semibold">{conditionOperator} </span>}
                          <span className="text-gray-900 font-medium">{c.metric}</span>
                          {c.timePeriod && <span className="text-gray-500"> ({c.timePeriod})</span>}
                          {' '}<span className="text-gray-600">{c.operator}</span>
                          {c.value && <span className="text-gray-900 font-semibold"> {c.value}</span>}
                        </div>
                      ))}
                      <div className="text-gray-500 font-semibold pt-1">THEN</div>
                      <div className="pl-3 text-gray-700">
                        <span className="text-gray-900 font-medium">{actionLabel || 'action'}</span>
                        {ruleAction.amountValue && (
                          <span className="text-gray-900 font-semibold"> {ruleAction.amountType === 'percent' ? `${ruleAction.amountValue}%` : `$${ruleAction.amountValue}`}</span>
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
                    {/* T3 move-in baseline */}
                    {t3MoveIns && (
                      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Expected Move-Ins (T3 Baseline — do nothing)</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {Object.entries(t3MoveIns.byServiceLine).sort(([a],[b])=>a.localeCompare(b)).map(([sl, avg]) => (
                            <span key={sl} className="text-xs text-gray-700 dark:text-gray-300">
                              <span className="font-semibold text-gray-900 dark:text-white">{sl}</span>: ~{avg.toFixed(1)}/mo
                            </span>
                          ))}
                          <span className="text-xs text-gray-600 dark:text-gray-400 font-medium ml-auto">
                            Campus total: ~{t3MoveIns.campus.toFixed(1)}/mo
                          </span>
                        </div>
                        {t3MoveIns.asOf && (
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                            Based on {t3MoveIns.monthsUsed} month{t3MoveIns.monthsUsed !== 1 ? 's' : ''} of data through {new Date(t3MoveIns.asOf).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} · HC/HC/MC private pay only
                          </p>
                        )}
                      </div>
                    )}
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
            )}
          </div>
        </CardContent>
        )}
      </Card>


      {/* ── Empty state ── */}
      {rules.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 py-10 px-6 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-teal-50 dark:bg-teal-950/50 border border-teal-100 dark:border-teal-800/50 flex items-center justify-center">
            <Layers className="h-5 w-5 text-teal-500 dark:text-teal-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">No rules yet</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-xs">
              Build your first pricing rule above using AI or the structured builder.
              Rules take effect on the next pricing calculation.
            </p>
          </div>
        </div>
      )}

      {/* ── Rules Panel ── */}
      {rules.length > 0 && (() => {
        const liveRules     = rules.filter(r => !r.isHistorical);
        const histRules     = rules.filter(r => r.isHistorical);
        const activeRules   = liveRules.filter(r => r.isActive);
        const disabledRules = liveRules.filter(r => !r.isActive);
        const activeCount   = activeRules.filter(r => (r.affectedUnits ?? 0) > 0).length;

        // Priority-ordered active rules: exclusive rules compete for units; additive always stack
        const sortedActive   = [...activeRules].reverse(); // oldest first → priority 1, 2, 3...
        const sortedDisabled = [...disabledRules].reverse();
        const sortedHist     = [...histRules].sort((a, b) =>
          String(b.effectiveDate || b.createdAt || '').localeCompare(String(a.effectiveDate || a.createdAt || '')));
        const sortedRules    = [...sortedActive, ...sortedDisabled, ...(showHistoryRules ? sortedHist : [])];

        // ── Date-range filter (effective date, falling back to created date) ──
        const inRange = (r: AdjustmentRule) => {
          if (!adminFrom && !adminTo) return true;
          const raw = r.effectiveDate || r.createdAt;
          const d = raw ? new Date(raw).toISOString().slice(0, 10) : null;
          if (adminFrom && (!d || d < adminFrom)) return false;
          if (adminTo && (!d || d > adminTo)) return false;
          return true;
        };
        const filteredRules = sortedRules.filter(inRange);

        // ── Grouping (strategy / service line / campus), mirroring Rule Performance ──
        const groupKeyOf = (r: AdjustmentRule): string => {
          if (adminGroupBy === 'strategy') return ADMIN_CATEGORY_LABELS[r.category || ''] || 'Other';
          if (adminGroupBy === 'serviceLine') {
            const sls: string[] = (r as any).serviceLines?.length ? (r as any).serviceLines : ((r.action as any)?.filters?.serviceLine || []);
            return sls.length ? sls.join(', ') : (r.serviceLine || 'All Service Lines');
          }
          return r.locationId ? (locNames[r.locationId] || 'Unknown campus') : 'All Campuses';
        };
        type DisplayRow = { type: 'header'; label: string; count: number } | { type: 'rule'; rule: AdjustmentRule };
        let displayRows: DisplayRow[];
        if (adminGroupBy === 'none') {
          displayRows = (rulesExpanded ? filteredRules : filteredRules.slice(0, 5)).map(rule => ({ type: 'rule' as const, rule }));
        } else if (adminGroupBy === 'rule') {
          displayRows = [
            { type: 'header', label: 'All Rules', count: filteredRules.length },
            ...filteredRules.map(rule => ({ type: 'rule' as const, rule })),
          ];
        } else {
          const groupsMap = new Map<string, AdjustmentRule[]>();
          for (const r of filteredRules) {
            const k = groupKeyOf(r);
            if (!groupsMap.has(k)) groupsMap.set(k, []);
            groupsMap.get(k)!.push(r);
          }
          displayRows = [];
          for (const [label, rs] of Array.from(groupsMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
            displayRows.push({ type: 'header', label, count: rs.length });
            for (const r of rs) displayRows.push({ type: 'rule', rule: r });
          }
        }

        const exclusiveActive = sortedActive.filter(r => isRuleExclusive(r.action as any));
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
            a.href = url; a.download = 'rules-impact.xlsx'; a.click();
            URL.revokeObjectURL(url);
          } catch {
            toast({ title: 'Export failed', variant: 'destructive' });
          }
        };

        // Professional boardroom colour palette — teal/navy/slate family with accent
        const PALETTE = ['#0d9488','#0284c7','#4f46e5','#0891b2','#059669','#7c3aed','#0e7490','#d97706'];

        const STRATEGY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
          'Revenue Growth':       { bg: 'bg-green-100',  text: 'text-green-800',  border: 'border-green-200'  },
          'Occupancy Recovery':   { bg: 'bg-blue-100',   text: 'text-blue-800',   border: 'border-blue-200'   },
          'Service Line Premium': { bg: 'bg-cyan-100', text: 'text-cyan-800', border: 'border-cyan-200' },
          'Market Positioning':   { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200' },
          'Portfolio-Wide':       { bg: 'bg-teal-100',   text: 'text-teal-800',   border: 'border-teal-200'   },
        };

        return (
          <>
            <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
              <Card className="w-full shadow-sm bg-white border border-gray-200">
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-4 cursor-pointer select-none hover:bg-gray-50 rounded-t-lg transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CheckCircle2 className="h-4 w-4 text-teal-600 shrink-0" />
                        <span className="text-base font-semibold text-gray-900">Rule Administration</span>
                        {activeCount > 0
                          ? <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 border border-green-200 px-2 py-0.5 text-xs font-medium">{activeCount} active</span>
                          : <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-500 border border-gray-200 px-2 py-0.5 text-xs font-medium">none active</span>
                        }
                        {disabledRules.length > 0 && (
                          <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-500 border border-gray-200 px-2 py-0.5 text-xs font-medium">{disabledRules.length} off</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {activeRules.length > 0 && (
                          <Button
                            variant="outline" size="sm"
                            className="h-7 text-xs gap-1.5 text-red-600 border-red-200 bg-red-50 hover:bg-red-100"
                            onClick={e => { e.stopPropagation(); disableAllRules(); }}
                            title="Turn off all active rules"
                          >
                            <PowerOff className="h-3 w-3" />
                            All Off
                          </Button>
                        )}
                        {activeCount > 0 && (
                          <Button
                            variant="outline" size="sm"
                            className="h-7 text-xs gap-1.5 text-teal-700 border-teal-200 bg-teal-50 hover:bg-teal-100"
                            onClick={e => { e.stopPropagation(); setBubbleMapOpen(true); fetchStrategyAnalysis(); }}
                            title="View bubble map of rule coverage"
                          >
                            <Eye className="h-3 w-3" />
                            Bubble Map
                          </Button>
                        )}
                        <Button
                          variant="outline" size="sm"
                          className="h-7 text-xs gap-1.5 text-gray-600 border-gray-300 bg-white hover:bg-gray-50"
                          onClick={e => { e.stopPropagation(); exportRules(); }}
                        >
                          <Download className="h-3 w-3" />
                          Export Excel
                        </Button>
                        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${rulesOpen ? '' : '-rotate-90'}`} />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Select rules to apply during the next pricing round. Impact reflects expected new admissions
                      {(locationId || serviceLine)
                        ? ` filtered to ${locationName || 'selected location'}${serviceLine ? ` · ${serviceLine}` : ''}.`
                        : ' across all campuses.'}
                    </p>
                  </CardHeader>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <CardContent className="pt-0 pb-4 px-4">

                    {/* ── Filter bar (mirrors Rule Performance Over Time) ── */}
                    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <label className="text-[11px] font-medium text-gray-500">From</label>
                        <input
                          type="date" value={adminFrom} onChange={e => setAdminFrom(e.target.value)}
                          className="h-7 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700"
                          data-testid="input-admin-from"
                        />
                        <label className="text-[11px] font-medium text-gray-500">To</label>
                        <input
                          type="date" value={adminTo} onChange={e => setAdminTo(e.target.value)}
                          className="h-7 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700"
                          data-testid="input-admin-to"
                        />
                        {(adminFrom || adminTo) && (
                          <button
                            type="button"
                            className="text-[11px] text-teal-700 hover:underline"
                            onClick={() => { setAdminFrom(''); setAdminTo(''); }}
                          >Clear</button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-[11px] font-medium text-gray-500">Group by</label>
                        <select
                          value={adminGroupBy}
                          onChange={e => setAdminGroupBy(e.target.value as any)}
                          className="h-7 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700"
                          data-testid="select-admin-groupby"
                        >
                          <option value="none">None</option>
                          <option value="strategy">Strategy</option>
                          <option value="rule">Rule</option>
                          <option value="serviceLine">Service Line</option>
                          <option value="campus">Campus</option>
                        </select>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowHistoryRules(v => !v)}
                        className={`h-7 px-2.5 rounded border text-xs font-medium transition-colors ${
                          showHistoryRules
                            ? 'bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-100'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                        title="Show past pricing-cycle rules so they can be reselected"
                        data-testid="button-toggle-history-rules"
                      >
                        {showHistoryRules ? `Pricing history shown (${histRules.length})` : 'Show pricing history'}
                      </button>
                      {(adminFrom || adminTo) && (
                        <span className="text-[11px] text-gray-400">
                          {filteredRules.length} of {sortedRules.length} rules in range
                        </span>
                      )}
                    </div>

                    {/* ── Combined active rules summary ── */}
                    {activeCount > 0 && (
                      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
                        <div
                          className={`flex items-center justify-between gap-2 flex-wrap cursor-pointer select-none ${summaryOpen ? 'mb-3' : ''}`}
                          onClick={() => setSummaryOpen(o => !o)}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                              <Layers className="h-3 w-3 text-gray-500" />
                            </div>
                            <p className="text-sm font-semibold text-gray-900">
                              {activeCount} Active Rule{activeCount > 1 ? 's' : ''}
                              <span className="font-normal text-gray-400 ml-1.5 text-xs">· new admissions only</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {hasOverlap && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                {exclusiveActive.length} exclusive — priority order applies
                              </span>
                            )}
                            <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${summaryOpen ? '' : '-rotate-90'}`} />
                          </div>
                        </div>
                        {summaryOpen && (
                        <div className="grid grid-cols-4 gap-2">
                          {(() => {
                            const uCampuses = combinedStats?.uniqueCampuses  ?? combinedCampuses;
                            const uUnits    = combinedStats?.uniqueUnits     ?? combinedUnits;
                            const uMonthly  = combinedStats?.combinedMonthly ?? combinedMonthly;
                            const uAnnual   = combinedStats?.combinedAnnual  ?? combinedAnnual;
                            const tiles: Array<{ label: string; value: string; money: boolean; focus: 'campuses'|'units'|'monthly'|'annual' }> = [
                              { label: 'Campuses', value: uCampuses.toLocaleString(), money: false, focus: 'campuses' },
                              { label: 'Units',    value: uUnits.toLocaleString(),    money: false, focus: 'units'    },
                              { label: 'Monthly',  value: fmt(uMonthly),              money: true,  focus: 'monthly'  },
                              { label: 'Annual',   value: fmt(uAnnual),               money: true,  focus: 'annual'   },
                            ];
                            return tiles.map(({ label, value, money, focus }) => (
                              <button
                                key={label}
                                onClick={() => { setStatsDialogFocus(focus); setStatsDialogOpen(true); }}
                                className="rounded-lg bg-white border border-gray-100 px-3 py-2.5 text-center hover:border-teal-300 hover:bg-teal-50/40 transition-colors cursor-pointer w-full"
                              >
                                <p className={`text-base font-bold tracking-tight leading-none mb-1 ${
                                  money ? (uAnnual >= 0 ? 'text-green-700' : 'text-red-700') : 'text-gray-900'
                                }`}>{value}</p>
                                <p className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">{label}</p>
                              </button>
                            ));
                          })()}
                        </div>
                        )}
                      </div>
                    )}

                    {/* ── Rule list (table) ── */}
                    <div className={`overflow-x-auto rounded-lg border border-gray-200 ${rulesExpanded && sortedRules.length > 10 ? 'max-h-[520px] overflow-y-auto' : ''}`}>
                      <table className="w-full text-sm border-collapse">
                        <thead className={rulesExpanded && sortedRules.length > 10 ? 'sticky top-0 z-10 bg-gray-50' : ''}>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="py-2 px-2 w-9" />
                            <th className="py-2 px-2 text-left font-medium text-gray-500 text-[11px] uppercase tracking-wide">Rule Summary</th>
                            <th className="py-2 px-2 text-left font-medium text-gray-500 text-[11px] uppercase tracking-wide">Rule Detail</th>
                            <th className="py-2 px-2 text-left font-medium text-gray-500 text-[11px] uppercase tracking-wide">Service Line</th>
                            <th className="py-2 px-2 text-right font-medium text-gray-500 text-[11px] uppercase tracking-wide">Units Impacted</th>
                            <th className="py-2 px-2 text-right font-medium text-gray-500 text-[11px] uppercase tracking-wide">Revenue Impact</th>
                            <th className="py-2 px-2 text-right font-medium text-gray-500 text-[11px] uppercase tracking-wide">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayRows.map((item) => {
                            if (item.type === 'header') {
                              return (
                                <tr key={`grp-${item.label}`} className="bg-gray-100/80 border-b border-gray-200">
                                  <td colSpan={7} className="py-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-gray-600" data-testid={`group-header-${item.label}`}>
                                    {item.label} <span className="font-normal text-gray-400 normal-case">({item.count} rule{item.count !== 1 ? 's' : ''})</span>
                                  </td>
                                </tr>
                              );
                            }
                            const rule = item.rule;
                            const annual        = rule.annualImpact  ?? 0;
                            const monthly       = rule.monthlyImpact ?? 0;
                            const isPos         = monthly >= 0;
                            const isAdditive    = isRuleAdditive(rule.action as any);
                            const rulePriority  = exclusivePriority(sortedActive, rule);
                            const ruleSLs: string[] = (rule as any).serviceLines?.length ? (rule as any).serviceLines : ((rule.action as any)?.filters?.serviceLine || []);
                            const slDisplay = ruleSLs.length ? ruleSLs.join(', ') : (rule.serviceLine || 'All');
                            // Normalise the stored name against the authoritative serviceLine field
                            // to fix any rules saved with the wrong SL token (longest alternatives first).
                            // For multi-SL rules the name is used as-is.
                            const slTokenRe = /(\s+-\s+)(AL\/MC|HC\/MC|AL|MC|HC|IL|SL|VIL)\b/i;
                            const displayName = (!(rule as any).serviceLines?.length && rule.serviceLine)
                              ? rule.name.replace(slTokenRe, (_, sep, token) =>
                                  token.toUpperCase() !== rule.serviceLine!.toUpperCase()
                                    ? `${sep}${rule.serviceLine}`
                                    : `${sep}${token}`
                                )
                              : rule.name;

                            return (
                              <tr
                                key={rule.id}
                                className={`border-b border-gray-100 last:border-0 transition-colors ${
                                  rule.isActive ? 'bg-white hover:bg-gray-50' : 'bg-gray-50/60 opacity-60'
                                }`}
                                data-testid={`rule-${rule.id}`}
                              >
                                {/* Priority / mode indicator */}
                                <td className="py-2.5 px-2 align-top">
                                  {rulePriority !== null ? (
                                    <span data-testid={`priority-indicator-${rule.id}`} className="shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold flex items-center justify-center border border-amber-200" title={`Exclusive priority #${rulePriority}`}>
                                      {rulePriority}
                                    </span>
                                  ) : isAdditive && rule.isActive ? (
                                    <div data-testid={`stacks-indicator-${rule.id}`} className="shrink-0 w-5 h-5 rounded-full bg-teal-50 border border-teal-200 flex items-center justify-center" title="Stacks with other rules">
                                      <div className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                                    </div>
                                  ) : (
                                    <div className={`shrink-0 w-2 h-2 rounded-full ml-1.5 mt-1.5 ${rule.isActive ? 'bg-teal-400' : 'bg-gray-300'}`} />
                                  )}
                                </td>

                                {/* Rule Summary / Intent */}
                                <td className="py-2.5 px-2 align-top max-w-[220px]">
                                  {(() => {
                                    // Strip "+N more" and split into action + condition
                                    const cleanName = displayName.replace(/\s*\+\s*\d+\s*more\s*$/i, '').trim();
                                    const whenIdx = cleanName.search(/\s+when\s+/i);
                                    const actionPart = whenIdx > -1 ? cleanName.slice(0, whenIdx).trim() : cleanName;
                                    const conditionPart = whenIdx > -1 ? cleanName.slice(whenIdx).replace(/^\s*when\s*/i, '').trim() : null;

                                    // Parse action into direction + amount + target
                                    const isInc = /^increase/i.test(actionPart);
                                    const isDec = /^decrease/i.test(actionPart);
                                    const amtMatch = actionPart.match(/(\d+(?:\.\d+)?%|\$\d+(?:,\d+)?)/i);
                                    const amtStr = amtMatch ? amtMatch[1] : null;
                                    // Target = everything after the dash (e.g. "AL", "All Rates")
                                    const dashIdx = actionPart.indexOf(' - ');
                                    const targetStr = dashIdx > -1 ? actionPart.slice(dashIdx + 3).trim() : null;

                                    // Effective date
                                    const rawEff = (rule as any).effectiveDate || (rule as any).createdAt;
                                    const eff = rawEff ? new Date(rawEff).toISOString().slice(0, 10) : null;
                                    const today = new Date().toISOString().slice(0, 10);
                                    const isFuture = eff ? eff > today : false;

                                    // Strategy badge
                                    const si = strategyAnalysis?.rules.find(r => r.id === rule.id);
                                    const sc = si ? (STRATEGY_COLORS[si.strategyGroup] || { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' }) : null;

                                    return (
                                      <div className="flex flex-col gap-1.5">
                                        {/* Action headline */}
                                        <div
                                          className="cursor-pointer group"
                                          onClick={() => { setInfoRule(rule); fetchStrategyAnalysis(); }}
                                          title={cleanName}
                                        >
                                          <div className="flex items-baseline gap-1.5 flex-wrap">
                                            {amtStr && (
                                              <span className={`text-sm font-bold tabular-nums ${isInc ? 'text-teal-600' : isDec ? 'text-rose-500' : 'text-gray-700'}`}>
                                                {isInc ? '+' : isDec ? '−' : ''}{amtStr}
                                              </span>
                                            )}
                                            {targetStr ? (
                                              <span className="text-sm font-semibold text-gray-800 group-hover:text-teal-700 group-hover:underline leading-snug">
                                                {targetStr}
                                              </span>
                                            ) : (
                                              <span className="text-sm font-semibold text-gray-800 group-hover:text-teal-700 group-hover:underline leading-snug">
                                                {!amtStr ? cleanName : (isInc ? 'Increase' : isDec ? 'Decrease' : actionPart)}
                                              </span>
                                            )}
                                          </div>
                                          {conditionPart && (
                                            <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">
                                              When {conditionPart}
                                            </p>
                                          )}
                                        </div>

                                        {/* Badges row */}
                                        <div className="flex flex-wrap gap-1">
                                          {eff && (
                                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${isFuture ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                                              {isFuture ? '▷ Starts' : 'Since'} {new Date(`${eff}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </span>
                                          )}
                                          {rule.isHistorical && (
                                            <span data-testid={`badge-historical-${rule.id}`} className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-cyan-50 text-cyan-600 border-cyan-200">
                                              Historical
                                            </span>
                                          )}
                                          {rule.isActive && !rule.isHistorical && (
                                            <span data-testid={`badge-stacking-${rule.id}`} className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${isAdditive ? 'bg-teal-50 text-teal-600 border-teal-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                                              {isAdditive ? 'Stacks' : 'Exclusive'}
                                            </span>
                                          )}
                                          {si && sc && (
                                            <span
                                              className={`text-[10px] font-medium px-1.5 py-0.5 rounded border cursor-pointer ${sc.bg} ${sc.text} ${sc.border}`}
                                              onClick={() => { setInfoRule(rule); }}
                                              title={si.intendedStrategy}
                                            >
                                              {si.strategyGroup}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </td>

                                {/* Rule Detail */}
                                <td className="py-2.5 px-2 align-top max-w-[280px]">
                                  <span className="text-xs text-gray-500 leading-relaxed line-clamp-3">
                                    {rule.description || '—'}
                                  </span>
                                  {/* Note: quick free-form context, shown here, in Reference Data, and on the Strategy Report */}
                                  {adminNoteDraft?.ruleId === rule.id ? (
                                    <div className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
                                      <Textarea
                                        value={adminNoteDraft.text}
                                        onChange={(e) => setAdminNoteDraft({ ruleId: rule.id, text: e.target.value })}
                                        className="min-h-[52px] text-xs"
                                        maxLength={500}
                                        autoFocus
                                        placeholder="Describe the change…"
                                        data-testid={`admin-note-edit-${rule.id}`}
                                      />
                                      <div className="flex justify-end gap-1">
                                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => setAdminNoteDraft(null)}>Cancel</Button>
                                        <Button size="sm" className="h-6 px-2 text-[11px]" disabled={adminNoteSaving}
                                          onClick={() => saveRuleNote(rule.id, adminNoteDraft.text)}
                                          data-testid={`admin-note-save-${rule.id}`}>
                                          Save
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (rule as any).notes ? (
                                    <button
                                      type="button"
                                      className="mt-1.5 flex w-full items-start gap-1 rounded border border-amber-200 bg-amber-50/70 px-1.5 py-1 text-left hover:bg-amber-50"
                                      onClick={() => setAdminNoteDraft({ ruleId: rule.id, text: (rule as any).notes ?? '' })}
                                      title="Edit note"
                                      data-testid={`admin-note-display-${rule.id}`}
                                    >
                                      <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                                      <span className="text-[11px] leading-snug text-amber-800 whitespace-pre-wrap">{(rule as any).notes}</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="mt-1 flex items-center gap-1 text-[10px] text-gray-400 hover:text-teal-600"
                                      onClick={() => setAdminNoteDraft({ ruleId: rule.id, text: '' })}
                                      data-testid={`admin-note-add-${rule.id}`}
                                    >
                                      <StickyNote className="h-3 w-3" /> Add note
                                    </button>
                                  )}
                                </td>

                                {/* Service Line */}
                                <td className="py-2.5 px-2 align-top">
                                  <span className="text-xs font-medium text-gray-700 whitespace-nowrap">{slDisplay}</span>
                                </td>

                                {/* Units Impacted */}
                                <td className="py-2.5 px-2 align-top text-right">
                                  <span className="text-sm font-medium text-gray-900 tabular-nums">
                                    {(rule.affectedUnits ?? 0).toLocaleString()}
                                  </span>
                                  {(rule.affectedCampuses ?? 0) > 0 && (
                                    <span className="block text-[10px] text-gray-400">
                                      {rule.affectedCampuses} campus{(rule.affectedCampuses ?? 0) !== 1 ? 'es' : ''}
                                    </span>
                                  )}
                                  {/* T3 move-in baseline chip */}
                                  {(() => {
                                    if (!t3MoveIns) return null;
                                    let moveInAvg: number | null = null;
                                    if (ruleSLs.length === 1 && t3MoveIns.byServiceLine[ruleSLs[0]] != null) {
                                      moveInAvg = t3MoveIns.byServiceLine[ruleSLs[0]];
                                    } else if (ruleSLs.length > 1) {
                                      const sum = ruleSLs.reduce((s, sl) => s + (t3MoveIns.byServiceLine[sl] ?? 0), 0);
                                      if (sum > 0) moveInAvg = sum;
                                    } else {
                                      moveInAvg = t3MoveIns.campus;
                                    }
                                    if (moveInAvg == null || moveInAvg <= 0) return null;
                                    return (
                                      <button
                                        onClick={() => setShowMoveInMethodology(true)}
                                        className="mt-1 text-[10px] font-medium text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 hover:bg-blue-100 transition-colors cursor-pointer inline-flex items-center gap-1"
                                        title="Click to see how this is calculated"
                                      >
                                        ~{moveInAvg.toFixed(1)}/mo
                                        <Info className="h-2.5 w-2.5 opacity-60" />
                                      </button>
                                    );
                                  })()}
                                </td>

                                {/* Revenue Impact */}
                                <td className="py-2.5 px-2 align-top text-right">
                                  {monthly !== 0 ? (
                                    <span className={`inline-flex items-center gap-1 text-sm font-semibold tabular-nums ${
                                      isPos ? 'text-green-700' : 'text-red-700'
                                    }`}>
                                      {isPos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                      {fmt(monthly)}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-gray-400">—</span>
                                  )}
                                  {annual !== 0 && (
                                    <span className="block text-[10px] text-gray-400 tabular-nums">{fmt(annual)} first-yr</span>
                                  )}
                                  {(rule.steadyStateAnnualImpact ?? 0) !== 0 && (
                                    <span className="block text-[10px] text-gray-400 tabular-nums">{fmt(rule.steadyStateAnnualImpact ?? 0)} ramped</span>
                                  )}
                                </td>

                                {/* Actions */}
                                <td className="py-2.5 px-2 align-top">
                                  {rule.isHistorical ? (
                                    <div className="flex items-center justify-end gap-0.5">
                                      <Button
                                        variant="outline" size="sm"
                                        className="h-7 text-xs gap-1 text-teal-700 border-teal-200 bg-teal-50 hover:bg-teal-100"
                                        disabled={reselectingId === rule.id}
                                        onClick={() => reselectRule(rule.id, rule.name.replace(/^Historical:\s*/i, ''))}
                                        title="Create a fresh active copy of this rule, effective today"
                                        data-testid={`button-reselect-${rule.id}`}
                                      >
                                        {reselectingId === rule.id ? 'Reselecting…' : 'Reselect'}
                                      </Button>
                                      <Button variant="ghost" size="icon"
                                        className="h-7 w-7 text-gray-400 hover:text-teal-600 hover:bg-teal-50"
                                        onClick={() => setInfoRule(rule)} title="Rule details">
                                        <Info className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  ) : (
                                  <>
                                  <div className="flex items-center justify-end gap-0.5">
                                    <Switch
                                      checked={rule.isActive}
                                      onCheckedChange={() => toggleRule(rule.id)}
                                      aria-label={`Toggle ${rule.name}`}
                                      data-testid={`switch-rule-${rule.id}`}
                                      className="shrink-0 mr-1"
                                    />
                                    <Button variant="ghost" size="icon"
                                      className="h-7 w-7 text-gray-400 hover:text-teal-600 hover:bg-teal-50"
                                      onClick={() => setInfoRule(rule)} title="Rule details">
                                      <Info className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon"
                                      className="h-7 w-7 text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                                      onClick={() => startEdit(rule)} title="Edit rule"
                                      data-testid={`button-edit-${rule.id}`}>
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon"
                                      className="h-7 w-7 text-gray-400 hover:text-red-600 hover:bg-red-50"
                                      onClick={() => deleteRule(rule.id, rule.name)} title="Delete rule"
                                      data-testid={`button-delete-${rule.id}`}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                  <div className="flex items-center justify-end gap-1.5 mt-1.5">
                                    <Switch
                                      id={`additive-${rule.id}`}
                                      checked={isAdditive}
                                      onCheckedChange={() => toggleAdditive(rule.id)}
                                      data-testid={`switch-additive-${rule.id}`}
                                      className="h-[18px] w-8 data-[state=checked]:bg-teal-500 shrink-0"
                                    />
                                    <label
                                      htmlFor={`additive-${rule.id}`}
                                      className="text-[10px] text-gray-500 hover:text-gray-700 cursor-pointer select-none whitespace-nowrap"
                                      title="Apply in addition to other rules"
                                    >
                                      stacks
                                    </label>
                                  </div>
                                  </>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {/* Manual override rows */}
                          {manualOverrides.map((mo) => (
                            <tr key={`override-${mo.id}`} className="border-b border-amber-100 bg-amber-50/40 hover:bg-amber-50/60 transition-colors">
                              <td className="py-2 px-2">
                                <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Manual override" />
                              </td>
                              <td className="py-2 px-2" colSpan={3}>
                                <div className="flex flex-col">
                                  <span className="text-xs font-medium text-amber-800">Manual Override</span>
                                  <span className="text-[10px] text-muted-foreground leading-tight">
                                    {mo.location_name} · {mo.service_line} · {mo.room_type}
                                  </span>
                                </div>
                              </td>
                              <td className="py-2 px-2 text-right text-xs font-semibold text-amber-700 tabular-nums">—</td>
                              <td className="py-2 px-2 text-right text-xs font-semibold text-amber-700 tabular-nums">
                                ${mo.override_rate.toLocaleString()}/mo
                              </td>
                              <td className="py-2 px-2 text-right">
                                <button
                                  type="button"
                                  className="text-[10px] text-red-500 hover:text-red-700 underline"
                                  onClick={() => clearManualOverride(mo.location_name, mo.service_line, mo.room_type)}
                                  title="Remove this manual override"
                                >Remove</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {activeCount > 0 && (
                          <tfoot>
                            <tr className="border-t-2 border-gray-200 bg-gray-50">
                              <td className="py-2.5 px-2" />
                              <td className="py-2.5 px-2 text-xs font-semibold text-gray-700" colSpan={3}>
                                Totals — {activeCount} active rule{activeCount > 1 ? 's' : ''}
                                {hasOverlap && <span className="font-normal text-gray-400 ml-1">(exclusive overlap removed)</span>}
                              </td>
                              <td className="py-2.5 px-2 text-right text-sm font-semibold text-gray-900 tabular-nums">
                                {(combinedStats?.uniqueUnits ?? combinedUnits).toLocaleString()}
                              </td>
                              <td className={`py-2.5 px-2 text-right text-sm font-semibold tabular-nums ${
                                (combinedStats?.combinedMonthly ?? combinedMonthly) >= 0 ? 'text-green-700' : 'text-red-700'
                              }`}>
                                {fmt(combinedStats?.combinedMonthly ?? combinedMonthly)}
                              </td>
                              <td className="py-2.5 px-2" />
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>

                    {/* Show more / less toggle */}
                    {adminGroupBy === 'none' && filteredRules.length > 5 && (
                      <button
                        type="button"
                        onClick={() => setRulesExpanded(e => !e)}
                        className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-teal-700 hover:text-teal-800 hover:bg-teal-50/60 rounded-lg border border-dashed border-gray-200 transition-colors"
                        data-testid="button-toggle-rules-expanded"
                      >
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${rulesExpanded ? 'rotate-180' : ''}`} />
                        {rulesExpanded
                          ? 'Show fewer rules'
                          : `Show all ${filteredRules.length} rules (${filteredRules.length - 5} more)`}
                      </button>
                    )}

                    {/* Exclusivity legend */}
                    {activeCount > 1 && (
                      <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-gray-500">
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 rounded border border-amber-200 bg-amber-500 shrink-0" />
                          <span><strong className="text-gray-700 font-semibold">Exclusive</strong> — first in priority order claims overlapping units</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 rounded border border-teal-200 bg-teal-500 shrink-0" />
                          <span><strong className="text-gray-700 font-semibold">Stacks</strong> — always applies on top of any other rule</span>
                        </span>
                      </div>
                    )}

                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* ── Pricing History — historical records of past pricing changes ── */}
            <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
              <Card className="w-full shadow-sm bg-white border border-gray-200">
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-4 cursor-pointer select-none hover:bg-gray-50 rounded-t-lg transition-colors" data-testid="pricing-history-header">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <History className="h-4 w-4 text-gray-500 shrink-0" />
                        <span className="text-base font-semibold text-gray-900">Pricing History</span>
                        {historyOpen && historyRules.length > 0 && (
                          <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-600 border border-gray-200 px-2 py-0.5 text-xs font-medium">{historyRules.length} records</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setHistoryReportOpen(true); }}
                          className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-teal-700 border border-slate-200 hover:border-teal-300 rounded-md px-2 py-1 bg-white hover:bg-teal-50 transition-colors"
                        >
                          <FileBarChart className="h-3.5 w-3.5" />
                          History Report
                        </button>
                        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${historyOpen ? '' : '-rotate-90'}`} />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Records of past pricing changes. These are for reference only and never change current rates.
                    </p>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 pb-4 px-4">
                    <div className="flex items-center gap-2 mb-3 text-xs text-gray-600">
                      <span className="font-medium text-gray-800">Show changes since:</span>
                      <input
                        type="date"
                        data-testid="pricing-history-from"
                        value={historyFrom}
                        onChange={e => setHistoryFrom(e.target.value)}
                        className="h-7 text-xs px-2 border border-gray-200 rounded-md bg-gray-50 hover:border-[var(--trilogy-teal)] transition-colors text-gray-900"
                      />
                      {historyLoading && <span className="text-[10px] text-gray-400">Loading…</span>}
                    </div>
                    {!historyLoading && historyRules.length === 0 && (
                      <p className="text-xs text-gray-500">No historical pricing changes since {historyFrom}.</p>
                    )}
                    {(() => {
                      const byDate = new Map<string, AdjustmentRule[]>();
                      for (const r of historyRules) {
                        const d = r.effectiveDate ? String(r.effectiveDate).slice(0, 10) : 'Unknown date';
                        if (!byDate.has(d)) byDate.set(d, []);
                        byDate.get(d)!.push(r);
                      }
                      return Array.from(byDate.entries()).map(([d, list]) => (
                        <div key={d} className="mb-3">
                          <p className="text-xs font-semibold text-gray-800 mb-1.5">
                            Effective {d === 'Unknown date' ? d : new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                            <span className="ml-2 font-normal text-gray-500">{list.length} change{list.length === 1 ? '' : 's'}</span>
                          </p>
                          <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                            {list.map((r: AdjustmentRule) => (
                              <div key={r.id} className="px-3 py-2 text-xs text-gray-700 bg-white" data-testid={`history-rule-${r.id}`}>
                                {r.description}
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            <HistoryReportModal
              open={historyReportOpen}
              onClose={() => setHistoryReportOpen(false)}
              locationId={locationId}
              locationName={locationName}
              serviceLine={serviceLine || undefined}
            />

            {/* ── Stats Breakdown Dialog ── */}
            <Dialog open={statsDialogOpen} onOpenChange={setStatsDialogOpen}>
              <DialogContent className="max-w-2xl bg-white border border-gray-200">
                <DialogHeader>
                  <DialogTitle className="text-gray-900 text-base">
                    {{
                      campuses: 'Campus Coverage — Active Rules',
                      units:    'Unit Coverage — Active Rules',
                      monthly:  'Monthly Impact — Active Rules',
                      annual:   'Annual Impact — Active Rules',
                    }[statsDialogFocus]}
                  </DialogTitle>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {statsDialogFocus === 'campuses' && combinedStats
                      ? `${combinedStats.uniqueCampuses} unique campus${combinedStats.uniqueCampuses !== 1 ? 'es' : ''} across all active rules (overlap removed)`
                      : statsDialogFocus === 'units' && combinedStats
                      ? `${combinedStats.uniqueUnits.toLocaleString()} unique units matched by at least one active rule`
                      : 'Monetary impact reflects expected new admissions only'}
                  </p>
                </DialogHeader>
                {combinedStats && combinedStats.breakdown.length > 0 ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">Rule</th>
                          <th className={`text-right px-3 py-2 text-xs font-semibold uppercase tracking-wide ${statsDialogFocus === 'campuses' ? 'text-teal-700 bg-teal-50' : 'text-gray-600'}`}>Campuses</th>
                          <th className={`text-right px-3 py-2 text-xs font-semibold uppercase tracking-wide ${statsDialogFocus === 'units' ? 'text-teal-700 bg-teal-50' : 'text-gray-600'}`}>Units</th>
                          <th className={`text-right px-3 py-2 text-xs font-semibold uppercase tracking-wide ${statsDialogFocus === 'monthly' ? 'text-teal-700 bg-teal-50' : 'text-gray-600'}`}>Monthly</th>
                          <th className={`text-right px-3 py-2 text-xs font-semibold uppercase tracking-wide ${statsDialogFocus === 'annual' ? 'text-teal-700 bg-teal-50' : 'text-gray-600'}`}>Annual</th>
                        </tr>
                      </thead>
                      <tbody>
                        {combinedStats.breakdown.map((row, i) => (
                          <tr key={row.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                            <td className="px-3 py-2.5 font-medium text-gray-800 max-w-[200px] truncate">{row.name}</td>
                            <td className={`px-3 py-2.5 text-right tabular-nums text-gray-700 ${statsDialogFocus === 'campuses' ? 'font-semibold text-teal-700 bg-teal-50/50' : ''}`}>{row.campuses.toLocaleString()}</td>
                            <td className={`px-3 py-2.5 text-right tabular-nums text-gray-700 ${statsDialogFocus === 'units' ? 'font-semibold text-teal-700 bg-teal-50/50' : ''}`}>{row.units.toLocaleString()}</td>
                            <td className={`px-3 py-2.5 text-right tabular-nums ${statsDialogFocus === 'monthly' ? 'font-semibold bg-teal-50/50' : ''} ${row.monthlyImpact >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(row.monthlyImpact)}</td>
                            <td className={`px-3 py-2.5 text-right tabular-nums ${statsDialogFocus === 'annual' ? 'font-semibold bg-teal-50/50' : ''} ${row.annualImpact >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(row.annualImpact)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                          <td className="px-3 py-2.5 text-gray-800">Total (unique)</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums ${statsDialogFocus === 'campuses' ? 'text-teal-700 bg-teal-50/50' : 'text-gray-800'}`}>{(combinedStats.uniqueCampuses).toLocaleString()}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums ${statsDialogFocus === 'units' ? 'text-teal-700 bg-teal-50/50' : 'text-gray-800'}`}>{(combinedStats.uniqueUnits).toLocaleString()}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums ${statsDialogFocus === 'monthly' ? 'bg-teal-50/50' : ''} ${combinedStats.combinedMonthly >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(combinedStats.combinedMonthly)}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums ${statsDialogFocus === 'annual' ? 'bg-teal-50/50' : ''} ${combinedStats.combinedAnnual >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(combinedStats.combinedAnnual)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    {(statsDialogFocus === 'campuses' || statsDialogFocus === 'units') && (
                      <p className="text-[11px] text-gray-400 mt-3 px-1">
                        Per-rule counts may sum to more than the total — campuses and units covered by multiple rules are only counted once in the total row.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="py-10 text-center text-gray-400 text-sm">No data available.</div>
                )}
              </DialogContent>
            </Dialog>

            {/* ── Bubble Map Dialog ── */}
            <Dialog open={bubbleMapOpen} onOpenChange={setBubbleMapOpen}>
              <DialogContent className="max-w-2xl bg-white border border-gray-200">
                <DialogHeader>
                  <DialogTitle className="text-gray-900 text-base">Rule Coverage — Bubble Map</DialogTitle>
                  <p className="text-xs text-gray-500 mt-1">
                    Each circle represents one rule. Circle size is proportional to units affected.
                    Hover for metrics — click any circle for AI strategy analysis.
                    {(locationId || serviceLine) && (
                      <span className="ml-1 text-teal-600 font-medium">
                        Filtered to {locationName || 'selected location'}{serviceLine ? ` · ${serviceLine}` : ''}.
                      </span>
                    )}
                  </p>
                </DialogHeader>

                {activeCount === 0 ? (
                  <div className="py-12 text-center text-gray-400 text-sm">No active rules to display.</div>
                ) : (
                  <div className="flex flex-wrap gap-5 p-6 bg-white rounded-xl border border-gray-100 justify-center items-end mt-2">
                    {(() => {
                      const impactCounts = sortedActive.map(r => {
                        const bd = combinedStats?.breakdown.find(b => b.id === r.id);
                        return Math.abs(bd ? bd.annualImpact : (r.annualImpact ?? 0));
                      });
                      const unitCounts = sortedActive.map(r => {
                        const bd = combinedStats?.breakdown.find(b => b.id === r.id);
                        return bd ? bd.units : (r.affectedUnits ?? 0);
                      });
                      const maxImpact = Math.max(...impactCounts, 1);
                      const MIN_R = 40, MAX_R = 96;

                      return sortedActive.map((rule, ri) => {
                        const breakdown = combinedStats?.breakdown.find(b => b.id === rule.id);
                        const units     = breakdown ? breakdown.units        : (rule.affectedUnits    ?? 0);
                        const monthly   = breakdown ? breakdown.monthlyImpact: (rule.monthlyImpact   ?? 0);
                        const annual    = breakdown ? breakdown.annualImpact : (rule.annualImpact     ?? 0);
                        const campuses  = breakdown ? breakdown.campuses     : (rule.affectedCampuses ?? 0);
                        const impact    = Math.abs(annual);
                        const t         = Math.sqrt(impact / maxImpact); // sqrt for visual area scaling
                        const radius    = MIN_R + t * (MAX_R - MIN_R);
                        const size      = Math.round(radius) * 2 + 4;
                        const isAdditive = isRuleAdditive(rule.action as any);
                        const color      = PALETTE[ri % PALETTE.length];
                        const isNeg      = annual < 0;
                        const isHovered  = hoveredBubble === rule.id;
                        const gradId     = `grad-${rule.id}`;
                        const bubbleSI   = strategyAnalysis?.rules.find(s => s.id === rule.id);
                        const bubbleSC   = bubbleSI ? (STRATEGY_COLORS[bubbleSI.strategyGroup] || { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' }) : null;
                        const showLabel  = radius >= 56;

                        return (
                          <div
                            key={rule.id}
                            className="relative flex flex-col items-center gap-2"
                            onMouseEnter={() => setHoveredBubble(rule.id)}
                            onMouseLeave={() => setHoveredBubble(null)}
                            onClick={() => { setBubbleMapOpen(false); setTimeout(() => setInfoRule(rule), 80); }}
                            style={{ cursor: 'pointer' }}
                            title="Click for AI strategy analysis"
                          >
                            <svg width={size} height={size} style={{ overflow: 'visible' }}>
                              <defs>
                                <radialGradient id={gradId} cx="38%" cy="35%" r="65%">
                                  <stop offset="0%"   stopColor={color} stopOpacity={isHovered ? 0.28 : 0.18} />
                                  <stop offset="100%" stopColor={color} stopOpacity={isHovered ? 0.52 : 0.38} />
                                </radialGradient>
                              </defs>
                              {/* Outer dashed ring for exclusive rules */}
                              {!isAdditive && (
                                <circle
                                  cx={size / 2} cy={size / 2} r={radius + 5}
                                  fill="none" stroke={color} strokeWidth={1.5}
                                  strokeDasharray="5 4" opacity={0.35}
                                />
                              )}
                              {/* Main bubble — solid fill with radial gradient */}
                              <circle
                                cx={size / 2} cy={size / 2} r={radius}
                                fill={`url(#${gradId})`}
                                stroke={color}
                                strokeWidth={isHovered ? 2.5 : 1.8}
                              />
                              {/* Impact label inside bubble (only when large enough) */}
                              {showLabel && annual !== 0 && (
                                <>
                                  <text
                                    x={size / 2} y={size / 2 - (bubbleSI ? 7 : 2)}
                                    textAnchor="middle" dominantBaseline="middle"
                                    fontSize={radius >= 70 ? 14 : 11}
                                    fontWeight="700"
                                    fill={color}
                                  >
                                    {isNeg ? '-' : '+'}{Math.abs(annual) >= 1000000
                                      ? `$${(Math.abs(annual)/1000000).toFixed(1)}M`
                                      : Math.abs(annual) >= 1000
                                      ? `$${Math.round(Math.abs(annual)/1000)}K`
                                      : `$${Math.round(Math.abs(annual))}`}
                                  </text>
                                  {bubbleSI && (
                                    <text
                                      x={size / 2} y={size / 2 + (radius >= 70 ? 16 : 12)}
                                      textAnchor="middle" dominantBaseline="middle"
                                      fontSize={9} fill={color} opacity={0.75}
                                    >
                                      {bubbleSI.strategyGroup}
                                    </text>
                                  )}
                                </>
                              )}
                              {/* Effective-date badge for exclusive rules */}
                              {!isAdditive && (
                                <text
                                  x={size / 2} y={size / 2 - radius + 13}
                                  textAnchor="middle" fontSize={9} fontWeight="600"
                                  fill={color} opacity={0.7}
                                >
                                  PRIORITY
                                </text>
                              )}
                            </svg>

                            {/* Label below bubble */}
                            <div className="text-center" style={{ maxWidth: Math.max(size + 8, 90) }}>
                              <p className="text-[11px] font-semibold text-gray-800 leading-tight line-clamp-2">
                                {rule.name}
                              </p>
                              <p className="text-[10px] text-gray-400 mt-0.5">{units.toLocaleString()} units · {campuses} campus{campuses !== 1 ? 'es' : ''}</p>
                            </div>

                            {/* Hover tooltip */}
                            {isHovered && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-50 pointer-events-none" style={{ minWidth: 200 }}>
                                <div className="bg-white border border-gray-200 rounded-xl shadow-2xl p-4">
                                  <div className="flex items-start justify-between gap-2 mb-2">
                                    <p className="text-xs font-bold text-gray-900 leading-snug">{rule.name}</p>
                                    {bubbleSC && bubbleSI && (
                                      <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${bubbleSC.bg} ${bubbleSC.text} ${bubbleSC.border}`}>
                                        {bubbleSI.strategyGroup}
                                      </span>
                                    )}
                                  </div>
                                  {bubbleSI?.aiSummary && (
                                    <p className="text-[10px] text-slate-500 italic mb-2 leading-snug border-l-2 border-teal-200 pl-2">{bubbleSI.aiSummary}</p>
                                  )}
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mb-2">
                                    <span className="text-gray-400">Units</span>
                                    <span className="font-semibold text-gray-900 text-right">{units.toLocaleString()}</span>
                                    <span className="text-gray-400">Campuses</span>
                                    <span className="font-semibold text-gray-900 text-right">{campuses}</span>
                                    <span className="text-gray-400">Monthly impact</span>
                                    <span className={`font-semibold text-right ${monthly >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(monthly)}</span>
                                    <span className="text-gray-400">First-year impact</span>
                                    <span className={`font-bold text-right ${annual >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(annual)}</span>
                                  </div>
                                  <div className="pt-2 border-t border-gray-100 flex justify-between text-[10px]">
                                    <span className="text-gray-400">Application mode</span>
                                    <span className={`font-semibold ${isAdditive ? 'text-teal-700' : 'text-amber-700'}`}>
                                      {isAdditive ? 'Additive' : 'Exclusive (priority)'}
                                    </span>
                                  </div>
                                </div>
                                <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
                                     style={{ borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: '7px solid #e5e7eb' }} />
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}

                {/* Legend */}
                <div className="flex flex-wrap gap-5 text-[11px] text-gray-500 pt-1 px-1">
                  <span className="flex items-center gap-1.5">
                    <svg width={14} height={14}><circle cx={7} cy={7} r={6} fill="none" stroke="#0d9488" strokeWidth={1.5} /></svg>
                    Additive — stacks with other rules
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg width={16} height={14}><circle cx={8} cy={7} r={6} fill="none" stroke="#d97706" strokeWidth={1.5} strokeDasharray="4 3" /></svg>
                    Exclusive — dashed ring, claims units by priority
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg width={10} height={10}><circle cx={5} cy={5} r={4} fill="#0d9488" opacity={0.3} /></svg>
                    Circle size ∝ first-year revenue impact
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
              const infoEffDate = (infoRule as any).effectiveDate ? String((infoRule as any).effectiveDate).slice(0, 10) : null;
              if (infoEffDate) {
                const d = new Date(`${infoEffDate}T00:00:00`);
                const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const isFuture = infoEffDate > new Date().toISOString().slice(0, 10);
                scopeLines.push(isFuture ? `Effective date: ${dateLabel} (scheduled — not applying yet)` : `Effective date: ${dateLabel}`);
              } else {
                scopeLines.push('Effective immediately');
              }

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

                      {/* AI Strategy Section */}
                      {(() => {
                        const si = strategyAnalysis?.rules.find(r => r.id === infoRule.id);
                        if (strategyLoading && !si) {
                          return (
                            <div className="rounded-lg bg-gradient-to-r from-sky-50 to-blue-50 border border-sky-100 p-3 flex items-center gap-2.5">
                              <Sparkles className="h-4 w-4 text-sky-400 animate-pulse shrink-0" />
                              <span className="text-xs text-sky-700">Generating AI strategy analysis…</span>
                            </div>
                          );
                        }
                        if (!si) return null;
                        const sc = STRATEGY_COLORS[si.strategyGroup] || { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' };
                        return (
                          <div className="rounded-lg bg-gradient-to-br from-sky-50/90 to-blue-50/60 border border-sky-100 p-4 space-y-3">
                            <div className="flex items-center gap-2">
                              <Sparkles className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">AI Strategy Analysis</span>
                              <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full border ${sc.bg} ${sc.text} ${sc.border}`}>
                                {si.strategyGroup}
                              </span>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Summary</p>
                              <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{si.aiSummary}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Intended Strategy</p>
                              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{si.intendedStrategy}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Expected Outcome</p>
                              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{si.expectedOutcome}</p>
                            </div>
                          </div>
                        );
                      })()}

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

                      {/* T3 Move-In Baseline */}
                      {t3MoveIns && (() => {
                        const ruleSLs: string[] = (infoRule.action as any)?.filters?.serviceLine || [];
                        const effectiveSLs = ruleSLs.length > 0 ? ruleSLs : (infoRule.serviceLine ? [infoRule.serviceLine] : []);
                        const rows = effectiveSLs.length > 0
                          ? effectiveSLs.map(sl => ({ sl, avg: t3MoveIns.byServiceLine[sl] ?? 0 }))
                          : Object.entries(t3MoveIns.byServiceLine).sort(([a],[b])=>a.localeCompare(b)).map(([sl, avg]) => ({ sl, avg }));
                        const total = rows.reduce((s, r) => s + r.avg, 0);
                        return (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
                              Expected Move-Ins / Month (T3 Baseline)
                            </p>
                            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden">
                              <table className="w-full">
                                <thead>
                                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                    <th className="text-left px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400">Service Line</th>
                                    <th className="text-right px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400">Move-Ins / Mo</th>
                                    <th className="text-right px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400">12-Mo Projection</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                  {rows.map(({ sl, avg }) => (
                                    <tr key={sl}>
                                      <td className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300">{sl}</td>
                                      <td className="px-3 py-1.5 text-sm text-right font-semibold text-gray-900 dark:text-gray-100">~{avg.toFixed(1)}</td>
                                      <td className="px-3 py-1.5 text-sm text-right text-gray-500 dark:text-gray-400">~{Math.round(avg * 12)}</td>
                                    </tr>
                                  ))}
                                  {rows.length > 1 && (
                                    <tr className="bg-gray-50 dark:bg-gray-800/80 font-semibold">
                                      <td className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300">Total</td>
                                      <td className="px-3 py-1.5 text-sm text-right text-gray-900 dark:text-gray-100">~{total.toFixed(1)}</td>
                                      <td className="px-3 py-1.5 text-sm text-right text-gray-500 dark:text-gray-400">~{Math.round(total * 12)}</td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                            <div className="flex items-center justify-between mt-1.5">
                              <p className="text-[11px] text-gray-400 dark:text-gray-500 italic">
                                T3 avg · unique events · HC/HC/MC = private pay only
                                {t3MoveIns.asOf && ` · through ${new Date(t3MoveIns.asOf).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
                              </p>
                              <button
                                onClick={() => setShowMoveInMethodology(true)}
                                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline shrink-0 ml-2"
                              >
                                How is this calculated? →
                              </button>
                            </div>
                          </div>
                        );
                      })()}

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

      {/* ── Move-In Methodology Dialog ── */}
      <Dialog open={showMoveInMethodology} onOpenChange={setShowMoveInMethodology}>
        <DialogContent className="max-w-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-white text-base">How Move-Ins Are Calculated</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white mb-1">Unique move-in events only</p>
                <p className="leading-relaxed">
                  Each monthly rent roll upload is a snapshot — the same resident appears in every snapshot until they leave. We deduplicate by <span className="font-medium text-gray-900 dark:text-white">room + move-in date + service line</span> so each resident is counted as one event, no matter how many uploads contain their record.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white mb-1">Trailing 3-month average</p>
                <p className="leading-relaxed">
                  We take the <span className="font-medium text-gray-900 dark:text-white">3 most recent calendar months</span> with move-in activity for this campus, count unique events per service line in each month, then average the 3. This smooths single-month spikes while staying responsive to recent trends.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white mb-1">HC and HC/MC: private pay only</p>
                <p className="leading-relaxed">
                  Medicaid and Medicare rates are set externally and unaffected by pricing rules. For HC and HC/MC, only residents with payor type <span className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">PRIVATE PAY</span> or <span className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">LEGACY - PVT PAY</span> are counted.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3">
              <p className="font-semibold text-gray-900 dark:text-white mb-1">What the number means</p>
              <p className="leading-relaxed text-gray-700 dark:text-gray-300">
                This is the <span className="font-semibold">"do nothing" baseline</span> — how many new residents you'd expect each month if the rule didn't exist and conditions stayed the same. It gives revenue impact context: a rule generating $2,000/mo means something very different at 2 move-ins/mo versus 8.
              </p>
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
              The chip on each rule card scopes to the rule's service line filter automatically. Single SL → that SL's T3 average. Multiple SLs → sum. No SL filter → campus total. The rule detail dialog scopes to the rule's configured service lines.
            </p>

          </div>

          <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
            <Button variant="outline" size="sm" onClick={() => setShowMoveInMethodology(false)} className="w-full">
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

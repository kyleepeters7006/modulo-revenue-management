import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Bot,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileText,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Role = "user" | "assistant";
type Source = { tool: string; label: string; detail?: string };
type Message = { role: Role; content: string; sources?: Source[] };

const suggestions = [
  "What needs my attention across the portfolio today?",
  "What recent AI rule suggestions should I review?",
  "Show me a portfolio view of pricing, demand, and competitor movement.",
];

function storageKey(clientId: string, userId?: string, username?: string) {
  return `modulo:assistant:${clientId}:${userId || username || "authenticated"}`;
}

const OPEN_ASSISTANT_EVENT = "modulo-assistant:open";

export function ModuloAssistantLauncher() {
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT))}
        aria-label="Open Modulo Assistant"
        title="Ask Modulo"
        data-testid="button-open-assistant"
        className="h-7 w-7 rounded-full border border-transparent bg-transparent p-0 text-[var(--trilogy-dark-blue)] shadow-none hover:border-[var(--trilogy-teal)]/20 hover:bg-[var(--trilogy-teal)]/10 hover:text-[var(--trilogy-teal)]"
      >
        <Sparkles className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setHidden(true)}
        aria-label="Hide Modulo Assistant until refresh"
        title="Hide until refresh"
        data-testid="button-hide-assistant"
        className="h-5 w-5 rounded-full bg-transparent p-0 text-slate-400 opacity-60 shadow-none hover:bg-slate-200/60 hover:text-slate-700 hover:opacity-100"
      >
        <X className="h-2.5 w-2.5" />
      </Button>
    </div>
  );
}

export default function ModuloAssistant() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [path] = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [failedPrompt, setFailedPrompt] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const key = user ? storageKey(user.clientId, user.id, user.username) : "";

  useEffect(() => {
    if (!isAuthenticated || !key) {
      setMessages([]);
      setHasLoaded(false);
      return;
    }
    try {
      const saved = sessionStorage.getItem(key);
      setMessages(saved ? JSON.parse(saved) : []);
    } catch {
      setMessages([]);
    }
    setHasLoaded(true);
  }, [isAuthenticated, key]);

  useEffect(() => {
    if (hasLoaded && key) sessionStorage.setItem(key, JSON.stringify(messages));
  }, [messages, hasLoaded, key]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 100);
      window.setTimeout(() => messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight }), 120);
    }
  }, [open]);

  useEffect(() => {
    const openAssistant = () => setOpen(true);
    window.addEventListener(OPEN_ASSISTANT_EVENT, openAssistant);
    return () => window.removeEventListener(OPEN_ASSISTANT_EVENT, openAssistant);
  }, []);

  useEffect(() => {
    if (open) messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, open]);

  if (isLoading || !isAuthenticated) return null;

  const send = async (text = draft, retry = false) => {
    const content = text.trim();
    if (!content || sending) return;
    const next = retry ? messages : [...messages, { role: "user" as const, content }];
    if (!retry) setMessages(next);
    setDraft("");
    setError("");
    setFailedPrompt("");
    setSending(true);
    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map(({ role, content: message }) => ({ role, content: message })),
          pageContext: { path },
        }),
      });
      if (!response.ok) throw new Error("The assistant could not respond.");
      const result: { message: string; model?: string; sources?: Source[] } = await response.json();
      setMessages([...next, { role: "assistant", content: result.message, sources: result.sources }]);
    } catch (requestError) {
      setFailedPrompt(content);
      setError(requestError instanceof Error ? requestError.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  };

  const clear = () => {
    setMessages([]);
    setError("");
    if (key) sessionStorage.removeItem(key);
    inputRef.current?.focus();
  };

  const uniqueSources = (sources: Source[]) => {
    const seen = new Set<string>();
    return sources.filter((source) => {
      const key = `${source.tool}|${source.label}`.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="assistant-title">
          <button aria-label="Close assistant" onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-slate-950/20 backdrop-blur-[1px] md:bg-transparent md:backdrop-blur-0" />
          <aside className="absolute bottom-0 right-0 flex h-[min(760px,100dvh)] w-full flex-col overflow-hidden border border-slate-200 bg-[#f8fafc] shadow-[-16px_0_50px_rgba(24,47,72,0.18)] md:bottom-4 md:right-4 md:h-[min(720px,calc(100dvh-32px))] md:w-[min(430px,calc(100vw-32px))] md:rounded-2xl">
            <header className="relative overflow-hidden bg-[var(--trilogy-dark-blue)] px-5 pb-5 pt-4 text-white">
              <div className="absolute -right-12 -top-14 h-36 w-36 rounded-full border-[18px] border-white/5" />
              <div className="relative flex items-start justify-between">
                <div className="flex gap-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-[var(--trilogy-teal-light)]">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 id="assistant-title" className="text-[15px] font-semibold tracking-tight">Modulo Assistant</h2>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Portfolio context is on</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={clear} aria-label="Clear conversation" className="h-8 w-8 text-slate-300 hover:bg-white/10 hover:text-white"><Trash2 className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close assistant" className="h-8 w-8 text-slate-300 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></Button>
                </div>
              </div>
              <p className="relative mt-4 max-w-[340px] text-xs leading-relaxed text-slate-300">Ask about recent AI rule suggestions or authorized portfolio data, including pricing, revenue, occupancy, demand, competitors, move-ins and move-outs, rate quality, elasticity, and benchmarks.</p>
            </header>

            <div ref={messagesRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5" aria-live="polite">
              {messages.length === 0 ? (
                <div className="flex min-h-full flex-col justify-center">
                  <div className="mb-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e2f1ef] text-[var(--trilogy-teal)]"><CircleHelp className="h-4 w-4" /></div>
                    <p className="text-xs leading-relaxed text-slate-600">I can connect the portfolio picture across pricing, revenue, occupancy, demand, competitors, rate quality, benchmarks, and recent AI rule suggestions—without access to resident-level or private data.</p>
                  </div>
                  <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Try asking</p>
                  <div className="space-y-2">
                     {suggestions.map((suggestion) => <button key={suggestion} onClick={() => send(suggestion)} className="group flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-xs text-slate-600 shadow-sm transition-colors hover:border-[var(--trilogy-teal-light)] hover:bg-[#f1f9f8]"><span>{suggestion}</span><ChevronDown aria-hidden="true" className="ml-2 h-3.5 w-3.5 shrink-0 -rotate-90 text-slate-300 group-hover:text-[var(--trilogy-teal)]" /></button>)}
                  </div>
                </div>
              ) : messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={cn("flex gap-2.5", message.role === "user" && "justify-end")}>
                  {message.role === "assistant" && <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#e2f1ef] text-[var(--trilogy-teal)]"><Sparkles className="h-3.5 w-3.5" /></div>}
                  <div className={cn("max-w-[84%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed", message.role === "user" ? "rounded-br-md bg-[var(--trilogy-dark-blue)] text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-700 shadow-sm")}>
                    <p className="whitespace-pre-wrap">{message.content}</p>
                     {message.sources && uniqueSources(message.sources).length > 0 && <div className="mt-3 border-t border-slate-100 pt-2.5"><p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><FileText className="h-3 w-3" />Sources</p><div className="space-y-1.5">{uniqueSources(message.sources).map((source, sourceIndex) => <div key={`${source.tool}-${source.label}-${source.detail || sourceIndex}`} className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] leading-snug text-slate-600"><span className="font-medium text-slate-700 break-words">{source.label}</span>{source.detail && <span className="text-slate-500"> · {source.detail}</span>}</div>)}</div></div>}
                  </div>
                </div>
              ))}
              {sending && <div className="flex items-center gap-2.5"><div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#e2f1ef] text-[var(--trilogy-teal)]"><Sparkles className="h-3.5 w-3.5" /></div><div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="flex gap-1"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:150ms]" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:300ms]" /></div></div></div>}
              {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><p>{error}</p><button onClick={() => send(failedPrompt, true)} className="mt-2 inline-flex items-center gap-1 font-semibold hover:underline"><RotateCcw className="h-3 w-3" />Try again</button></div>}
            </div>

            <footer className="border-t border-slate-200 bg-white p-3">
              <p className="mb-2 px-1 text-[10px] leading-relaxed text-slate-500">Answers use authorized portfolio data and should be reviewed before action.</p>
              <div className="rounded-xl border border-slate-300 bg-slate-50 p-2 transition-colors focus-within:border-[var(--trilogy-teal)] focus-within:ring-2 focus-within:ring-[var(--trilogy-teal-light)]/30">
                <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} disabled={sending} rows={2} placeholder="Ask about your portfolio…" aria-label="Message Modulo Assistant" className="w-full resize-none bg-transparent px-1 text-sm text-slate-700 outline-none placeholder:text-slate-400 disabled:opacity-60" />
                <div className="flex items-center justify-between pt-1">
                  <span className="flex items-center gap-1 px-1 text-[10px] text-slate-400"><Clock3 className="h-3 w-3" />Enter to send · Shift + Enter for new line</span>
                  <Button type="button" size="icon" onClick={() => send()} disabled={!draft.trim() || sending} aria-label="Send message" className="h-8 w-8 rounded-lg bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)]">{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
                </div>
              </div>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
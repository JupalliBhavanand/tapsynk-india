"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, CalendarDays, Check, Handshake, Loader2, Share2, UserPlus, X } from "lucide-react";
import { DirectBookingForm } from "@/components/DirectBookingForm";
import { ChatPanel } from "@/components/ChatWidget";
import { AI_BUTTON, AI_BUTTON_SUB } from "@/lib/greeting";
import { loadGreeting, unlockAudio } from "@/lib/speech";
import type { EventSource } from "@/lib/types";

export function CardActions({
  slug,
  ai,
  businessName,
  ownerName,
  intro,
  booking,
  logoUrl,
  source,
}: {
  slug: string;
  ai: boolean;
  businessName: string;
  ownerName: string;
  intro: string;
  booking: boolean;
  logoUrl?: string;
  source: EventSource;
}) {
  const [open, setOpen] = useState<"chat" | "lead" | "booking" | null>(null);
  const [contactHelp, setContactHelp] = useState(false);
  const [shareStatus, setShareStatus] = useState<"copied" | "manual" | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const shareLinkRef = useRef<HTMLInputElement>(null);
  const sharePending = useRef(false);
  const contactUrl = `/api/vcard/${encodeURIComponent(slug)}.vcf?s=${source[0]}`;

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!open || !overlay || !window.visualViewport) return;
    const visible = window.visualViewport;
    const update = () => {
      overlay.style.top = `${visible.offsetTop}px`;
      overlay.style.height = `${visible.height}px`;
    };
    update();
    visible.addEventListener("resize", update);
    visible.addEventListener("scroll", update);
    return () => {
      visible.removeEventListener("resize", update);
      visible.removeEventListener("scroll", update);
    };
  }, [open]);

  async function share() {
    if (sharePending.current) return;
    sharePending.current = true;
    setShareStatus(null);
    const url = `${window.location.origin}${window.location.pathname}`;
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: ownerName, url });
          return;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(url);
      setShareStatus("copied");
    } catch {
      setShareStatus("manual");
    } finally {
      sharePending.current = false;
    }
  }

  useEffect(() => {
    if (shareStatus === "manual") shareLinkRef.current?.select();
  }, [shareStatus]);

  // Get the AI's spoken greeting ready while the visitor looks at the card, so it plays the instant they tap.
  useEffect(() => {
    if (!ai) return;
    const t = setTimeout(() => void loadGreeting(slug), 600);
    return () => clearTimeout(t);
  }, [ai, slug]);

  const first = ownerName.split(" ")[0] || ownerName;

  function openChat() {
    // Phones only allow sound that starts inside a tap, so unlock it here for the AI's greeting.
    unlockAudio();
    setOpen("chat");
  }

  return (
    <>
      <a href={contactUrl} onClick={() => setContactHelp(true)} className="btn btn-dark w-full py-3.5 text-base">
        <UserPlus className="h-5 w-5" /> Save contact
      </a>
      {contactHelp && (
        <div className="rounded-xl bg-bg p-3 text-sm text-ink-2" role="status">
          <p>Confirm the import on your phone to finish saving. On iPhone, choose Create New Contact, then Done. On Android, open the downloaded .vcf file and choose your Contacts app.</p>
          <p className="mt-2">If it does not open, use Safari or Chrome, or <a href={`${contactUrl}&download=1`} className="font-semibold text-brand underline">download the contact file</a> and open it.</p>
        </div>
      )}
      {ai && (
        <button type="button" onClick={openChat} className="btn btn-primary relative w-full overflow-hidden py-2.5 text-base">
          <span className="absolute inset-0 -translate-x-full animate-[shine_2.8s_ease_1s_infinite] bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          <Bot className="h-5 w-5 shrink-0" />
          <span className="flex flex-col items-start leading-tight">
            <span>{AI_BUTTON}</span>
            <span className="text-xs font-medium text-white/80">{AI_BUTTON_SUB}</span>
          </span>
        </button>
      )}
      {ai && booking && <button type="button" onClick={() => setOpen("booking")} className="btn btn-cream w-full py-3"><CalendarDays className="h-5 w-5" />Book an appointment</button>}
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" onClick={() => setOpen("lead")} className="btn btn-cream w-full">
          <Handshake className="h-4 w-4" /> Share my contact
        </button>
        <button type="button" onClick={share} className="btn btn-ghost w-full">
          <Share2 className="h-4 w-4" /> Share card
        </button>
      </div>
      {shareStatus === "copied" && <p role="status" className="text-sm text-success">Card link copied.</p>}
      {shareStatus === "manual" && (
        <label className="block text-sm text-ink-2">
          Copy this link to share the card
          <input ref={shareLinkRef} className="input mt-1 text-base" value={`${window.location.origin}${window.location.pathname}`} onFocus={(e) => e.currentTarget.select()} readOnly />
        </label>
      )}

      {open && createPortal(
        <div ref={overlayRef} className="fixed inset-x-0 top-0 z-50 flex h-dvh items-end justify-center overflow-hidden bg-navy/40 sm:items-center sm:p-6" onClick={() => setOpen(null)}>
          {open === "chat" ? (
            <div className="h-full min-h-0 w-full max-w-md sm:h-[640px] sm:max-h-full" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Chat with ${businessName} AI`}>
              <ChatPanel slug={slug} businessName={businessName} ownerName={ownerName} intro={intro} booking={booking} logoUrl={logoUrl} source={source} onClose={() => setOpen(null)} className="h-full rounded-t-[28px] shadow-2xl sm:rounded-[28px]" />
            </div>
          ) : (
            <div className="max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={open === "booking" ? "Book an appointment" : `Share your contact with ${first}`}>
              {open === "booking" ? <DirectBookingForm slug={slug} source={source} onClose={() => setOpen(null)} /> : <LeadForm slug={slug} first={first} source={source} onClose={() => setOpen(null)} />}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function LeadForm({ slug, first, source, onClose }: { slug: string; first: string; source: EventSource; onClose: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", message: "", website: "" });
  const [state, setState] = useState<{ busy?: boolean; error?: string; done?: boolean }>({});
  const submitting = useRef(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    if (!form.email.trim() && !form.phone.trim()) {
      setState({ error: "Add an email or phone number." });
      return;
    }
    submitting.current = true;
    setState({ busy: true });
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, email: form.email.trim(), phone: form.phone.trim(), source }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not send your details.");
      setState({ done: true });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : "Could not send your details." });
    } finally {
      submitting.current = false;
    }
  }

  return (
    <div className="relative p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <button type="button" onClick={onClose} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-bg text-muted hover:text-ink" aria-label="Close">
        <X className="h-4 w-4" />
      </button>
      {state.done ? (
        <div className="py-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-success text-white"><Check className="h-7 w-7" /></span>
          <h2 className="mt-4 text-xl font-bold">Sent to {first}!</h2>
          <p className="mt-1 text-sm text-muted">{first} now has your details and will be in touch.</p>
          <button type="button" onClick={onClose} className="btn btn-dark mt-6">Done</button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <h2 className="pr-10 text-xl font-bold">Share your contact with {first}</h2>
          <p className="mt-1 text-sm text-muted">So {first} can follow up with you. Add an email or phone.</p>
          <div className="mt-5 grid gap-3">
            <input className="input text-base" aria-label="Your name" placeholder="Your name" value={form.name} onChange={set("name")} required maxLength={100} autoComplete="name" />
            <input className="input text-base" type="email" aria-label="Email" placeholder="Email" value={form.email} onChange={set("email")} maxLength={120} autoComplete="email" />
            <input className="input text-base" type="tel" aria-label="Phone" placeholder="Phone" value={form.phone} onChange={set("phone")} maxLength={40} autoComplete="tel" />
            <input className="input text-base" aria-label="Company (optional)" placeholder="Company (optional)" value={form.company} onChange={set("company")} maxLength={100} autoComplete="organization" />
            <textarea className="input resize-none text-base" rows={3} aria-label="Note (optional)" placeholder="Note (optional)" value={form.message} onChange={set("message")} maxLength={1000} />
            <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={set("website")} />
          </div>
          {state.error && <p role="alert" className="mt-3 text-sm text-stamp">{state.error}</p>}
          <button type="submit" disabled={state.busy} className="btn btn-primary mt-5 w-full py-3">
            {state.busy && <Loader2 className="h-4 w-4 animate-spin" />} Send my details
          </button>
        </form>
      )}
    </div>
  );
}

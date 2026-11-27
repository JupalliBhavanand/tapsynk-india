"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronsUpDown, ClipboardList,
  Copy, Download, IdCard, Package, Printer, QrCode, Search, Send, X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveFulfillment } from "./actions";
import { OrderInspector } from "./OrderInspector";
import {
  DATE_OPTIONS, PLAN_LABELS, STATUSES, STATUS_LABELS, countryName, dateBounds, dayKey, initials, locality, money,
  orderCsv, orderDate, orderStatusPatch, shiftDay, shippingLabel,
  type Currency, type DateRange, type Order, type OrderPatch, type PlanType, type Status,
} from "./orders";
import { cardSvg, svgUrl, saveFile } from "./print-assets";
import ui from "./orders.module.css";

type Notice = { id: number; text: string; error: boolean };
function CopyControl({ copied, label, onCopy }: { copied: boolean; label: string; onCopy: () => void }) {
  return (
    <button type="button" className={ui.textButton}
      title={copied ? "Copied!" : label} aria-label={copied ? "Copied!" : label} onClick={onCopy}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied!" : label}
    </button>
  );
}

type SavedOrder = Awaited<ReturnType<typeof saveFulfillment>> & { ok: true };

export function OrdersDashboard({ today, initialOrders, canSave }: { today: string; initialOrders: Order[]; canSave: boolean }) {
  const router = useRouter();
  const [savedOrders, setSavedOrders] = useState<Record<string, SavedOrder["rows"][number]>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const orders = useMemo(() => initialOrders.map((order) => {
    const saved = savedOrders[order.id];
    return saved && saved.version >= order.version ? { ...order, ...saved } : order;
  }), [initialOrders, savedOrders]);
  const [range, setRange] = useState<DateRange>("week");
  const [customFrom, setCustomFrom] = useState(shiftDay(today, -6));
  const [customTo, setCustomTo] = useState(today);
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<PlanType | "all">("all");
  const [status, setStatus] = useState<Status | "all">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [inspector, setInspector] = useState<{ id: string; section: "print" | "nfc" } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((text: string, error = false) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, text, error }));
    noticeTimer.current = setTimeout(() => setNotice(null), 3400);
  }, []);

  async function save(changes: Record<string, OrderPatch>, message: string) {
    if (!canSave || savingRef.current) return false;
    const updates = orders.filter((order) => changes[order.id])
      .map(({ id, version }) => ({ id, version, patch: changes[id]! }));
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await saveFulfillment(updates);
      if (!result.ok) {
        if ("refresh" in result && result.refresh) router.refresh();
        notify(result.message, true);
        return false;
      }
      setSavedOrders((current) => ({ ...current, ...Object.fromEntries(result.rows.map((row) => [row.id, row])) }));
      notify(message);
      return true;
    } catch {
      notify("Could not save. Refresh the order before retrying.", true);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function copy(text: string, key: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(""), 1800);
      notify(message);
    } catch {
      notify("Clipboard access is unavailable. Select and copy the text manually.", true);
    }
  }

  const [from, to] = dateBounds(range, today, customFrom, customTo);
  const invalidRange = Boolean(from && to && from > to);
  const period = orders.filter((order) => {
    const key = dayKey(order.createdAt);
    return !invalidRange && (!from || key >= from) && (!to || key <= to);
  });
  const needle = query.trim().toLowerCase();
  const matching = period.filter((order) => (
    (plan === "all" || plan === order.planType) &&
    (!needle || [order.id, order.orderNumber, order.customerName, order.email, order.company,
      ...order.cards.flatMap((card) => [card.profileSlug, card.name])]
      .some((value) => value.toLowerCase().includes(needle)))
  ));
  const counts = Object.fromEntries(STATUSES.map((value) => [value, 0])) as Record<Status, number>;
  for (const order of matching) counts[order.status]++;
  const filtered = matching.filter((order) => status === "all" || order.status === status)
    .sort((a, b) => sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt));
  const selectedOrders = filtered.filter((order) => selected.has(order.id));
  const allChecked = filtered.length > 0 && selectedOrders.length === filtered.length;
  const activeOrder = inspector ? orders.find((order) => order.id === inspector.id) : undefined;

  const todayOrders = orders.filter((order) => dayKey(order.createdAt) === today).length;
  const yesterdayOrders = orders.filter((order) => dayKey(order.createdAt) === shiftDay(today, -1)).length;
  const difference = todayOrders - yesterdayOrders;
  const pending = orders.filter((order) => order.status === "new" || order.status === "printing").length;
  const ready = orders.filter((order) => order.status === "encoded").length;
  const shippedToday = orders.filter((order) => order.shippedAt && dayKey(order.shippedAt) === today &&
    (order.status === "shipped" || order.status === "delivered")).length;
  const revenue: Record<Currency, number> = {};
  for (const order of period) if (order.status !== "cancelled") revenue[order.currency] = (revenue[order.currency] ?? 0) + order.amountPaid;
  const revenueText = (Object.keys(revenue) as Currency[]).filter((key) => revenue[key] > 0)
    .map((key) => money(revenue[key], key)).join(" + ") || "No revenue";

  function clearFilters() {
    setRange("week");
    setQuery("");
    setPlan("all");
    setStatus("all");
    setSelected(new Set());
  }

  function check(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function exportRows(rows: Order[], labels = false) {
    if (!rows.length) return;
    saveFile(orderCsv(rows, labels), (labels ? "shipping-labels-" : "orders-") + today + ".csv", "text/csv;charset=utf-8");
    notify(labels ? "Shipping labels exported." : "Orders exported.");
  }

  async function bulkUpdate(action: "printed" | "shipped") {
    const eligible = selectedOrders.filter((order) => action === "printed"
      ? (order.status === "new" || order.status === "printing") && !order.cardPrinted
      : order.status === "encoded");
    if (!eligible.length) {
      notify(action === "shipped" ? "Select an encoded order to mark it shipped." : "No selected orders are awaiting print.", true);
      return;
    }
    const changes = Object.fromEntries(eligible.map<[string, OrderPatch]>((order) => [order.id, action === "printed"
      ? { status: "printing", cardPrinted: true }
      : orderStatusPatch(order, "shipped")]));
    const skipped = selectedOrders.length - eligible.length;
    const message = eligible.length + (eligible.length === 1 ? " order" : " orders") + " marked " + action +
      (skipped ? ". " + skipped + " skipped." : ".");
    if (await save(changes, message)) setSelected(new Set());
  }

  function updateStatus(order: Order, next: Status) {
    if (next === order.status) return;
    void save({ [order.id]: orderStatusPatch(order, next) },
      order.orderNumber + " marked " + STATUS_LABELS[next].toLowerCase() + ".");
  }

  const open = (order: Order, section: "print" | "nfc" = "print") => setInspector({ id: order.id, section });

  return (
    <>
      <main className={ui.workspace}>
        <div className={ui.topBar}>
          <div className={ui.topInner}>
            <div className={ui.breadcrumb}>
              <span className={ui.brandMark}><IdCard size={18} strokeWidth={1.9} /></span>
              <span className={ui.brandName}>TapSynk</span>
              <span className={ui.breadcrumbDivider}>/</span>
              <span>Fulfillment</span>
            </div>
            <Link className={ui.outline} href="/dashboard">Back to dashboard</Link>
          </div>
        </div>

        <div className={ui.content}>
          <header className={ui.heading}>
            <div>
              <h1>Orders &amp; Fulfillment</h1>
              <p>Print, encode and ship your smart-card orders.</p>
            </div>
            <button className={ui.primary} type="button" onClick={() => exportRows(filtered)} disabled={!filtered.length}>
              <Download size={16} /> Export CSV
            </button>
          </header>

          {!canSave && <p className={ui.fieldError} role="alert">Orders are read-only until the fulfillment database migration is installed.</p>}
          <div className={ui.dateRow}>
            <div className={ui.dateSelector} role="group" aria-label="Order date range">
              {DATE_OPTIONS.map((option) => (
                <button key={option.id} type="button" aria-pressed={range === option.id}
                  className={range === option.id ? ui.dateActive : ""} onClick={() => setRange(option.id)}>
                  {option.id === "custom" && <CalendarDays size={14} />} {option.label}
                </button>
              ))}
            </div>
            <span className={ui.timezone}>India Standard Time</span>
          </div>
          {range === "custom" && (
            <div className={ui.customRange}>
              <label>From <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
              <label>To <input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
              {invalidRange && <p role="alert">The end date must be on or after the start date.</p>}
            </div>
          )}

          <section className={ui.metrics} aria-label="Fulfillment summary">
            <article className={ui.metric}>
              <div className={ui.metricTop}><span>Today&apos;s Orders</span><span className={ui.metricIcon}><ClipboardList size={17} /></span></div>
              <strong>{todayOrders}</strong>
              <div className={ui.metricDetail}>
                <span className={ui.delta} data-negative={difference < 0}>
                  {difference >= 0 ? <ArrowUpRight size={13} /> : <ArrowDown size={13} />}
                  {difference > 0 ? "+" : ""}{difference}
                </span> vs. yesterday
              </div>
            </article>
            <article className={ui.metric}>
              <div className={ui.metricTop}><span>Pending Print &amp; Encode</span><span className={ui.metricIcon} data-tone="amber"><Printer size={17} /></span></div>
              <strong>{pending}</strong>
              <div className={ui.metricDetail}>New or in printing</div>
            </article>
            <article className={ui.metric}>
              <div className={ui.metricTop}><span>Ready to Ship</span><span className={ui.metricIcon} data-tone="violet"><Package size={17} /></span></div>
              <strong>{ready}</strong>
              <div className={ui.metricDetail}>Encoded and awaiting dispatch</div>
            </article>
            <article className={ui.metric}>
              <div className={ui.metricTop}><span>Shipped Today / Revenue</span><span className={ui.metricIcon} data-tone="green"><Send size={16} /></span></div>
              <strong>{shippedToday}</strong>
              <div className={ui.metricDetail}><span className={ui.revenue}>{revenueText}</span> in selected period</div>
            </article>
          </section>

          <section className={ui.panel} aria-label="Orders">
            <div className={ui.panelHeading}>
              <div><h2>Orders</h2><span>{filtered.length}</span></div>
              <p>{period.length} {period.length === 1 ? "order" : "orders"} in selected period</p>
            </div>
            <div className={ui.toolbar}>
              <label className={ui.search}>
                <Search size={17} />
                <input type="search" placeholder="Search orders, customers or profiles…" aria-label="Search orders"
                  value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
              <label className={ui.planFilter}>
                <span className="sr-only">Filter by plan</span>
                <select value={plan} onChange={(event) => setPlan(event.target.value as PlanType | "all")}>
                  <option value="all">All Plans</option>
                  {Object.entries(PLAN_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <ChevronDown size={14} />
              </label>
            </div>
            <div className={ui.statusFilters} role="group" aria-label="Filter by fulfillment status">
              {(["all", ...STATUSES] as const).map((value) => (
                <button type="button" key={value} aria-pressed={status === value}
                  data-active={status === value} onClick={() => setStatus(value)}>
                  {value !== "all" && <span className={ui.statusDot} data-status={value} />}
                  {value === "all" ? "All" : STATUS_LABELS[value]}
                  <span className={ui.filterCount}>{value === "all" ? matching.length : counts[value]}</span>
                </button>
              ))}
            </div>

            {selectedOrders.length > 0 && (
              <div className={ui.bulk} aria-label="Bulk actions">
                <strong>{selectedOrders.length} selected</strong>
                <button type="button" disabled={!canSave || saving} onClick={() => void bulkUpdate("printed")}><Printer size={14} /> Mark as Printed</button>
                <button type="button" disabled={!canSave || saving} onClick={() => void bulkUpdate("shipped")}><Send size={14} /> Mark as Shipped</button>
                <button type="button" onClick={() => exportRows(selectedOrders, true)}><Download size={14} /> Export Selected Shipping Labels</button>
                <button type="button" className={ui.bulkClear} aria-label="Clear selection" onClick={() => setSelected(new Set())}><X size={15} /></button>
              </div>
            )}

            {filtered.length ? (
              <div className={ui.tableScroll} tabIndex={0} role="region" aria-label="Order list, scroll to view all columns">
                <table className={ui.table}>
                  <thead>
                    <tr>
                      <th scope="col"><input type="checkbox" aria-label="Select all visible orders" checked={allChecked}
                        ref={(node) => { if (node) node.indeterminate = selectedOrders.length > 0 && !allChecked; }}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSelected((current) => {
                            const next = new Set(current);
                            for (const order of filtered) if (checked) next.add(order.id); else next.delete(order.id);
                            return next;
                          });
                        }} /></th>
                      <th scope="col" aria-sort={sort === "newest" ? "descending" : "ascending"}>
                        <button type="button" className={ui.sortButton} onClick={() => setSort(sort === "newest" ? "oldest" : "newest")}>Order &amp; date <ChevronsUpDown size={13} /></button>
                      </th>
                      <th scope="col">Customer</th>
                      <th scope="col">Card design</th>
                      <th scope="col">Profile link</th>
                      <th scope="col">Shipping address</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((order) => {
                      const card = order.cards.length === 1 ? order.cards[0] : undefined;
                      return <tr key={order.id} data-selected={selected.has(order.id)} onClick={(event) => {
                        if (event.target instanceof Element &&
                            !event.target.closest("button, input, select, a, label") &&
                            !window.getSelection()?.toString()) open(order);
                      }}>
                        <td><input type="checkbox" aria-label={"Select " + order.orderNumber} checked={selected.has(order.id)}
                          onChange={(event) => check(order.id, event.target.checked)} /></td>
                        <td>
                          <button type="button" className={ui.orderId} onClick={() => open(order)}>{order.orderNumber}</button>
                          <time className={ui.secondary} dateTime={order.createdAt}>{orderDate(order.createdAt, today)}</time>
                          <span className={ui.planBadge} data-plan={order.planType}>{order.planType === "team" ? "Team ×" + order.quantity : PLAN_LABELS[order.planType]}</span>
                        </td>
                        <td>
                          <div className={ui.customer}>
                            <span className={ui.avatar} style={{ backgroundColor: card ? card.cardDesign.accentColor + "22" : undefined }}>{initials(order.customerName)}</span>
                            <div>
                              <strong>{order.customerName}</strong>
                              <span className={ui.secondary} title={order.role + " · " + order.company}>
                                {order.role} · {order.company}
                              </span>
                              <span className={ui.secondary}>{order.email}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          {card ? (
                            <button type="button" className={ui.thumbnail} onClick={() => open(order)}
                              aria-label={"Preview card for " + card.name}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={svgUrl(cardSvg(card, "front"))} width="86" height="54" alt="" />
                            </button>
                          ) : <span className={ui.secondary}>{order.cards.length ? order.cards.length + " profiles" : "No card yet"}</span>}
                        </td>
                        <td>
                          {card ? (
                            <>
                              <code className={ui.profileUrl} title={card.profileUrl}>{card.profileUrl}</code>
                              <div className={ui.rowControls}>
                                <CopyControl label="Copy Link" copied={copied === order.id + "-link"}
                                  onCopy={() => void copy(card.profileUrl, order.id + "-link", "Profile link copied.")} />
                                <button className={ui.iconButton} type="button" onClick={() => open(order, "nfc")}
                                  aria-label={"Preview QR code for " + card.name} title="Preview QR code"><QrCode size={15} /></button>
                              </div>
                            </>
                          ) : order.cards.length > 1 ? (
                            <button className={ui.textButton} type="button" onClick={() => open(order, "nfc")}>Choose a profile</button>
                          ) : <span className={ui.secondary}>Profile not created</span>}
                        </td>
                        <td>
                          <span className={ui.addressLine} title={shippingLabel(order)}>{order.shippingAddress.line1 || "No shipping address"}</span>
                          <span className={ui.secondary}>{[locality(order), countryName(order.shippingAddress.country)].filter(Boolean).join(", ")}</span>
                          {order.shippingAddress.line1 && <CopyControl label="Copy Address" copied={copied === order.id + "-address"}
                            onCopy={() => void copy(shippingLabel(order), order.id + "-address", "Shipping address copied.")} />}
                        </td>
                        <td>
                          <label className={ui.statusSelect} data-status={order.status}>
                            <span className={ui.statusDot} data-status={order.status} />
                            <span className="sr-only">Fulfillment status for {order.orderNumber}</span>
                            <select value={order.status} disabled={!canSave || saving} onChange={(event) => updateStatus(order, event.target.value as Status)}>
                              {STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
                            </select>
                            <ChevronDown size={12} />
                          </label>
                        </td>
                        <td>
                          <button type="button" className={ui.inspectButton} onClick={() => open(order)}>
                            <Printer size={15} /> Inspect &amp; Print
                          </button>
                        </td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={ui.empty}>
                <span><Search size={21} /></span>
                <h3>{orders.length ? "No orders match your filters" : "No orders yet"}</h3>
                <p>{orders.length ? "Change the date range, search or order filters." : "Orders from TapSynk checkout will appear here."}</p>
                {orders.length > 0 && <button type="button" className={ui.outline} onClick={clearFilters}>Clear filters</button>}
              </div>
            )}
            <div className={ui.tableFooter}>
              Showing {filtered.length} of {period.length} {period.length === 1 ? "order" : "orders"}
            </div>
          </section>
        </div>
        {!activeOrder && notice && <Toast notice={notice} close={() => setNotice(null)} />}
      </main>

      {activeOrder && inspector && (
        <OrderInspector key={activeOrder.id} order={activeOrder} initialSection={inspector.section}
          copied={copied} copy={copy} close={() => setInspector(null)} notify={notify}
          saving={saving || !canSave} onSave={(patch, message) => save({ [activeOrder.id]: patch }, message)}>
          {notice && <Toast notice={notice} close={() => setNotice(null)} />}
        </OrderInspector>
      )}
    </>
  );
}

function Toast({ notice, close }: { notice: Notice; close: () => void }) {
  return <div className={ui.toast} key={notice.id} role={notice.error ? "alert" : "status"} data-error={notice.error}>
    <span>{notice.error ? <X size={15} /> : <Check size={15} />}</span>
    {notice.text}
    <button type="button" aria-label="Dismiss notification" onClick={close}><X size={15} /></button>
  </div>;
}

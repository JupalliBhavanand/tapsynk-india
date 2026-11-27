export type Status = "new" | "printing" | "encoded" | "shipped" | "delivered" | "cancelled";
export type PlanType = "virtual" | "ai" | "team";
export type Currency = string;

export interface Order {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string;
  email: string;
  phone: string;
  company: string;
  role: string;
  planType: PlanType;
  quantity: number;
  amountPaid: number;
  currency: Currency;
  cards: OrderCard[];
  version: number;
  shippingAddress: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  status: Status;
  nfcEncoded: boolean;
  cardPrinted: boolean;
  shippedAt: string | null;
  trackingNumber: string;
  carrier: string;
  notes: string;
}

export interface OrderCard {
  id: string;
  name: string;
  company: string;
  role: string;
  published: boolean;
  profileSlug: string;
  profileUrl: string;
  cardDesign: {
    template: "classic" | "stripe" | "frame";
    backgroundColor: string;
    textColor: string;
    accentColor: string;
    finish: string;
    logoUrl: string | null;
    showQrOnBack: boolean;
  };
}

export const TIME_ZONE = "Asia/Kolkata";
export const STATUS_LABELS = {
  new: "New",
  printing: "Printing",
  encoded: "Encoded",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
} satisfies Record<Status, string>;
export const STATUSES = ["new", "printing", "encoded", "shipped", "delivered", "cancelled"] as const;
export const PLAN_LABELS = {
  virtual: "Virtual Card",
  ai: "AI Card",
  team: "Company Team Order",
} satisfies Record<PlanType, string>;
export const CARRIERS = ["India Post", "Delhivery", "USPS", "UPS", "FedEx", "DHL", "Other"] as const;
const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });
export function countryName(code: string) {
  return /^[A-Za-z]{2}$/.test(code) ? regionNames.of(code.toUpperCase()) ?? code : code;
}
export const DATE_OPTIONS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "Last 7 Days" },
  { id: "month", label: "Last 30 Days" },
  { id: "all", label: "All Time" },
  { id: "custom", label: "Custom" },
] as const;
export type DateRange = (typeof DATE_OPTIONS)[number]["id"];

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true,
});
const shortDate = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE, day: "numeric", month: "short",
});

export function dayKey(value: Date | string) {
  const parts = dayFormat.formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return [part("year"), part("month"), part("day")].join("-");
}

export function shiftDay(day: string, offset: number) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function dateBounds(range: DateRange, today: string, from: string, to: string) {
  switch (range) {
    case "today": return [today, today] as const;
    case "yesterday": {
      const previous = shiftDay(today, -1);
      return [previous, previous] as const;
    }
    case "week": return [shiftDay(today, -6), today] as const;
    case "month": return [shiftDay(today, -29), today] as const;
    case "custom": return [from, to] as const;
    default: return ["", ""] as const;
  }
}

export function orderDate(value: string, today: string) {
  const day = dayKey(value);
  const date = day === today ? "Today" : day === shiftDay(today, -1) ? "Yesterday" : shortDate.format(new Date(value));
  return date + ", " + timeFormat.format(new Date(value));
}

export function money(minorUnits: number, currency: Currency) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency", currency, maximumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
  }).format(minorUnits / 100);
}

export function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase();
}

export function locality(order: Order) {
  const address = order.shippingAddress;
  return [address.city, [address.state, address.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export function shippingLabel(order: Order) {
  const address = order.shippingAddress;
  return [order.customerName, address.line1, address.line2, locality(order), countryName(address.country), order.phone]
    .filter(Boolean).join("\n");
}

export function orderStatusPatch(order: Order, status: Status): OrderPatch {
  switch (status) {
    case "new": return { status, cardPrinted: false, nfcEncoded: false };
    case "printing": return { status, cardPrinted: order.cardPrinted, nfcEncoded: false };
    case "encoded": return { status, cardPrinted: true, nfcEncoded: true };
    case "shipped":
    case "delivered": return { status, cardPrinted: true, nfcEncoded: true };
    default: return { status };
  }
}

export type OrderPatch = Partial<Pick<Order,
  "status" | "cardPrinted" | "nfcEncoded" | "trackingNumber" | "carrier" | "notes"
>>;

function csvCell(value: string | number) {
  const text = String(value);
  // Quoting alone does not prevent spreadsheet formula evaluation.
  const safe = typeof value === "string" && /^[\s]*[=+\-@\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function orderCsv(orders: Order[], labelsOnly = false) {
  const shippingFields = ["Recipient", "Phone", "Address line 1", "Address line 2", "City", "State", "Postal code", "Country"];
  const header = labelsOnly
    ? ["Order", ...shippingFields]
    : ["Order", "Created at (UTC)", "Email", "Company", "Role", "Plan", "Quantity", "Amount paid",
        "Currency", "Status", "Profile slug", "NFC URL", "Carrier", "Tracking number", ...shippingFields];
  return "\uFEFF" + [header, ...orders.map((order) => {
    const address = order.shippingAddress;
    const shipping = [order.customerName, order.phone, address.line1, address.line2, address.city,
      address.state, address.postalCode, countryName(address.country)];
    return labelsOnly ? [order.orderNumber, ...shipping] : [
      order.orderNumber, order.createdAt, order.email, order.company, order.role, PLAN_LABELS[order.planType],
      order.quantity, (order.amountPaid / 100).toFixed(2), order.currency, STATUS_LABELS[order.status],
      order.cards.map((card) => card.profileSlug).join("; "), order.cards.map((card) => card.profileUrl).join("; "), order.carrier, order.trackingNumber, ...shipping,
    ];
  })].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

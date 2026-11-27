import "server-only";
import { SITE_URL, TAPSYNK_PROFILE_TABLE } from "@/lib/env";
import { loadListRows } from "@/lib/list-data";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ShippingAddress } from "@/lib/types";
import type { Order, OrderCard, Status } from "./orders";

export type SavedFulfillment = {
  id: string;
  fulfillment_status: Status | "processing";
  card_printed?: boolean;
  nfc_encoded?: boolean;
  shipped_at?: string | null;
  tracking_number?: string;
  shipping_carrier?: string;
  fulfillment_notes?: string;
  fulfillment_version?: number;
};

type DbOrder = SavedFulfillment & {
  user_id: string; company_id: string | null; receipt_number: string; created_at: string;
  tier: "virtual" | "ai"; quantity: number; amount_total: number; currency: string;
  shipping_name: string | null; shipping_address: (ShippingAddress & { email?: string; phone?: string }) | null;
};

type CardRow = {
  id: string; user_id: string; company_id: string | null; slug: string;
  full_name: string; company: string; job_title: string; accent: string;
  logo_url: string; email: string; published: boolean;
};
type Buyer = { id: string; full_name: string | null; email: string | null };
type Team = { id: string; name: string };
type Note = { order_id: string; notes: string };

const profileOrigin = (
  process.env.TAPSYNK_CARD_PROFILE_ORIGIN ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : SITE_URL)
).replace(/\/$/, "");

export function fulfillmentFromRow(row: SavedFulfillment) {
  const status = row.fulfillment_status === "processing" ? "new" : row.fulfillment_status;
  const finished = status === "encoded" || status === "shipped" || status === "delivered";
  return {
    id: row.id, status, cardPrinted: row.card_printed ?? finished, nfcEncoded: row.nfc_encoded ?? finished,
    shippedAt: row.shipped_at ?? null, trackingNumber: row.tracking_number ?? "",
    carrier: row.shipping_carrier ?? "", notes: row.fulfillment_notes ?? "",
    version: row.fulfillment_version ?? 0,
  };
}

async function inBatches<T>(ids: string[], read: (ids: string[]) => Promise<T[]>) {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 75) rows.push(...await read(ids.slice(index, index + 75)));
  return rows;
}

function toCard(card: CardRow): OrderCard {
  return {
    id: card.id, name: card.full_name, role: card.job_title, company: card.company,
    profileSlug: card.slug, profileUrl: profileOrigin + "/c/" + encodeURIComponent(card.slug), published: card.published,
    cardDesign: {
      template: "stripe", backgroundColor: "#141629", textColor: "#FFFFFF",
      accentColor: /^#[\da-f]{6}$/i.test(card.accent) ? card.accent : "#2563EB",
      finish: "", logoUrl: card.logo_url || null, showQrOnBack: true,
    },
  };
}

export async function loadOrders() {
  const db = createAdminClient();
  const [{ error: versionError }, { error: notesError }, rows] = await Promise.all([
    db.from("orders").select("fulfillment_version").limit(0),
    db.from("order_fulfillment_notes").select("order_id").limit(0),
    loadListRows<DbOrder>((from, to) => db.from("orders").select("*")
      .order("created_at", { ascending: false }).order("id").range(from, to)),
  ]);
  const canSave = !versionError && !notesError;
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const personalIds = [...new Set(rows.filter((row) => !row.company_id).map((row) => row.user_id))];
  const companyIds = [...new Set(rows.flatMap((row) => row.company_id ? [row.company_id] : []))];
  const cardFields = "id,user_id,company_id,slug,full_name,company,job_title,accent,logo_url,email,published";
  const [buyers, personal, employee, teams, notes] = await Promise.all([
    inBatches<Buyer>(userIds, (ids) => loadListRows((from, to) =>
      db.from(TAPSYNK_PROFILE_TABLE).select("id,full_name,email").in("id", ids).order("id").range(from, to))).catch(() => []),
    inBatches<CardRow>(personalIds, (ids) => loadListRows((from, to) =>
      db.from("cards").select(cardFields).in("user_id", ids).is("company_id", null).order("id").range(from, to))),
    inBatches<CardRow>(companyIds, (ids) => loadListRows((from, to) =>
      db.from("cards").select(cardFields).in("company_id", ids).order("full_name").order("id").range(from, to))),
    inBatches<Team>(companyIds, (ids) => loadListRows((from, to) =>
      db.from("companies").select("id,name").in("id", ids).order("id").range(from, to))),
    !canSave ? Promise.resolve([]) : inBatches<Note>(rows.map((row) => row.id), (ids) => loadListRows((from, to) =>
      db.from("order_fulfillment_notes").select("order_id,notes").in("order_id", ids).order("order_id").range(from, to))),
  ]);
  const noteByOrder = new Map(notes.map((note) => [note.order_id, note.notes]));
  const buyerById = new Map(buyers.map((buyer) => [buyer.id, buyer]));
  const personalById = new Map(personal.map((card) => [card.user_id, card]));
  const teamById = new Map(teams.map((team) => [team.id, team.name]));
  const cardsByTeam = new Map<string, OrderCard[]>();
  for (const card of employee) {
    if (!card.company_id) continue;
    const list = cardsByTeam.get(card.company_id) ?? [];
    list.push(toCard(card));
    cardsByTeam.set(card.company_id, list);
  }

  const orders: Order[] = rows.map((row) => {
    const buyer = buyerById.get(row.user_id);
    const personalCard = personalById.get(row.user_id);
    const shipping = row.shipping_address;
    return {
      ...fulfillmentFromRow({ ...row, fulfillment_notes: noteByOrder.get(row.id) }),
      orderNumber: row.receipt_number, createdAt: row.created_at,
      customerName: row.shipping_name || buyer?.full_name || personalCard?.full_name || "Recipient unavailable",
      email: shipping?.email || buyer?.email || personalCard?.email || "",
      phone: shipping?.phone || "",
      company: row.company_id ? teamById.get(row.company_id) ?? "" : personalCard?.company ?? "",
      role: personalCard?.job_title ?? "",
      planType: row.company_id ? "team" : row.tier, quantity: row.quantity,
      amountPaid: row.amount_total, currency: row.currency.toUpperCase(),
      cards: row.company_id ? cardsByTeam.get(row.company_id) ?? [] : personalCard ? [toCard(personalCard)] : [],
      shippingAddress: {
        line1: shipping?.line1 ?? "", line2: shipping?.line2 ?? "", city: shipping?.city ?? "",
        state: shipping?.state ?? "", postalCode: shipping?.postal_code ?? "", country: shipping?.country ?? "",
      },
    };
  });
  return { orders, canSave };
}

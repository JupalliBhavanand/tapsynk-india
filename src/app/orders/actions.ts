"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isFulfillmentAdminEmail } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { fulfillmentFromRow, type SavedFulfillment } from "./order-data";
import { CARRIERS, STATUSES } from "./orders";

const updateSchema = z.array(z.object({
  id: z.uuid(),
  version: z.number().int().nonnegative(),
  patch: z.object({
    status: z.enum(STATUSES).optional(),
    cardPrinted: z.boolean().optional(),
    nfcEncoded: z.boolean().optional(),
    trackingNumber: z.string().trim().max(100).optional(),
    carrier: z.enum(["", ...CARRIERS]).optional(),
    notes: z.string().trim().max(1500).optional(),
  }).strict().refine((patch) => Object.keys(patch).length > 0),
})).min(1).max(500).refine((updates) => new Set(updates.map((update) => update.id)).size === updates.length);

export async function saveFulfillment(input: unknown) {
  const { user } = await getUser();
  if (!isFulfillmentAdminEmail(user?.email)) return { ok: false as const, message: "You do not have fulfillment access." };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Choose up to 500 orders and enter valid fulfillment details." };

  const { error, data } = await createAdminClient().rpc("save_order_fulfillment", {
    p_updates: parsed.data.map(({ id, version, patch }) => ({
      id, version, patch: { ...patch, status: patch.status === "new" ? "processing" : patch.status },
    })),
  });
  if (error) {
    return {
      ok: false as const,
      refresh: error.code === "40001",
      message: error.code === "40001" ? "An order changed. The queue has been refreshed. Try again." :
        "Could not save fulfillment changes. Check that the database migration is installed.",
    };
  }
  revalidatePath("/dashboard/billing");
  return { ok: true as const, rows: (data as SavedFulfillment[]).map(fulfillmentFromRow) };
}

import type Anthropic from "@anthropic-ai/sdk";
import type pg from "pg";
import { z } from "zod";
import { getOrder, getShipment, listOrdersForCustomer } from "../api/orders.js";
import type { Session } from "./session.js";

export type ToolContext = {
  session: Session;
  pool: pg.Pool;
};

export type ToolOutcome = { ok: true; content: string } | { ok: false; error: string };

type ToolSpec<Schema extends z.ZodType> = {
  name: string;
  description: string;
  input: Schema;
  run: (ctx: ToolContext, input: z.infer<Schema>) => Promise<ToolOutcome>;
};

// Helper so each tool's `run` gets its input type inferred from its own schema.
const defineTool = <Schema extends z.ZodType>(spec: ToolSpec<Schema>) => spec;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const ok = (data: unknown): ToolOutcome => ({ ok: true, content: JSON.stringify(data) });
const fail = (error: string): ToolOutcome => ({ ok: false, error });

const OrderIdInput = z.strictObject({
  orderId: z.number().int().positive().describe("Order number, e.g. 1042"),
});

// Identity is never a tool input: tools read it from ctx.session.
const TOOLS = [
  defineTool({
    name: "list_my_orders",
    description:
      "List the current customer's most recent orders (newest first) with status, total and date. " +
      "Use this when the customer doesn't give an order number.",
    input: z.strictObject({}),
    run: async (ctx) => {
      const orders = await listOrdersForCustomer(ctx.pool, ctx.session.customerId);
      return ok(
        orders.map((o) => ({
          orderId: o.id,
          status: o.status,
          total: money(o.totalCents),
          items: o.itemCount,
          orderedOn: day(o.createdAt),
        })),
      );
    },
  }),

  defineTool({
    name: "get_order",
    description:
      "Get full details of one order by its number: status, items, total, amount already refunded, " +
      "shipping address and dates.",
    input: OrderIdInput,
    run: async (ctx, { orderId }) => {
      const order = await getOrder(ctx.pool, orderId);
      if (!order) return fail(`Order ${orderId} not found`);
      return ok({
        orderId: order.id,
        status: order.status,
        total: money(order.totalCents),
        refunded: money(order.refundedCents),
        items: order.items.map((i) => ({ name: i.name, quantity: i.quantity, unitPrice: money(i.unitPriceCents) })),
        shippingAddress: `${order.shipLine1}, ${order.shipCity} ${order.shipPostalCode}, ${order.shipCountry}`,
        customerNote: order.customerNote,
        orderedOn: day(order.createdAt),
        shippedOn: day(order.shippedAt),
        deliveredOn: day(order.deliveredAt),
      });
    },
  }),

  defineTool({
    name: "get_shipment",
    description: "Get shipping status for one order: carrier, tracking number, shipped and delivered dates.",
    input: OrderIdInput,
    run: async (ctx, { orderId }) => {
      const shipment = await getShipment(ctx.pool, orderId);
      if (!shipment) return fail(`Order ${orderId} not found`);
      return ok({
        orderId: shipment.orderId,
        status: shipment.status,
        carrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber,
        shippedOn: day(shipment.shippedAt),
        deliveredOn: day(shipment.deliveredAt),
      });
    },
  }),
];

/** Tool definitions in the shape the Anthropic API expects. */
export const toolDefinitions: Anthropic.Tool[] = TOOLS.map((tool) => {
  const { $schema: _, ...schema } = z.toJSONSchema(tool.input);
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as Anthropic.Tool.InputSchema,
  };
});

/**
 * Runs one tool call requested by the model. Never throws: unknown tools,
 * invalid input and runtime failures all come back as { ok: false }.
 */
export async function executeTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolOutcome> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(`Unknown tool: ${name}`);

  const parsed = tool.input.safeParse(input);
  if (!parsed.success) return fail(`Invalid input for ${name}: ${z.prettifyError(parsed.error)}`);

  try {
    // Each tool's run is typed against its own schema; the union erases that here.
    return await (tool.run as (ctx: ToolContext, input: unknown) => Promise<ToolOutcome>)(ctx, parsed.data);
  } catch (err) {
    console.error(`Tool ${name} failed:`, err);
    return fail(`Tool ${name} failed due to an internal error`);
  }
}

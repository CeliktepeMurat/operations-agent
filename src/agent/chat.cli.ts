import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { loadConfig } from "../config/env.js";
import { createPool } from "../db/pool.js";
import { runAgent, type AgentStep } from "./loop.js";
import type { Session } from "./session.js";

const { values } = parseArgs({ options: { customer: { type: "string" } } });
const customerId = Number(values.customer);
if (!Number.isInteger(customerId) || customerId <= 0) {
  console.error("Usage: npm run chat -- --customer <id>");
  process.exit(1);
}

const config = loadConfig();
const pool = createPool(config);

const { rows } = await pool.query<{ email: string }>("SELECT email FROM customers WHERE id = $1", [customerId]);
if (!rows[0]) {
  console.error(`Customer ${customerId} not found. Did you run npm run db:seed?`);
  await pool.end();
  process.exit(1);
}

// The CLI flag plays the role of login: identity is set here, never from chat text.
const session: Session = { customerId };
const client = new Anthropic();
const messages: Anthropic.MessageParam[] = [];

function printStep(step: AgentStep) {
  if (step.type === "tool_call") {
    const result = step.outcome.ok ? "ok" : `error: ${step.outcome.error}`;
    console.log(`  · round ${step.round}: ${step.name} ${JSON.stringify(step.input)} → ${result}`);
  }
}

console.log(`Logged in as customer #${customerId} (${rows[0].email}). Model: ${config.ANTHROPIC_MODEL}.`);
console.log('Type "exit" to quit.\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.setPrompt("You: ");
rl.prompt();

for await (const line of rl) {
  const question = line.trim();
  if (question === "exit") break;

  if (question) {
    const historyLength = messages.length;
    messages.push({ role: "user", content: question });
    try {
      const result = await runAgent(
        { client, model: config.ANTHROPIC_MODEL, onStep: printStep },
        { session, pool },
        messages,
      );
      const status = result.status === "answered" ? "" : `  [${result.status}]`;
      console.log(`Agent: ${result.reply}${status}\n`);
    } catch (err) {
      // Drop the half-finished turn so the next request isn't malformed.
      messages.length = historyLength;
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  rl.prompt();
}

rl.close();
await pool.end();

/**
 * Who the agent is talking to. Created by trusted code (login, CLI flag, eval
 * scenario) — never from chat text or model output.
 */
export type Session = {
  customerId: number;
};

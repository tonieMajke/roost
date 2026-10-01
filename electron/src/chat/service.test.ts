import { describe, expect, it } from "vitest";
import type { ChatEvent, ChatRequest, ProviderDef } from "../../../src/chat";
import { ChatService } from "./service";

const provider: ProviderDef = { id: "x", name: "x", kind: "openai", baseUrl: "http://x", models: [] } as unknown as ProviderDef;
const req = (tools: boolean): ChatRequest => ({
  provider,
  model: "m",
  system: "",
  messages: [],
  prompt: "",
  search: false,
  ...(tools ? { tools: [{ name: "list_panes", description: "", parameters: {} }] } : {}),
});

describe("ChatService", () => {
  it("z `req.tools` wywołania z adaptera idą do strony przed `done` (rozmowa głosowa)", async () => {
    const svc = new ChatService({ openai: async () => [{ id: "t1", name: "list_panes", args: {} }, { id: "t2", name: "read_pane", args: {}, bad: "{" }] }, {});
    const got: ChatEvent[] = [];
    await svc.send("r", req(true), (e) => got.push(e));
    expect(got).toEqual([
      { type: "tool_call", id: "t1", name: "list_panes", args: {} },
      { type: "tool_call", id: "t2", name: "read_pane", args: {}, bad: "{" },
      { type: "done" },
    ]);
    const plain: ChatEvent[] = [];
    await svc.send("r", req(false), (e) => plain.push(e));
    expect(plain).toEqual([{ type: "done" }]);
  });
});

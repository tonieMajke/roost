import { useState } from "react";
import { Terminal } from "./Terminal";

const AGENTS = [
  { id: "claude", name: "Claude", command: "claude" },
  { id: "pi", name: "pi", command: "pi" },
  { id: "shell", name: "Terminal", command: "$SHELL" },
];

/** M0: one terminal, pick the agent and folder, restart on demand. */
export function App() {
  const [agent, setAgent] = useState(AGENTS[0]);
  const [cwd, setCwd] = useState("~");
  const [run, setRun] = useState(0);

  return (
    <div className="app">
      <header className="bar">
        <select value={agent.id} onChange={(e) => setAgent(AGENTS.find((a) => a.id === e.target.value)!)}>
          {AGENTS.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input value={cwd} onChange={(e) => setCwd(e.target.value)} spellCheck={false} />
        <button onClick={() => setRun((n) => n + 1)}>Uruchom ponownie</button>
      </header>
      <Terminal key={`${agent.id}:${cwd}:${run}`} command={agent.command} cwd={cwd} />
    </div>
  );
}

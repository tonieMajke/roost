import { useEffect, useState } from "react";
import { Clock, LoaderCircle, Pencil, Play, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { backend } from "../backend";
import { t, useT } from "../i18n";
import {
  dayName,
  freeRoutineId,
  newRoutine,
  parseRoutines,
  routineNext,
  runWhen,
  scheduleLabel,
  toggleRoutine,
  firstSentence,
  type BotChat,
  type BotDef,
  type Routine,
  type RunInfo,
  type Schedule,
} from "../bot";
import { CONFIRM_MS } from "../confirm";

/** Ile ostatnich przebiegów czytać, żeby pokazać ostatni wynik każdego zadania. */
const RECENT_RUNS = 30;
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Last = { chat: string; at: number; state: BotChat["state"]; text: string };

/** Ostatni przebieg każdego zadania (z najnowszych plików w `runs/`). */
async function lastRuns(bot: string): Promise<Record<string, Last>> {
  const metas = (await backend.botChatList(bot, "runs")).slice(0, RECENT_RUNS);
  const chats = await Promise.all(metas.map((m) => backend.botChatLoad(bot, "runs", m.id).catch(() => null)));
  const out: Record<string, Last> = {};
  for (const c of chats) {
    if (!c?.routine || out[c.routine]) continue;
    const reply = [...c.messages].reverse().find((m) => m.role === "assistant");
    out[c.routine] = { chat: c.id, at: c.updated, state: c.state, text: reply?.error ? t("bot.rt.lastError", { error: reply.error }) : firstSentence(reply?.text ?? "") };
  }
  return out;
}

function Editor({ value, onSave, onCancel }: { value: Routine; onSave(r: Routine): Promise<void>; onCancel(): void }) {
  const { t } = useT();
  const [r, setR] = useState(value);
  const [bash, setBash] = useState(value.allow.bash.join(", "));
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Routine>) => setR((x) => ({ ...x, ...p }));
  const setSchedule = (s: Schedule) => set({ schedule: s });
  const s = r.schedule;
  const days = s.kind === "daily" ? (s.days ?? []) : [];
  const toggleDay = (d: number) => {
    if (s.kind !== "daily") return;
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    setSchedule(next.length === 0 || next.length === 7 ? { kind: "daily", at: s.at } : { kind: "daily", at: s.at, days: next.sort() });
  };
  const save = () => {
    const next: Routine = {
      ...r,
      name: r.name.trim(),
      allow: { ...r.allow, bash: bash.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) },
    };
    const check = parseRoutines({ routines: [next] });
    if (check.errors.length) return setError(check.errors.join("; ").replace(`${t("bot.err.routineWhere", { n: 1 })}: `, ""));
    setError(null);
    void onSave(check.routines[0]).catch((e: unknown) => setError(errText(e)));
  };
  return (
    <div className="routine-edit">
      <label className="card-field">
        <span>{t("bot.rt.name")}</span>
        <input value={r.name} placeholder={t("bot.rt.namePh")} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="card-field">
        <span>{t("bot.rt.prompt")}</span>
        <textarea rows={3} value={r.prompt} placeholder={t("bot.rt.promptPh")} onChange={(e) => set({ prompt: e.target.value })} />
      </label>
      <div className="card-field">
        <span>{t("bot.rt.when")}</span>
        <div className="seg routine-kind" role="radiogroup">
          <button type="button" role="radio" aria-checked={s.kind === "daily"} className={s.kind === "daily" ? "is-on" : ""} onClick={() => s.kind !== "daily" && setSchedule({ kind: "daily", at: "08:00" })}>
            {t("bot.rt.daily")}
          </button>
          <button type="button" role="radio" aria-checked={s.kind === "every"} className={s.kind === "every" ? "is-on" : ""} onClick={() => s.kind !== "every" && setSchedule({ kind: "every", minutes: 60 })}>
            {t("bot.rt.every")}
          </button>
        </div>
        {s.kind === "daily" ? (
          <div className="card-row">
            <input type="time" className="routine-time" value={s.at} onChange={(e) => e.target.value && setSchedule({ ...s, at: e.target.value })} />
            <div className="routine-days" role="group" aria-label={t("bot.rt.daysAria")}>
              {DAY_ORDER.map((d) => (
                <button key={d} type="button" aria-pressed={days.includes(d)} className={`routine-day${days.includes(d) ? " is-on" : ""}`} onClick={() => toggleDay(d)}>
                  {dayName(d)}
                </button>
              ))}
            </div>
            <small className="card-hint">{scheduleLabel(s)}</small>
          </div>
        ) : (
          <div className="card-row">
            <span className="card-hint">{t("bot.rt.everyPre")}</span>
            <input type="number" className="routine-minutes" min={5} step={5} value={s.minutes} onChange={(e) => setSchedule({ kind: "every", minutes: Number(e.target.value) })} />
            <span className="card-hint">{t("bot.rt.everyPost")}</span>
          </div>
        )}
      </div>
      <div className="card-field">
        <span>{t("bot.rt.noAsk")}</span>
        <label className="card-tool">
          <input type="checkbox" checked={r.allow.writeWork} onChange={(e) => set({ allow: { ...r.allow, writeWork: e.target.checked } })} />
          <span className="card-tool-text">
            <b>{t("bot.rt.writeWork")}</b>
            <small>{t("bot.rt.writeWorkHint")}</small>
          </span>
        </label>
        <input value={bash} placeholder={t("bot.rt.bashPh")} onChange={(e) => setBash(e.target.value)} />
        <small className="card-hint">{t("bot.rt.bashHint")}</small>
      </div>
      {error && <div className="prov-error">{error}</div>}
      <div className="card-row">
        <span className="chat-composer-gap" />
        <button type="button" className="btn" onClick={onCancel}>
          {t("bot.cancel")}
        </button>
        <button type="button" className="btn primary" onClick={save}>
          {t("bot.rt.saveTask")}
        </button>
      </div>
    </div>
  );
}

/** Zakładka „Harmonogram” karty bota: zadania cykliczne. Zapis od razu (osobny plik `routines.json`). */
export function Routines({ bot, onError, onOpenRun }: { bot: BotDef; onError(e: string): void; onOpenRun(chat: string): void }) {
  const { t } = useT();
  const [list, setList] = useState<Routine[] | null>(null);
  const [last, setLast] = useState<Record<string, Last>>({});
  const [active, setActive] = useState<RunInfo[]>([]);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const reload = () => {
    void backend.botRoutines(bot.id).then((r) => {
      setList(r.routines);
      if (r.errors.length) onError(r.errors.join("; "));
    }, (e: unknown) => onError(errText(e)));
    void lastRuns(bot.id).then(setLast, () => undefined);
  };
  useEffect(reload, [bot.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void backend.botRuns().then(setActive, () => undefined);
    return backend.onBotRun((r) => {
      if (r.bot !== bot.id) return;
      setActive((prev) => [...prev.filter((x) => x.chat !== r.chat), ...(r.state === "done" || r.state === "error" ? [] : [r])]);
      if (r.state === "done" || r.state === "error") reload();
    });
  }, [bot.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  const write = async (next: Routine[]) => {
    await backend.botRoutinesSave(bot.id, next);
    setList(next);
  };
  const saveOne = async (r: Routine) => {
    const cur = list ?? [];
    await write(cur.some((x) => x.id === r.id) ? cur.map((x) => (x.id === r.id ? r : x)) : [...cur, r]);
    setEditing(null);
  };
  const remove = (id: string) => {
    if (armed !== id) return setArmed(id);
    setArmed(null);
    void write((list ?? []).filter((x) => x.id !== id)).catch((e: unknown) => onError(errText(e)));
  };
  const toggle = (r: Routine, on: boolean) =>
    void write((list ?? []).map((x) => (x.id === r.id ? toggleRoutine(x, on, Date.now()) : x))).catch((e: unknown) => onError(errText(e)));
  const runNow = (r: Routine) =>
    void backend.botRunNow(bot.id, r.id).catch((e: unknown) => onError(errText(e)));

  if (list === null) return <p className="card-hint">{t("bot.loading")}</p>;
  if (editing) return <Editor key={editing.id} value={editing} onSave={saveOne} onCancel={() => setEditing(null)} />;

  return (
    <div className="card-fields">
      <p className="card-hint">
        {t("bot.rt.intro")}
      </p>
      {list.length === 0 && <p className="card-hint">{t("bot.rt.none")}</p>}
      <div className="card-list">
        {list.map((r) => {
          const run = active.find((a) => a.routine === r.id);
          const prev = last[r.id];
          return (
            <div key={r.id} className={`routine${r.enabled ? "" : " is-off"}`}>
              <label className="routine-switch" title={r.enabled ? t("bot.rt.turnOff") : t("bot.rt.turnOn")}>
                <input type="checkbox" role="switch" checked={r.enabled} onChange={(e) => toggle(r, e.target.checked)} aria-label={t("bot.rt.enabledAria", { name: r.name })} />
                <span aria-hidden />
              </label>
              <div className="routine-main">
                <div className="routine-title">
                  <b>{r.name}</b>
                  <span className="routine-when">
                    <Clock aria-hidden /> {scheduleLabel(r.schedule)}
                  </span>
                </div>
                <div className="routine-meta">
                  {run ? (
                    <button type="button" className={`routine-last is-${run.state}`} onClick={() => onOpenRun(run.chat)}>
                      {run.state === "waiting_approval" ? <ShieldAlert aria-hidden /> : <LoaderCircle className="spin" aria-hidden />}
                      {run.state === "waiting_approval" ? t("bot.rt.waitingApproval") : t("bot.rt.working")}
                    </button>
                  ) : (
                    <span>{r.enabled ? t("bot.rt.next", { when: runWhen(routineNext(r, now), now) }) : t("bot.rt.disabled")}</span>
                  )}
                  {!run && prev && (
                    <button type="button" className={`routine-last is-${prev.state ?? "done"}`} onClick={() => onOpenRun(prev.chat)} title={t("bot.rt.openRun")}>
                      {t("bot.rt.last", { when: runWhen(prev.at, now) })}
                      {prev.text ? ` · ${prev.text}` : ""}
                    </button>
                  )}
                </div>
              </div>
              <div className="routine-actions">
                <button type="button" className="btn" disabled={run !== undefined} onClick={() => runNow(r)} title={t("bot.rt.runNowTitle")}>
                  <Play aria-hidden /> {t("bot.rt.runNow")}
                </button>
                <button type="button" className="btn card-del" onClick={() => setEditing(r)} title={t("bot.rt.edit")}>
                  <Pencil aria-hidden />
                </button>
                <button type="button" className={`btn card-del${armed === r.id ? " is-confirm" : ""}`} onClick={() => remove(r.id)} title={t("bot.rt.delete")}>
                  {armed === r.id ? t("bot.sure") : <Trash2 aria-hidden />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="card-row">
        <button type="button" className="btn" onClick={() => setEditing(newRoutine(freeRoutineId(list), Date.now()))}>
          <Plus aria-hidden /> {t("bot.rt.new")}
        </button>
      </div>
    </div>
  );
}

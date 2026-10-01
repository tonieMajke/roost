import type { Blip } from "./radar";
import { useT } from "./i18n";

/** Radar motywu „Wieża” (makieta K): tarcza z pierścieniami 1/5/15 min i wiązką, znaki = panele. */
export function Radar({ blips, onPick }: { blips: Blip[]; onPick: (id: string) => void }) {
  const { t } = useT();
  return (
    <svg className="radar" viewBox="0 0 560 560" role="img" aria-label={t("ui2.radar.aria")}>
      <circle cx="280" cy="280" r="270" className="r-disc" />
      {[70, 140, 210].map((r) => (
        <circle key={r} cx="280" cy="280" r={r} className="r-ring" />
      ))}
      <line x1="10" y1="280" x2="550" y2="280" className="r-axis" />
      <line x1="280" y1="10" x2="280" y2="550" className="r-axis" />
      {[
        [206, "1 min"],
        [136, "5 min"],
        [66, "15 min"],
        [22, t("ui2.radar.silence")],
      ].map(([y, txt]) => (
        <text key={txt} x="288" y={y as number} className="r-lbl">
          {txt}
        </text>
      ))}
      <g className="r-sweep">
        <path d="M280 280 L280 12 A268 268 0 0 1 470 90 Z" className="r-wedge" />
        <line x1="280" y1="280" x2="280" y2="12" className="r-beam" />
      </g>
      {blips.map((b) => {
        const left = b.x > 280;
        const tx = b.x + (left ? 14 : -14);
        return (
          <g key={b.id} className={`r-blip is-${b.mode}`} style={{ color: b.color }} tabIndex={0} role="button" aria-label={b.call} onClick={() => onPick(b.id)}>
            <rect x={b.x - 6} y={b.y - 6} width="12" height="12" />
            <text x={tx} y={b.y - 2} textAnchor={left ? "start" : "end"} className="r-call">
              {b.call}
              {b.level !== null ? ` ${String(b.level).padStart(3, "0")}` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

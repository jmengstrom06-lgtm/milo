// Planner: a day-by-day study plan built from what's due. Check things off, practice any block in one
// click, and send the whole plan to your Calendar (with reminders).

import { useEffect, useState } from "react";
import type { Plan } from "./types";

const KEY = "milo.planDone";

export default function PlannerView({ plan, onPractice, onRebuild, say }: { plan: Plan; onPractice: (topic: string) => void; onRebuild: () => void; say: (t: string) => Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10);
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}");
    } catch {
      return {};
    }
  });
  const [toast, setToast] = useState("");
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(done));
    } catch {
      /* ignore */
    }
  }, [done]);

  const keyOf = (date: string, text: string) => `${date}|${text}`;
  const tasks = plan.days.flatMap((d) => d.tasks.filter((t) => t.kind === "study" || t.kind === "review").map((t) => keyOf(d.date, t.text)));
  const doneCount = tasks.filter((k) => done[k]).length;
  const exam = plan.days.find((d) => d.tasks.some((t) => t.kind === "exam"));
  const daysLeft = exam ? Math.round((new Date(exam.date + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 86400000) : null;

  return (
    <div className="pl">
      {exam && daysLeft !== null && daysLeft >= 0 && (
        <div className="pl-count">
          <b>{daysLeft}</b>
          <span>{daysLeft === 1 ? "day" : "days"} until {exam.tasks.find((t) => t.kind === "exam")?.text}</span>
          {tasks.length > 0 && (
            <span className="pl-progress">
              <i style={{ width: `${(doneCount / tasks.length) * 100}%` }} />
              <em>
                {doneCount}/{tasks.length} done
              </em>
            </span>
          )}
        </div>
      )}
      <div className="pl-days">
        {plan.days.map((d, k) => (
          <div key={d.date} className={`pl-day ${d.date === today ? "pl-day--today" : ""} ${d.date < today ? "pl-day--past" : ""}`} style={{ animationDelay: `${k * 50}ms` }}>
            <div className="pl-date">{d.date === today ? "Today" : d.label}</div>
            <div className="pl-tasks">
              {d.tasks.map((t, j) => {
                const key = keyOf(d.date, t.text);
                const checkable = t.kind === "study" || t.kind === "review";
                return (
                  <div key={j} className={`pl-task pl-task--${t.kind} ${done[key] ? "pl-task--done" : ""}`}>
                    {checkable ? (
                      <button
                        className="pl-check"
                        onClick={() => {
                          const now = !done[key];
                          setDone((x) => ({ ...x, [key]: now }));
                          if (now && doneCount + 1 === tasks.length) say("That's the whole plan. You're ready.");
                        }}
                        aria-label="Done"
                      >
                        {done[key] && (
                          <svg viewBox="0 0 16 16" width="11" height="11">
                            <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>
                    ) : (
                      <span className="pl-dot" />
                    )}
                    <span className="pl-text">
                      {t.text}
                      {t.minutes ? <em> · {t.minutes} min</em> : null}
                    </span>
                    {checkable && !done[key] && (
                      <button className="kit-btn kit-btn--sm" onClick={() => onPractice(t.topic || t.text)}>
                        Practice
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="sd-actions">
        <button
          className="kit-btn kit-btn--primary"
          onClick={async () => {
            const ok = await window.milo.kit.planToCalendar(plan);
            setToast(ok ? "Opening Calendar…" : "Couldn't open Calendar");
            setTimeout(() => setToast(""), 1800);
            if (ok) say("Sending it to your Calendar. Pick a calendar and you're set.");
          }}
        >
          Add to Calendar
        </button>
        <button className="kit-btn" onClick={onRebuild}>Rebuild plan</button>
      </div>
      {toast && <div className="kit-toast">{toast}</div>}
    </div>
  );
}

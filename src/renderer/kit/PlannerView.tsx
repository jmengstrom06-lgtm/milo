// Planner: a day-by-day study plan built from what's due. Every study block opens practice in one click.

import type { Plan } from "./types";

export default function PlannerView({ plan, onPractice, onRebuild }: { plan: Plan; onPractice: (topic: string) => void; onRebuild: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const exam = plan.days.find((d) => d.tasks.some((t) => t.kind === "exam"));
  const daysLeft = exam ? Math.round((new Date(exam.date + "T12:00:00").getTime() - new Date(today + "T12:00:00").getTime()) / 86400000) : null;
  return (
    <div className="pl">
      {exam && daysLeft !== null && daysLeft >= 0 && (
        <div className="pl-count">
          <b>{daysLeft}</b>
          <span>{daysLeft === 1 ? "day" : "days"} until {exam.tasks.find((t) => t.kind === "exam")?.text}</span>
        </div>
      )}
      <div className="pl-days">
        {plan.days.map((d, k) => (
          <div key={d.date} className={`pl-day ${d.date === today ? "pl-day--today" : ""}`} style={{ animationDelay: `${k * 50}ms` }}>
            <div className="pl-date">{d.date === today ? "Today" : d.label}</div>
            <div className="pl-tasks">
              {d.tasks.map((t, j) => (
                <div key={j} className={`pl-task pl-task--${t.kind}`}>
                  <span className="pl-dot" />
                  <span className="pl-text">
                    {t.text}
                    {t.minutes ? <em> · {t.minutes} min</em> : null}
                  </span>
                  {(t.kind === "study" || t.kind === "review") && (
                    <button className="kit-btn kit-btn--sm" onClick={() => onPractice(t.topic || t.text)}>
                      Practice
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="sd-actions">
        <button className="kit-btn" onClick={onRebuild}>Rebuild plan</button>
      </div>
    </div>
  );
}

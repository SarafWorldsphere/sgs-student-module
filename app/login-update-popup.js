"use client";

import { useEffect, useState } from "react";
import { getApiBaseUrl } from "./api-base-url";
import { getLoggedInUserEmail } from "./login-session";

const API_BASE_URL = getApiBaseUrl();

function formatNoticeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function LoginUpdatePopup({ enabled = true }) {
  const [visible, setVisible] = useState(true);
  const [updates, setUpdates] = useState([]);
  const [studentIdentity, setStudentIdentity] = useState("");

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    async function loadNotifications() {
      try {
        const email = await getLoggedInUserEmail();
        if (!email) throw new Error("Logged-in student identity is unavailable.");
        if (!cancelled) setStudentIdentity(email);

        const params = new URLSearchParams({ email });
        const response = await fetch(`${API_BASE_URL}/notifications?${params.toString()}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("Unable to load notifications.");

        if (!cancelled) {
          setUpdates((Array.isArray(data.notifications) ? data.notifications : []).filter((item) => !item.is_read).map((item) => {
            const isAssignment = item.type === "assignment";
            const isResult = item.type === "result";
            return {
              id: item.id,
              type: isAssignment ? "homework" : isResult ? "result" : "notice",
              label: isAssignment ? "Assignment" : isResult ? "Result" : "Notice",
              title: [item.title, item.message || item.body].filter(Boolean).join(" — ") || (isAssignment ? "New assignment" : isResult ? "New result" : "New notice"),
              meta: isAssignment
                ? [item.status, formatNoticeDate(item.due_date)].filter(Boolean).join(" · ")
                : formatNoticeDate(isResult ? item.assessment_date : item.notice_date)
            };
          }));
        }
      } catch {
        if (!cancelled) setUpdates([]);
      }
    }

    loadNotifications();
    return () => { cancelled = true; };
  }, [enabled]);

  if (!enabled || !visible || updates.length === 0) return null;

  const tickerCharacterCount = updates.reduce(
    (total, update) => total + update.label.length + update.title.length + update.meta.length,
    0
  );
  const tickerDuration = Math.max(75, Math.round(tickerCharacterCount * 0.24));

  async function dismissUpdates() {
    const notificationIds = updates.map((update) => update.id);
    setVisible(false);
    if (!studentIdentity || notificationIds.length === 0) return;
    try {
      await fetch(`${API_BASE_URL}/notifications/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: studentIdentity, notification_ids: notificationIds })
      });
    } catch {
      // The popup remains dismissible even if read-state persistence temporarily fails.
    }
  }

  return (
    <section className="login-updates-ticker" aria-label="Latest student updates">
      <div className="login-updates-ticker-label">
        <span className="login-updates-live-dot" aria-hidden="true" />
        <strong>Latest Updates</strong>
      </div>

      <div className="login-updates-ticker-window">
        <div className="login-updates-ticker-track" style={{ "--login-update-duration": `${tickerDuration}s` }}>
          {[...updates, ...updates].map((update, index) => (
            <article className={`login-update-ticker-item ${update.type}`} key={`${update.id}-${index}`}>
              <span className="login-update-ticker-type">{update.label}</span>
              <span className="login-update-ticker-title">{update.title}</span>
              <time>{update.meta}</time>
            </article>
          ))}
        </div>
      </div>

      <button className="login-updates-ticker-close" type="button" aria-label="Hide latest updates" onClick={dismissUpdates}>&times;</button>
    </section>
  );
}

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

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    async function loadNotifications() {
      try {
        const email = await getLoggedInUserEmail();
        if (!email) throw new Error("Logged-in student identity is unavailable.");

        const params = new URLSearchParams({ email });
        const response = await fetch(`${API_BASE_URL}/notifications?${params.toString()}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("Unable to load notifications.");

        if (!cancelled) {
          setUpdates((Array.isArray(data.notifications) ? data.notifications : []).map((item) => {
            const isAssignment = item.type === "assignment";
            return {
              id: item.id,
              type: isAssignment ? "homework" : "notice",
              label: isAssignment ? "Assignment" : "Notice",
              title: [item.title, item.message || item.body].filter(Boolean).join(" — ") || (isAssignment ? "New assignment" : "New notice"),
              meta: isAssignment
                ? [item.status, formatNoticeDate(item.due_date)].filter(Boolean).join(" · ")
                : formatNoticeDate(item.notice_date)
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

  return (
    <section className="login-updates-ticker" aria-label="Latest student updates">
      <div className="login-updates-ticker-label">
        <span className="login-updates-live-dot" aria-hidden="true" />
        <strong>Latest Updates</strong>
      </div>

      <div className="login-updates-ticker-window">
        <div className="login-updates-ticker-track">
          {[...updates, ...updates].map((update, index) => (
            <article className={`login-update-ticker-item ${update.type}`} key={`${update.id}-${index}`}>
              <span className="login-update-ticker-type">{update.label}</span>
              <span className="login-update-ticker-title">{update.title}</span>
              <time>{update.meta}</time>
            </article>
          ))}
        </div>
      </div>

      <button className="login-updates-ticker-close" type="button" aria-label="Hide latest updates" onClick={() => setVisible(false)}>&times;</button>
    </section>
  );
}

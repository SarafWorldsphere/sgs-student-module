"use client";

import { useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "./api-base-url";
import { getLoggedInUserEmail } from "./login-session";

const API_BASE_URL = getApiBaseUrl();

function formatNoticeDate(dateValue) {
  if (!dateValue) {
    return "-";
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getPriorityLabelClass(priority) {
  if (priority === "high") {
    return "high";
  }
  if (priority === "medium") {
    return "medium";
  }
  return "low";
}

export default function NotificationBell() {
  const menuRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [assignmentAlertError, setAssignmentAlertError] = useState("");
  const storageKeyRef = useRef("");
  const studentIdentityRef = useRef("");

  useEffect(() => {
    let cancelled = false;

    async function loadNotifications() {
      setError("");

      try {
        const email = await getLoggedInUserEmail();
        if (!email) throw new Error("Logged-in student email is unavailable.");
        studentIdentityRef.current = email;
        storageKeyRef.current = `sgs-read-notifications:${email.toLowerCase()}`;
        const storedIds = JSON.parse(window.localStorage.getItem(storageKeyRef.current) || "[]");
        const readIds = new Set(Array.isArray(storedIds) ? storedIds : []);
        const response = await fetch(`${API_BASE_URL}/notifications?${new URLSearchParams({ email }).toString()}`);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(typeof data.detail === "string" ? data.detail : "Unable to load notifications.");
        }

        if (!cancelled) {
          const nextNotifications = (Array.isArray(data.notifications) ? data.notifications : []).map((item) => ({
            ...item,
            unread: !item.is_read && !readIds.has(item.id)
          }));
          setNotifications(nextNotifications);
          setCount(nextNotifications.filter((item) => item.unread).length);
          setAssignmentAlertError(typeof data.assignment_alert_error === "string" ? data.assignment_alert_error : "");
        }
      } catch (loadError) {
        if (!cancelled) {
          setNotifications([]);
          setCount(0);
          setAssignmentAlertError("");
          setError(loadError.message || "Unable to load notifications.");
        }
      }
    }

    loadNotifications();

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleNotifications() {
    setOpen((current) => {
      const nextOpen = !current;
      if (nextOpen && storageKeyRef.current) {
        const readIds = notifications.map((item) => item.id);
        window.localStorage.setItem(storageKeyRef.current, JSON.stringify(readIds));
        setNotifications((items) => items.map((item) => ({ ...item, unread: false })));
        setCount(0);
        if (studentIdentityRef.current && readIds.length > 0) {
          fetch(`${API_BASE_URL}/notifications/read`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: studentIdentityRef.current, notification_ids: readIds })
          }).catch(() => {});
        }
      }
      return nextOpen;
    });
  }

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleOutsideClick(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleOutsideClick);

    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
    };
  }, [open]);

  return (
    <div className="notification-menu" ref={menuRef}>
      <button className="bell-button" aria-label={`${count} unread notifications`} title="Notifications" type="button" onClick={toggleNotifications}>
        <span className="bell-icon" aria-hidden="true" />
        {count > 0 && <span className="badge">{count}</span>}
      </button>

      {open && (
        <div className="notice-dropdown" role="dialog" aria-label="Notifications">
          <div className="notice-dropdown-head">
            <strong>Notifications</strong>
            <span>{count}</span>
          </div>

          {error && <p className="notice-message">{error}</p>}
          {!error && assignmentAlertError && <p className="notice-message">Assignment AI alert unavailable: {assignmentAlertError}</p>}
          {!error && notifications.length === 0 && <p className="notice-message">No notifications found.</p>}

          {!error && notifications.map((item) => {
            const isAssignment = item.type === "assignment";
            const isResult = item.type === "result";
            const itemDate = isAssignment ? item.due_date : isResult ? item.assessment_date : item.notice_date;
            const meta = isAssignment
              ? [item.subject_name, item.chapter_name].filter(Boolean).join(" - ") || "Assignment"
              : isResult
                ? [item.subject, item.assessment_type].filter(Boolean).join(" - ") || "Result"
                : item.applicable_class || "All";

            return (
              <article className={`notice-item ${item.unread ? "unread" : ""} ${isAssignment ? "assignment-alert" : ""}`} key={item.id}>
                <div>
                  <strong>{item.title || (isAssignment ? "Assignment" : isResult ? "Result" : "Notice")}</strong>
                  <time>{formatNoticeDate(itemDate)}</time>
                </div>
                <p>{item.message || item.body || "-"}</p>
                <footer>
                  <span>{meta}</span>
                  {isAssignment && <span className={`alert-status ${getPriorityLabelClass(item.priority)}`}>{item.status}</span>}
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

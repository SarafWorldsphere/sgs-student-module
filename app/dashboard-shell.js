"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AppSelect from "./app-select";
import { getApiBaseUrl } from "./api-base-url";
import { withBasePath, withoutBasePath } from "./base-path";
import LanguagePageTranslator from "./language-page-translator";
import NotificationBell from "./notification-bell";
import VoiceTextTools from "./voice-text-tools";
import { useLanguage } from "./i18n";
import { getLoggedInUserEmail } from "./login-session";
import LoginUpdatePopup from "./login-update-popup";

const navItems = [
  ["home", "Dashboard", "/"],
  ["book-open", "Core Study", "/chapters"],
  ["clipboard", "Assignments", "/assignments"],
  ["target", "Assessments", "/assessments"],
  ["chart", "My Progress", "/progress"],
  ["document", "AI Translator", "/ai-translator"]
];

const settingsItems = [
  ["help", "Help & Support", "/help"]
];

const configuredLoginServiceUrl = (process.env.NEXT_PUBLIC_LOGIN_URL || "").trim().replace(/\/+$/, "");
const DashboardShellContext = createContext(false);
const API_BASE_URL = getApiBaseUrl();

function getLoginServiceUrl() {
  if (configuredLoginServiceUrl) {
    return configuredLoginServiceUrl;
  }

  return typeof window !== "undefined" ? window.location.origin : "";
}

async function handleLogout() {
  window.localStorage.clear();
  window.sessionStorage.clear();
  const loginServiceUrl = getLoginServiceUrl();

  try {
    const csrfResponse = await fetch(`${loginServiceUrl}/api/auth/csrf`, {
      credentials: "include"
    });
    const { csrfToken } = await csrfResponse.json();
    const signOutResponse = await fetch(`${loginServiceUrl}/api/auth/signout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        callbackUrl: loginServiceUrl,
        csrfToken,
        json: "true"
      }),
      credentials: "include"
    });
    if (!signOutResponse.ok) {
      throw new Error("Unable to complete server sign-out.");
    }

    const contentType = signOutResponse.headers.get("content-type") || "";
    const signOutData = contentType.includes("application/json")
      ? await signOutResponse.json()
      : null;
    window.location.assign(signOutData?.url || loginServiceUrl);
  } catch {
    // Never open NextAuth's GET /signout page because this component already
    // provides the user-facing confirmation dialog.
    window.location.assign(loginServiceUrl);
  }
}

function Icon({ name, className = "" }) {
  return <span className={`icon ${name} ${className}`} aria-hidden="true" />;
}

function BrandMark() {
  return <img className="brand-logo" src={withBasePath("/sgslogo.jpeg")} alt="SGS Senior Secondary School logo" />;
}

function Avatar() {
  return (
    <div className="avatar" aria-hidden="true">
      <svg viewBox="0 0 120 120" role="img">
        <circle cx="60" cy="60" r="58" fill="#f4f5f7" />
        <circle cx="60" cy="42" r="29" fill="#3b291f" />
        <path d="M24 113c7-25 24-39 36-39s29 14 36 39" fill="#fff" stroke="#07192c" strokeWidth="3" />
        <path d="M52 79h16l-3 35H55z" fill="#1a62a3" />
        <path d="M38 40c1-19 11-28 23-28 13 0 22 10 22 28v11c0 18-11 32-22 32-12 0-23-14-23-32z" fill="#ffd2a3" stroke="#07192c" strokeWidth="3" />
        <circle cx="49" cy="50" r="3.2" fill="#07192c" />
        <circle cx="72" cy="50" r="3.2" fill="#07192c" />
        <path d="M53 64c5 5 12 5 17 0" fill="none" stroke="#07192c" strokeWidth="3" strokeLinecap="round" />
        <path d="M33 49c3-18 12-27 28-28 15 1 25 12 27 29-11-1-22-7-29-17-5 10-15 15-26 16z" fill="#2d2018" />
        <path d="M45 82l15 11 15-11" fill="none" stroke="#07192c" strokeWidth="3" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function useCurrentStudent() {
  const [student, setStudent] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStudent() {
      try {
        const email = await getLoggedInUserEmail();

        if (!email) {
          throw new Error("Logged-in student identity is unavailable.");
        }

        const params = new URLSearchParams({ email });
        const response = await fetch(`${API_BASE_URL}/students/current?${params.toString()}`, {
          credentials: "include"
        });
        const data = await response.json().catch(() => ({}));

        if (!cancelled && response.ok) {
          setStudent(data.student || null);
        }
      } catch {
        if (!cancelled) {
          setStudent(null);
        }
      }
    }

    loadStudent();

    return () => {
      cancelled = true;
    };
  }, []);

  return student;
}

export default function DashboardShell({ children }) {
  const isNestedShell = useContext(DashboardShellContext);

  if (isNestedShell) {
    return children;
  }

  return (
    <DashboardShellContext.Provider value>
      <DashboardShellFrame>{children}</DashboardShellFrame>
    </DashboardShellContext.Provider>
  );
}

function DashboardShellFrame({ children }) {
  const pathname = usePathname();
  const currentPath = withoutBasePath(pathname);
  const { language, languageOptions, setLanguage } = useLanguage();
  const student = useCurrentStudent();
  const [showLogoutConfirmation, setShowLogoutConfirmation] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const studentName = student?.full_name || "Student";
  const admissionNo = student?.admission_no || "-";
  const rollNo = student?.roll_no || "-";
  const className = student?.class_name || (student?.class_id ? `Class ${student.class_id}` : "-");
  const section = student?.section || "-";

  function isActive(href) {
    if (href === "/") {
      return currentPath === "/";
    }

    return currentPath === href || currentPath.startsWith(`${href}/`);
  }

  useEffect(() => {
    if (!showLogoutConfirmation) return undefined;

    function closeOnEscape(event) {
      if (event.key === "Escape" && !isLoggingOut) {
        setShowLogoutConfirmation(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showLogoutConfirmation, isLoggingOut]);

  async function confirmLogout() {
    setIsLoggingOut(true);
    await handleLogout();
  }

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobileMenuOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setIsMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMobileMenuOpen]);

  return (
    <main className="app-shell">
      <button
        className={`mobile-menu-button ${isMobileMenuOpen ? "open" : ""}`}
        type="button"
        aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={isMobileMenuOpen}
        aria-controls="student-sidebar"
        onClick={() => setIsMobileMenuOpen((isOpen) => !isOpen)}
      >
        <span />
        <span />
        <span />
      </button>

      <aside id="student-sidebar" className={`sidebar ${isMobileMenuOpen ? "mobile-open" : ""}`}>
        <div className="brand">
          <BrandMark />
        </div>

        <nav className="nav-list" aria-label="Student navigation">
          {navItems.map(([icon, label, href]) => (
            <Link className={`nav-item ${isActive(href) ? "active" : ""}`} href={href} key={label} onClick={() => setIsMobileMenuOpen(false)}>
              <Icon name={icon} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="nav-divider" />

        <nav className="nav-list compact" aria-label="Settings navigation">
          {settingsItems.map(([icon, label, href]) => (
            <Link className={`nav-item ${isActive(href) ? "active" : ""}`} href={href} key={label} onClick={() => setIsMobileMenuOpen(false)}>
              <Icon name={icon} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="nav-divider" />

        <button className="nav-item logout-link" type="button" onClick={() => { setIsMobileMenuOpen(false); setShowLogoutConfirmation(true); }}>
          <Icon name="sign-out" />
          <span>Logout</span>
        </button>
      </aside>

      {isMobileMenuOpen && (
        <button
          className="mobile-menu-overlay"
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <section className="workspace">
        <header className="topbar">
          <div className="student-card">
            <Avatar />
            <div className="student-info">
              <p>Welcome back,</p>
              <h1>{studentName}</h1>
              <div className="chips">
                <span>Roll No.: {rollNo}</span>
                <span>Admission No.: {admissionNo}</span>
                <span>Class: {className}</span>
                <span>Section: {section}</span>
              </div>
            </div>
          </div>

          <div className="top-actions">
            <label className="language-select">
              <span>Language</span>
              <AppSelect
                value={language}
                options={languageOptions.map((option) => ({ value: option.code, label: option.label }))}
                onChange={setLanguage}
                ariaLabel="Select language"
                variant="dark"
                className="language-app-select"
              />
            </label>
            <VoiceTextTools />
            <NotificationBell />
          </div>
        </header>

        <LoginUpdatePopup enabled={currentPath === "/"} />

        <LanguagePageTranslator />
        {children}
      </section>

      {showLogoutConfirmation && (
        <div className="logout-modal-backdrop" role="presentation" onMouseDown={() => !isLoggingOut && setShowLogoutConfirmation(false)}>
          <section
            className="logout-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="logout-modal-icon"><Icon name="power" /></div>
            <h2 id="logout-modal-title">Ready to log out?</h2>
            <p>You&apos;ll need to sign in again to access your student dashboard.</p>
            <div className="logout-modal-actions">
              <button className="logout-cancel-button" type="button" onClick={() => setShowLogoutConfirmation(false)} disabled={isLoggingOut}>Stay logged in</button>
              <button className="logout-confirm-button" type="button" onClick={confirmLogout} disabled={isLoggingOut}>
                {isLoggingOut ? "Logging out..." : "Yes, log out"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import { getApiBaseUrl } from "../api-base-url";
import AppSelect from "../app-select";
import DashboardShell from "../dashboard-shell";
import { getLoggedInUserEmail } from "../login-session";

const API_BASE_URL = getApiBaseUrl();

function percentage(value) {
  return value == null ? "-" : `${Math.round(Number(value))}%`;
}

function score(value) {
  return value == null ? "-" : Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function ProgressPage() {
  const [identity, setIdentity] = useState("");
  const [report, setReport] = useState(null);
  const [academicYear, setAcademicYear] = useState("");
  const [period, setPeriod] = useState("overall");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getLoggedInUserEmail().then((value) => {
      if (cancelled) return;
      if (!value) {
        setError("Logged-in student identity is unavailable.");
        setLoading(false);
        return;
      }
      setIdentity(value);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!identity) return undefined;
    let cancelled = false;
    async function loadProgress() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ email: identity });
        if (academicYear) params.set("academic_year", academicYear);
        if (period !== "overall") params.set("month", period);
        const response = await fetch(`${API_BASE_URL}/student-progress?${params}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Unable to load progress report.");
        if (cancelled) return;
        setReport(data);
        if (!academicYear && data.filters?.selected_academic_year) setAcademicYear(data.filters.selected_academic_year);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Unable to load progress report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadProgress();
    return () => { cancelled = true; };
  }, [identity, academicYear, period]);

  const filters = report?.filters || {};
  const summary = report?.summary || {};
  const subjects = report?.subjects || [];
  const yearOptions = (filters.academic_years || []).map((value) => ({ value, label: value }));
  const periodOptions = [{ value: "overall", label: "Overall Academic Progress" }, ...(filters.months || [])];

  function changeYear(value) {
    setAcademicYear(value);
    setPeriod("overall");
  }

  return (
    <DashboardShell>
      <section className="module-page progress-report-page">
        <div className="module-content-area">
          {loading && !report && <div className="analysis-state" role="status">Loading progress report...</div>}
          {!loading && error && <div className="analysis-state error" role="alert">{error}</div>}
          {report && !error && (
            <>
              <header className="progress-report-header">
                <div><span className="progress-report-kicker">Student Progress</span><h1>{report.student.full_name}&apos;s Progress Report</h1><p>Monthly CT performance and overall academic progress.</p></div>
                <div className="progress-overall-score"><strong>{percentage(summary.overall_average)}</strong><span>Overall Average</span></div>
              </header>

              <div className="progress-filter-bar">
                <label><span>Academic Year</span><AppSelect value={academicYear} options={yearOptions} onChange={changeYear} variant="dark" disabled={!yearOptions.length || loading} /></label>
                <label><span>View Progress</span><AppSelect value={period} options={periodOptions} onChange={setPeriod} variant="dark" disabled={loading} /></label>
                {loading && <span className="progress-filter-loading">Updating...</span>}
              </div>

              <div className="progress-summary-grid">
                <article className="progress-summary-card"><span>Subjects</span><strong>{summary.subject_count || 0}</strong><small>Subjects with marks records</small></article>
                <article className="progress-summary-card"><span>CT Scores Recorded</span><strong>{summary.completed_ct_count || 0}</strong><small>PT 1–4 and weekly tests</small></article>
                <article className="progress-summary-card positive"><span>Strongest Subject</span><strong>{summary.strongest_subject || "-"}</strong><small>Highest current average</small></article>
                <article className="progress-summary-card attention"><span>Needs Attention</span><strong>{summary.improvement_subject || "-"}</strong><small>Lowest current average</small></article>
              </div>

              {subjects.length === 0 ? <div className="analysis-state">No marks are available for the selected period.</div> : (
                <div className="progress-report-grid">
                  <article className="module-card progress-history-card">
                    <div className="progress-card-heading"><div><h2>Continuous Test Progress</h2><p>Scores entered in PT 1–4 and Weekly Test</p></div></div>
                    {summary.completed_ct_count === 0 && <div className="progress-info-note">CT marks have not been entered yet. Exam marks are used for overall progress until CT scores are available.</div>}
                    <div className="progress-history-table-wrap">
                      <table className="data-table progress-ct-table">
                        <thead><tr><th>Subject</th><th>PT 1</th><th>PT 2</th><th>PT 3</th><th>PT 4</th><th>Weekly Test</th><th>Average</th></tr></thead>
                        <tbody>{subjects.map((subject) => <tr key={subject.subject_id || subject.subject_name}>
                          <td><strong>{subject.subject_name}</strong></td>
                          {subject.tests.map((test) => <td key={test.key}><span>{score(test.marks)}</span>{test.percentage != null && <small>{percentage(test.percentage)}</small>}</td>)}
                          <td><span className="status-pill completed">{percentage(subject.ct_average ?? subject.exam_average)}</span></td>
                        </tr>)}</tbody>
                      </table>
                    </div>
                  </article>

                  <article className="module-card progress-subject-card">
                    <h2>Subject-wise Progress</h2>
                    <div className="progress-subject-list">{subjects.map((subject) => <div className="progress-subject-row" key={subject.subject_id || subject.subject_name}>
                      <div><strong>{subject.subject_name}</strong><span>{percentage(subject.overall_percentage)}</span></div>
                      <div className="progress-track"><i style={{ width: `${Math.min(100, Number(subject.overall_percentage) || 0)}%` }} /></div>
                    </div>)}</div>
                  </article>

                  <article className="module-card progress-latest-card">
                    <h2>Monthly Progress</h2>
                    {(report.monthly_progress || []).length ? <div className="progress-month-list">{report.monthly_progress.map((item) => <div key={item.month}><span>{item.label}</span><strong>{percentage(item.average_percentage)}</strong></div>)}</div> : <p>No monthly marks are available.</p>}
                  </article>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </DashboardShell>
  );
}

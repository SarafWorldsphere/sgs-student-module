"use client";

import { useEffect, useMemo, useState } from "react";
import { getApiBaseUrl } from "../api-base-url";
import DashboardShell from "../dashboard-shell";
import { getLoggedInUserEmail } from "../login-session";

const API_BASE_URL = getApiBaseUrl();

function roundedPercentage(value) {
  return `${Math.round(Number(value) || 0)}%`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export default function ProgressPage() {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadProgress() {
      try {
        const email = await getLoggedInUserEmail();
        if (!email) throw new Error("Logged-in student email is unavailable.");
        const response = await fetch(`${API_BASE_URL}/student-analysis?${new URLSearchParams({ email }).toString()}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Unable to load progress report.");
        if (!cancelled) setAnalysis(data);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Unable to load progress report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadProgress();
    return () => { cancelled = true; };
  }, []);

  const subjects = analysis?.subject_performance || [];
  const tests = analysis?.detailed_tests || [];
  const timeline = analysis?.timeline || [];
  const sortedSubjects = useMemo(
    () => [...subjects].sort((first, second) => Number(second.average_percentage) - Number(first.average_percentage)),
    [subjects]
  );
  const strongestSubject = sortedSubjects[0] || null;
  const improvementSubject = sortedSubjects[sortedSubjects.length - 1] || null;
  const latestTest = tests[tests.length - 1] || null;
  const firstAverage = Number(timeline[0]?.average_percentage || 0);
  const latestAverage = Number(timeline[timeline.length - 1]?.average_percentage || 0);
  const progressChange = timeline.length > 1 ? Math.round(latestAverage - firstAverage) : 0;

  return (
    <DashboardShell>
      <section className="module-page progress-report-page">
        <div className="module-content-area">
          {loading && <div className="analysis-state" role="status">Loading progress report...</div>}
          {!loading && error && <div className="analysis-state error" role="alert">{error}</div>}
          {!loading && !error && analysis && (
            <>
              <header className="progress-report-header">
                <div>
                  <span className="progress-report-kicker">Academic Year {analysis.academic_year}</span>
                  <h1>{analysis.student.full_name}&apos;s Progress Report</h1>
                  <p>Assessment-based academic performance and improvement summary.</p>
                </div>
                <div className="progress-overall-score"><strong>{roundedPercentage(analysis.overall_average)}</strong><span>Overall Average</span></div>
              </header>

              {subjects.length === 0 ? <div className="analysis-state">No assessment results are available for this student.</div> : (
                <>
                  <div className="progress-summary-grid">
                    <article className="progress-summary-card"><span>Tests Completed</span><strong>{tests.length}</strong><small>Active, non-absent assessments</small></article>
                    <article className="progress-summary-card positive"><span>Strongest Subject</span><strong>{strongestSubject?.subject || "-"}</strong><small>{roundedPercentage(strongestSubject?.average_percentage)} average</small></article>
                    <article className="progress-summary-card attention"><span>Needs Improvement</span><strong>{improvementSubject?.subject || "-"}</strong><small>{roundedPercentage(improvementSubject?.average_percentage)} average</small></article>
                    <article className={`progress-summary-card ${progressChange >= 0 ? "positive" : "attention"}`}><span>Progress Change</span><strong>{progressChange > 0 ? "+" : ""}{progressChange}%</strong><small>First test to latest test</small></article>
                  </div>

                  <div className="progress-report-grid">
                    <article className="module-card progress-subject-card">
                      <h2>Subject-wise Progress</h2>
                      <div className="progress-subject-list">
                        {sortedSubjects.map((subject) => (
                          <div className="progress-subject-row" key={subject.subject}>
                            <div><strong>{subject.subject}</strong><span>{roundedPercentage(subject.average_percentage)}</span></div>
                            <div className="progress-track"><i style={{ width: `${Math.min(100, Number(subject.average_percentage) || 0)}%` }} /></div>
                          </div>
                        ))}
                      </div>
                    </article>

                    <article className="module-card progress-latest-card">
                      <h2>Latest Test Summary</h2>
                      {latestTest ? <>
                        <div className="progress-latest-heading"><div><strong>{latestTest.test_name}</strong><span>{formatDate(latestTest.assessment_date)}</span></div><b>{roundedPercentage(latestTest.average_percentage)}</b></div>
                        <div className="progress-latest-subjects">
                          {latestTest.subjects.map((subject) => <div key={subject.subject}><span>{subject.subject}</span><strong>{subject.marks_obtained} / {subject.max_marks}</strong><small>{roundedPercentage(subject.percentage)}</small></div>)}
                        </div>
                      </> : <p>No completed test is available.</p>}
                    </article>

                    <article className="module-card progress-history-card">
                      <h2>Assessment History</h2>
                      <div className="progress-history-table-wrap">
                        <table className="data-table">
                          <thead><tr><th>Test</th><th>Date</th><th>Subjects</th><th>Average</th></tr></thead>
                          <tbody>{tests.map((test) => <tr key={`${test.test_name}-${test.assessment_date}`}><td>{test.test_name}</td><td>{formatDate(test.assessment_date)}</td><td>{test.subjects.length}</td><td><span className="status-pill completed">{roundedPercentage(test.average_percentage)}</span></td></tr>)}</tbody>
                        </table>
                      </div>
                    </article>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </DashboardShell>
  );
}

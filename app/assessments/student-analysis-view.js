"use client";

import { useEffect, useState } from "react";
import { getApiBaseUrl } from "../api-base-url";
import { getLoggedInUserEmail } from "../login-session";


const API_BASE_URL = getApiBaseUrl();
const COLORS = ["#1266d6", "#f2a900", "#42ad4b", "#f31f2f", "#8b5cf6", "#06b6d4"];


async function getLoggedInStudentEmail() {
  return getLoggedInUserEmail();
}


function RingChart({ overallAverage, subjects }) {
  const total = subjects.reduce((sum, item) => sum + Number(item.average_percentage || 0), 0);
  let consumed = 0;
  const background = total > 0
    ? `conic-gradient(${subjects.map((item, index) => {
        const start = consumed;
        consumed += (Number(item.average_percentage || 0) / total) * 100;
        return `${COLORS[index % COLORS.length]} ${start}% ${consumed}%`;
      }).join(", ")})`
    : undefined;

  return (
    <div className="ring-chart" style={background ? { background } : undefined}>
      <div className="ring-number">{Math.round(overallAverage)}%</div>
      <span>Overall Average</span>
    </div>
  );
}


function TimelineChart({ timeline }) {
  const values = timeline.length ? timeline.map((item) => Number(item.average_percentage || 0)) : [0];
  const xForIndex = (index) => values.length === 1 ? 188 : 24 + index * (330 / (values.length - 1));
  const points = values.map((value, index) => `${xForIndex(index)},${150 - (value / 100) * 116}`).join(" ");

  return (
    <div className="chart-panel">
      <svg viewBox="0 0 380 190" role="img" aria-label="Student test result timeline">
        {[40, 75, 110, 145].map((y) => <line className="chart-grid-line" x1="18" x2="354" y1={y} y2={y} key={y} />)}
        <polyline className="line-solid" points={points} />
        {values.map((value, index) => (
          <circle
            className="line-dot"
            cx={xForIndex(index)}
            cy={150 - (value / 100) * 116}
            r="5"
            key={`${value}-${index}`}
          />
        ))}
      </svg>
      <div className="chart-labels">
        {timeline.map((item) => <span key={`${item.label}-${item.assessment_date}`}>{item.label}</span>)}
      </div>
    </div>
  );
}


export default function StudentAnalysisView() {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadAnalysis() {
      try {
        const email = await getLoggedInStudentEmail();
        if (!email) {
          throw new Error("Logged-in student email is unavailable.");
        }
        const response = await fetch(`${API_BASE_URL}/student-analysis?email=${encodeURIComponent(email)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data.detail === "string" ? data.detail : "Unable to load student analysis.");
        }
        if (!cancelled) {
          setAnalysis(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Unable to load student analysis.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAnalysis();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="analysis-state" role="status">Loading student analysis...</div>;
  }
  if (error) {
    return <div className="analysis-state error" role="alert">{error}</div>;
  }

  const subjects = analysis?.subject_performance || [];
  const timeline = analysis?.timeline || [];
  const detailedTests = analysis?.detailed_tests || [];
  const focusAreas = analysis?.focus_areas || [];
  const initials = String(analysis?.student?.full_name || "Student")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <section className="assessment-dashboard student-analysis-view">
      <div className="assessment-dashboard-head">
        <div>
          <h2>{analysis.student.full_name} - Student Analysis</h2>
          <p>Academic Year {analysis.academic_year}</p>
        </div>
        <div className="tiny-avatar">{initials}</div>
      </div>

      {subjects.length === 0 ? (
        <div className="analysis-state">No assessment results are available for this student.</div>
      ) : (
        <div className="analysis-grid student-analysis-grid">
          <article className="analysis-card performance-card">
            <h3>Final Subject Performance</h3>
            <p>(Average of all Tests)</p>
            <div className="performance-row">
              <RingChart overallAverage={analysis.overall_average} subjects={subjects} />
              <div className="legend-list subjects dynamic-subject-legend">
                {subjects.map((item, index) => (
                  <span key={item.subject}>
                    <i style={{ background: COLORS[index % COLORS.length] }} />
                    {item.subject} <strong>{Math.round(item.average_percentage)}%</strong>
                  </span>
                ))}
              </div>
            </div>
          </article>

          <article className="analysis-card">
            <h3>Test Result Timeline</h3>
            <TimelineChart timeline={timeline} />
          </article>

          <article className="analysis-card">
            <h3>Detailed Test Performance by Subject</h3>
            <div className="test-performance-list">
              {detailedTests.map((test) => (
                <div className="test-row" key={`${test.test_name}-${test.assessment_date}`}>
                  <strong>{test.test_name}</strong>
                  <span>{test.subjects.map((item) => `${item.subject}: ${Math.round(item.percentage)}%`).join("  |  ")}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="analysis-card">
            <h3>Focus Area Improvements</h3>
            <div className="focus-list">
              {focusAreas.map((item, index) => (
                <div className="focus-row dynamic-focus-row" key={item.subject}>
                  <div><strong>{item.subject}</strong><span>{item.priority}</span></div>
                  <div><i style={{ width: `${item.current_percentage}%`, background: COLORS[index % COLORS.length] }} /></div>
                  <strong>{Math.round(item.current_percentage)}%</strong>
                </div>
              ))}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

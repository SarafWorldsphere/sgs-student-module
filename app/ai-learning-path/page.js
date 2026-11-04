"use client";

import { useEffect, useState } from "react";
import AppSelect from "../app-select";
import { getApiBaseUrl } from "../api-base-url";
import { getLoggedInUserEmail } from "../login-session";
import DashboardShell from "../dashboard-shell";
import StudyTabs from "../study-tabs";

const API_BASE_URL = getApiBaseUrl();
const learnerTracks = [
  {
    key: "Fast Reader",
    title: "Fast Reader Material",
    description: "Quick revision notes, challenge questions, and enrichment work.",
    markers: ["Short notes", "Timed quiz", "Advanced practice"]
  },
  {
    key: "Average Reader",
    title: "Average Reader Material",
    description: "Balanced chapter notes with guided checkpoints and practice.",
    markers: ["Section reading", "Key points", "Quiz correction"]
  },
  {
    key: "Slow Reader",
    title: "Slow Reader Material",
    description: "Smaller reading blocks, recap support, and retry guidance.",
    markers: ["Audio support", "Keyword help", "Step practice"]
  }
];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { credentials: "include", cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : "Request failed.");
  }

  return data;
}

function metricValue(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "Not graded";
  }

  return `${Number(value).toFixed(1).replace(/\.0$/, "")}%`;
}

export default function AiLearningPathPage() {
  const [student, setStudent] = useState(null);
  const [studentEmail, setStudentEmail] = useState("");
  const [performance, setPerformance] = useState(null);
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [selectedClass, setSelectedClass] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [learningPath, setLearningPath] = useState(null);
  const [generatedContent, setGeneratedContent] = useState(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loadingPage, setLoadingPage] = useState(true);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [generatingPath, setGeneratingPath] = useState(false);
  const [generatingContent, setGeneratingContent] = useState(false);

  const classification = performance?.classification || null;

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      setLoadingPage(true);
      setError("");

      try {
        const email = await getLoggedInUserEmail();
        if (!email) throw new Error("Logged-in student email is unavailable.");
        const emailParams = new URLSearchParams({ email });
        const [studentData, classesData] = await Promise.all([
          fetchJson(`${API_BASE_URL}/students/current?${emailParams.toString()}`),
          fetchJson(`${API_BASE_URL}/classes?${emailParams.toString()}`)
        ]);
        const currentStudent = studentData.student;
        const currentClassId = currentStudent?.class_id;
        const availableClasses = Array.isArray(classesData.classes) ? classesData.classes : [];
        const classId = availableClasses.some((item) => String(item.class_id) === String(currentClassId))
          ? String(currentClassId)
          : String(availableClasses[0]?.class_id || "");

        const performanceData = await fetchJson(`${API_BASE_URL}/student-performance-summary?student_id=${currentStudent.student_id}`);

        if (!cancelled) {
          setStudentEmail(email);
          setStudent(currentStudent);
          setClasses(availableClasses);
          setSelectedClass(classId);
          setPerformance(performanceData);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Unable to load AI learning data.");
        }
      } finally {
        if (!cancelled) {
          setLoadingPage(false);
        }
      }
    }

    loadInitialData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSubjects() {
      if (!selectedClass || !studentEmail) {
        setSubjects([]);
        setSelectedSubject("");
        return;
      }

      setLoadingSubjects(true);
      setSubjects([]);
      setSelectedSubject("");
      setChapters([]);
      setSelectedChapter("");
      setGeneratedContent(null);

      try {
        const params = new URLSearchParams({ class_id: selectedClass, email: studentEmail });
        const data = await fetchJson(`${API_BASE_URL}/subjects?${params.toString()}`);
        if (!cancelled) {
          setSubjects(Array.isArray(data.subjects) ? data.subjects : []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Unable to load subjects.");
        }
      } finally {
        if (!cancelled) {
          setLoadingSubjects(false);
        }
      }
    }

    loadSubjects();

    return () => {
      cancelled = true;
    };
  }, [selectedClass, studentEmail]);

  useEffect(() => {
    let cancelled = false;

    async function loadChapters() {
      if (!selectedClass || !selectedSubject || !studentEmail) {
        setChapters([]);
        setSelectedChapter("");
        return;
      }

      setLoadingChapters(true);
      setChapters([]);
      setSelectedChapter("");
      setGeneratedContent(null);

      try {
        const params = new URLSearchParams({
          class_id: selectedClass,
          subject_id: selectedSubject,
          email: studentEmail
        });
        const data = await fetchJson(`${API_BASE_URL}/chapter-content-list?${params.toString()}`);
        if (!cancelled) {
          setChapters(Array.isArray(data.chapters) ? data.chapters : []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Unable to load chapters.");
        }
      } finally {
        if (!cancelled) {
          setLoadingChapters(false);
        }
      }
    }

    loadChapters();

    return () => {
      cancelled = true;
    };
  }, [selectedClass, selectedSubject, studentEmail]);

  async function refreshPerformance() {
    if (!student?.student_id) {
      return;
    }

    setStatus("Refreshing performance summary...");
    setError("");

    try {
      const data = await fetchJson(`${API_BASE_URL}/student-performance-summary?student_id=${student.student_id}`);
      setPerformance(data);
      setLearningPath(null);
      setGeneratedContent(null);
      setStatus("Performance summary refreshed.");
    } catch (refreshError) {
      setError(refreshError.message || "Unable to refresh performance summary.");
    }
  }

  async function generateLearningPath() {
    if (!student || !classification) {
      return;
    }

    setGeneratingPath(true);
    setStatus("Generating AI learning path...");
    setError("");

    try {
      const data = await fetchJson(`${API_BASE_URL}/learning-path/generate-overall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: student.student_id
        })
      });
      setPerformance(data.performance);
      setLearningPath(data.learning_path);
      setStatus("AI learning path generated from overall performance.");
    } catch (generateError) {
      setError(generateError.message || "Unable to generate learning path.");
    } finally {
      setGeneratingPath(false);
    }
  }

  async function generateStudyContent() {
    if (!student || !selectedChapter || !classification) {
      setError("Please select a class, subject, and chapter before generating content.");
      return;
    }

    setGeneratingContent(true);
    setStatus("Generating AI study content...");
    setError("");

    try {
      const data = await fetchJson(`${API_BASE_URL}/ai/generate-study-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          student_id: student.student_id,
          chapter_content_id: Number(selectedChapter)
        })
      });
      setGeneratedContent(data);
      setPerformance(data.performance);
      if (data.classification !== classification) setLearningPath(null);
      setStatus("AI study content generated for the selected chapter.");
    } catch (generateError) {
      setError(generateError.message || "Unable to generate study content.");
    } finally {
      setGeneratingContent(false);
    }
  }

  return (
    <DashboardShell>
      <section className="module-page learning-path-page">
        <StudyTabs />
        <div className="module-content-area">
          <article className="module-card ai-learning-card">
            <div className="card-title-row">
              <div>
                <h2>AI Learning Path</h2>
                <p>PT1, PT2, weekly test, quiz and assignment marks guide your learning path. Select a chapter for study content.</p>
              </div>
              <span className={`status-pill ${classification ? "completed" : "not-started"}`}>{classification || "Awaiting marks"}</span>
            </div>

            <div className="learning-track-grid">
              {learnerTracks.map((track) => (
                <section className={`learning-track ${classification === track.key ? "selected" : ""}`} key={track.key}>
                  <h3>{track.title}</h3>
                  <p>{track.description}</p>
                  <div className="track-marker-row">
                    {track.markers.map((marker) => <span key={marker}>{marker}</span>)}
                  </div>
                </section>
              ))}
            </div>

            <div className="result-grid learning-marks-grid" aria-label="Marks used for learning path">
              <div><span>PT1</span><strong>{metricValue(performance?.pt1_marks)}</strong></div>
              <div><span>PT2</span><strong>{metricValue(performance?.pt2_marks)}</strong></div>
              <div><span>Weekly Test</span><strong>{metricValue(performance?.weekly_test_marks)}</strong></div>
              <div><span>Quiz</span><strong>{metricValue(performance?.quiz_score)}</strong></div>
              <div><span>Assignment</span><strong>{metricValue(performance?.assignment_marks)}</strong></div>
              <div><span>Overall Score</span><strong>{metricValue(performance?.overall_score)}</strong></div>
            </div>
            {performance && <p className="learning-scoring-note">Equal weight for available categories only. Slow: below 50%; Average: 50–below 75%; Fast: 75% or above. This chooses study material, not a measured reading speed.</p>}
            {performance && !classification && <div className="learning-status notice" role="status">No graded marks are available yet. Your learning path will be available after marks are recorded.</div>}
            {Boolean(performance?.grading_scale_needed?.length) && <div className="learning-status notice" role="status">Some {performance.grading_scale_needed.join(", ")} marks need a confirmed grading scale before they can be included.</div>}

            <div className="learning-form-grid">
              <label>
                <span>Class</span>
                <AppSelect
                  value={selectedClass}
                  options={classes.map((classItem) => ({
                    value: classItem.class_id,
                    label: `${classItem.class_name}${classItem.section_name ? ` - ${classItem.section_name}` : ""}`
                  }))}
                  disabled={loadingPage}
                  onChange={setSelectedClass}
                  placeholder="Select Class"
                  ariaLabel="Select class"
                  searchable
                />
              </label>
              <label>
                <span>Subject</span>
                <AppSelect
                  value={selectedSubject}
                  options={subjects.map((subject) => ({ value: subject.subject_id, label: subject.subject_name }))}
                  disabled={!selectedClass || loadingSubjects}
                  onChange={setSelectedSubject}
                  placeholder={loadingSubjects ? "Loading Subjects" : "Select Subject"}
                  ariaLabel="Select subject"
                  searchable
                />
              </label>
              <label>
                <span>Chapter</span>
                <AppSelect
                  value={selectedChapter}
                  options={chapters.map((chapter) => ({ value: chapter.chapter_content_id, label: chapter.content_title }))}
                  disabled={!selectedSubject || loadingChapters}
                  onChange={setSelectedChapter}
                  placeholder={loadingChapters ? "Loading Chapters" : "Select Chapter"}
                  ariaLabel="Select chapter"
                  searchable
                />
              </label>
            </div>

            <div className="quiz-submit-row">
              <button className="soft-button" type="button" onClick={refreshPerformance} disabled={loadingPage}>Refresh Performance</button>
              <button className="primary-button" type="button" onClick={generateLearningPath} disabled={!classification || generatingPath || generatingContent}>
                {generatingPath ? "Generating..." : "Generate Path"}
              </button>
              <button className="primary-button" type="button" onClick={generateStudyContent} disabled={!classification || !selectedChapter || generatingContent || generatingPath}>
                {generatingContent ? "Generating..." : "Generate Content"}
              </button>
            </div>

            {status && <div className="learning-status success" role="status">{status}</div>}
            {error && <div className="learning-status error" role="alert">{error}</div>}
          </article>

          {learningPath && (
            <article className="module-card generated-path-card">
              <div className="card-title-row">
                <div>
                  <h2>{learningPath.track_title}</h2>
                  <p>{learningPath.summary}</p>
                </div>
                <span className="status-pill in-progress">{learningPath.provider}</span>
              </div>
              <div className="learning-focus-box">
                <strong>Focus Area</strong>
                <p>{learningPath.focus_area}</p>
              </div>
              <ol className="learning-step-list">
                {(learningPath.steps || []).map((step) => <li key={step}>{step}</li>)}
              </ol>
              <div className="recommended-materials">
                <h3>Recommended Material</h3>
                {(learningPath.recommended_materials || []).map((material) => <span key={material}>{material}</span>)}
              </div>
            </article>
          )}

          {generatedContent && (
            <article className="module-card generated-content-preview-card">
              <div className="card-title-row">
                <div>
                  <h2>{generatedContent.chapter_title}</h2>
                  <p>AI generated study content for {generatedContent.classification}.</p>
                </div>
                <span className="status-pill not-started">Generated Content</span>
              </div>

              <div className="content-preview-layout">
                <section className="content-preview-main">
                  <div className="preview-section-head">
                    <span className="preview-icon notes" aria-hidden="true" />
                    <div>
                      <h3>Simple Notes</h3>
                      <p>{(generatedContent.generated_content?.simple_notes || []).join(" ")}</p>
                    </div>
                  </div>
                  <div className="learning-focus-box">
                    <strong>Recap</strong>
                    <p>{generatedContent.generated_content?.recap || "-"}</p>
                  </div>
                  <ol className="learning-step-list">
                    {(generatedContent.generated_content?.practice_questions || []).map((question) => <li key={question}>{question}</li>)}
                  </ol>
                </section>

                <aside className="content-preview-side">
                  <section>
                    <h3>Key Terms</h3>
                    <div className="preview-check-list">
                      {(generatedContent.generated_content?.key_terms || []).map((item) => (
                        <span key={`${item.term}-${item.meaning}`}>{item.term}: {item.meaning}</span>
                      ))}
                    </div>
                  </section>
                </aside>
              </div>
            </article>
          )}
        </div>
      </section>
    </DashboardShell>
  );
}

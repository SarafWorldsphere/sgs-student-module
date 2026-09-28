"use client";

import { useEffect, useMemo, useState } from "react";
import AppSelect from "../app-select";
import { getApiBaseUrl } from "../api-base-url";
import { getLoggedInUserEmail } from "../login-session";
import DashboardShell from "../dashboard-shell";
import StudyTabs from "../study-tabs";

const API_BASE_URL = getApiBaseUrl();
const CONFIGURED_LOGIN_SERVICE_URL = (process.env.NEXT_PUBLIC_LOGIN_URL || "").trim().replace(/\/+$/, "");

function getLoginServiceUrl() {
  return CONFIGURED_LOGIN_SERVICE_URL || (typeof window !== "undefined" ? window.location.origin : "");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 35000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export default function QuizzesPage() {
  const [studentEmail, setStudentEmail] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");
  const [chapters, setChapters] = useState([]);
  const [chapterId, setChapterId] = useState("");
  const [questions, setQuestions] = useState([]);
  const [chapterTitle, setChapterTitle] = useState("Select Chapter");
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [quizRequested, setQuizRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingResult, setSavingResult] = useState(false);
  const [loadingChapters, setLoadingChapters] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [savedResults, setSavedResults] = useState({ attempted_count: 0, average_percentage: 0, latest_result: null });

  async function loadSavedResults(email) {
    if (!email) return;
    const response = await fetch(`${API_BASE_URL}/quiz-results?${new URLSearchParams({ email }).toString()}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Unable to load quiz results.");
    setSavedResults(data);
  }

  const selectedChapter = useMemo(() => {
    return chapters.find((chapter) => String(chapter.chapter_id) === String(chapterId)) || null;
  }, [chapterId, chapters]);

  useEffect(() => {
    let cancelled = false;

    async function loadStudentSubjects() {
      setLoadingChapters(true);
      setError("");

      try {
        const email = await getLoggedInUserEmail();
        if (!email) throw new Error("Logged-in student email is unavailable.");
        const studentResponse = await fetch(`${API_BASE_URL}/students/current?${new URLSearchParams({ email }).toString()}`);
        const studentData = await studentResponse.json().catch(() => ({}));
        if (!studentResponse.ok) {
          throw new Error(typeof studentData.detail === "string" ? studentData.detail : "Unable to load student class.");
        }

        const classId = studentData.student?.class_id;
        const response = await fetch(`${API_BASE_URL}/subjects?${new URLSearchParams({ class_id: String(classId), email }).toString()}`);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(typeof data.detail === "string" ? data.detail : "Unable to load subjects.");
        }

        const availableSubjects = Array.isArray(data.subjects) ? data.subjects : [];
        if (!cancelled) {
          setStudentEmail(email);
          setSubjects(availableSubjects);
          setSubjectId(availableSubjects[0] ? String(availableSubjects[0].subject_id) : "");
          if (availableSubjects.length === 0) setError("No subjects are assigned to this class.");
          await loadSavedResults(email);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Unable to load quiz chapters.");
        }
      } finally {
        if (!cancelled) {
          setLoadingChapters(false);
        }
      }
    }

    loadStudentSubjects();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadChaptersForSubject() {
      setChapters([]);
      setChapterId("");
      setChapterTitle("Select Chapter");
      setQuestions([]);
      setQuizRequested(false);
      if (!studentEmail || !subjectId) {
        setLoadingChapters(false);
        return;
      }

      setLoadingChapters(true);
      setError("");
      try {
        const params = new URLSearchParams({ email: studentEmail, subject_id: subjectId });
        const response = await fetch(`${API_BASE_URL}/quiz-chapters?${params.toString()}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Unable to load quiz chapters.");

        const availableChapters = Array.isArray(data.chapters) ? data.chapters : [];
        if (!cancelled) {
          setChapters(availableChapters);
          const firstChapter = availableChapters[0];
          setChapterId(firstChapter ? String(firstChapter.chapter_id) : "");
          setChapterTitle(firstChapter?.content_title || "Select Chapter");
          if (availableChapters.length === 0) setError("No linked chapters are available for this subject.");
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Unable to load quiz chapters.");
      } finally {
        if (!cancelled) setLoadingChapters(false);
      }
    }

    loadChaptersForSubject();
    return () => { cancelled = true; };
  }, [studentEmail, subjectId]);

  const score = useMemo(() => {
    return questions.reduce((total, question, index) => {
      return answers[index] === question.answer ? total + 1 : total;
    }, 0);
  }, [answers, questions]);

  const allAnswered = questions.length > 0 && Object.keys(answers).length === questions.length;
  const totalMarks = questions.length * 5;
  const marks = score * 5;

  async function handleAskAi() {
    if (!selectedChapter) {
      setError("Select a chapter before generating the quiz.");
      return;
    }

    setQuizRequested(true);
    setLoading(true);
    setError("");
    setStatus("Generating AI quiz...");
    setAnswers({});
    setSubmitted(false);
    setQuestions([]);
    setChapterTitle(selectedChapter.content_title);

    try {
      const userEmail = await getLoggedInUserEmail();
      const response = await fetchWithTimeout(`${API_BASE_URL}/ai/generate-quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapter_id: Number(chapterId),
          question_count: 5,
          user_email: userEmail
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Unable to generate AI quiz.");
      }

      const generatedQuestions = Array.isArray(data.quiz) ? data.quiz : [];
      if (generatedQuestions.length === 0) {
        throw new Error("AI did not return any quiz questions.");
      }

      setQuestions(generatedQuestions);
      setChapterTitle(data.chapter_title || selectedChapter.content_title);
      const resourceMessage = data.resource_count > 0
        ? ` Generated from ${data.resource_count} uploaded study material${data.resource_count === 1 ? "" : "s"}.`
        : " Generated from chapter content.";
      setStatus(`AI quiz generated.${resourceMessage} Select one answer for each question.`);
    } catch (quizError) {
      setError(quizError.name === "AbortError" ? "AI quiz generation timed out. Please try again." : quizError.message);
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!allAnswered || !selectedChapter || savingResult) {
      return;
    }

    setSavingResult(true);
    setError("");
    setStatus("Saving quiz result...");

    try {
      const studentEmail = await getLoggedInUserEmail();

      if (!studentEmail) {
        throw new Error("Logged-in student identity is unavailable.");
      }

      const percentage = totalMarks > 0 ? Number(((marks / totalMarks) * 100).toFixed(2)) : 0;
      const response = await fetch(`${API_BASE_URL}/quiz-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          student_email: studentEmail,
          chapter_id: Number(chapterId),
          score: marks,
          total_marks: totalMarks,
          percentage
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Unable to save quiz result.");
      }

      setSubmitted(true);
      await loadSavedResults(studentEmail);
      setStatus("Quiz auto-corrected and result saved.");
    } catch (saveError) {
      setError(saveError.message || "Unable to save quiz result.");
      setStatus("");
    } finally {
      setSavingResult(false);
    }
  }

  function handleReset() {
    setAnswers({});
    setSubmitted(false);
    setQuizRequested(false);
    setQuestions([]);
    setError("");
    setStatus("");
  }

  function handleChapterChange(value) {
    const nextChapter = chapters.find((chapter) => String(chapter.chapter_id) === String(value));
    setChapterId(String(value));
    setChapterTitle(nextChapter?.content_title || "Select Chapter");
    setAnswers({});
    setSubmitted(false);
    setQuizRequested(false);
    setQuestions([]);
    setError("");
    setStatus("");
  }

  return (
    <DashboardShell>
      <section className="module-page">
        <StudyTabs />
        <div className="module-content-area">
          <div className="quiz-layout">
            <article className="module-card quiz-card">
              <div className="card-title-row material-title-row">
                <div>
                  <h2>{chapterTitle}</h2>
                  <p>AI generated MCQ quiz with instant auto correction.</p>
                </div>
                <span className={`status-pill ${submitted ? "completed" : "not-attempted"}`}>{submitted ? "Completed" : "Not Attempted"}</span>
              </div>

              <form className="material-filter-row quiz-filter-row" aria-label="Quiz filters">
                <AppSelect
                  value={subjectId}
                  options={subjects.map((subject) => ({ value: subject.subject_id, label: subject.subject_name }))}
                  ariaLabel="Select subject"
                  onChange={(value) => setSubjectId(String(value))}
                  disabled={loading || subjects.length === 0}
                  placeholder="Select Subject"
                  searchable
                  className="quiz-subject-app-select"
                />
                <AppSelect
                  value={chapterId}
                  options={chapters.map((chapter) => ({
                    value: chapter.chapter_id,
                    label: chapter.content_title
                  }))}
                  ariaLabel="Select chapter"
                  onChange={handleChapterChange}
                  disabled={loading || loadingChapters || chapters.length === 0}
                  placeholder={loadingChapters ? "Loading Chapters..." : "Select Chapter"}
                  searchable
                  className="quiz-chapter-app-select"
                />
              </form>

              <div className="meta-row">
                <span>Total Marks: {totalMarks || 25}</span>
                <span>Questions: {questions.length}</span>
                <span>Duration: 30 mins</span>
              </div>

              {error && <div className="learning-status error" role="alert">{error}</div>}
              {status && <div className="learning-status success" role="status">{status}</div>}

              {(!quizRequested || error) && (
                <div className="quiz-submit-row">
                  <button className="primary-button" type="button" onClick={handleAskAi} disabled={loading || loadingChapters || !selectedChapter}>
                    {loading ? "Generating..." : "Ask AI"}
                  </button>
                </div>
              )}

              {quizRequested && !error && (
                <>
                  {loading && <div className="table-message-cell">Generating questions from chapter content...</div>}

                  {!loading && (
                    <div className="quiz-question-list">
                      {questions.map((item, questionIndex) => (
                        <fieldset className="quiz-question" key={`${item.question}-${questionIndex}`} disabled={submitted}>
                          <legend>{questionIndex + 1}. {item.question}</legend>
                          <div className="quiz-options">
                            {item.options.map((option, optionIndex) => {
                              const optionId = `q-${questionIndex}-option-${optionIndex}`;
                              const selected = answers[questionIndex] === optionIndex;
                              const correct = submitted && item.answer === optionIndex;
                              const wrong = submitted && selected && item.answer !== optionIndex;

                              return (
                                <label className={`quiz-option ${selected ? "selected" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`} htmlFor={optionId} key={option}>
                                  <input
                                    id={optionId}
                                    name={`question-${questionIndex}`}
                                    type="radio"
                                    checked={selected}
                                    onChange={() => setAnswers((current) => ({ ...current, [questionIndex]: optionIndex }))}
                                  />
                                  <span>{option}</span>
                                </label>
                              );
                            })}
                          </div>
                          {submitted && item.explanation && <p className="quiz-explanation">{item.explanation}</p>}
                        </fieldset>
                      ))}
                    </div>
                  )}

                  {!loading && !allAnswered && !submitted && <p className="quiz-warning">Please answer all {questions.length} questions before submitting.</p>}

                  {!loading && (
                    <div className="quiz-submit-row">
                      <button className="primary-button" type="button" onClick={handleSubmit} disabled={!allAnswered || submitted || savingResult}>
                        {savingResult ? "Saving..." : "Submit Quiz"}
                      </button>
                      <button className="soft-button" type="button" onClick={handleReset}>Reset</button>
                    </div>
                  )}
                </>
              )}
            </article>

            <article className="module-card latest-result-card">
              <h2>Quiz Result</h2>
              <div className="result-grid quiz-result-grid">
                <div><span>Chapter Title</span><strong>{chapterTitle}</strong></div>
                <div><span>Score</span><strong className="score-text">{submitted ? `${marks} / ${totalMarks}` : `- / ${totalMarks || 25}`}</strong></div>
                <div><span>Correct Answers</span><strong>{submitted ? `${score} / ${questions.length}` : "-"}</strong></div>
                <div><span>Status</span><strong>{submitted ? "Completed" : quizRequested && !error ? "In Progress" : "Pending"}</strong></div>
                <div><span>Quizzes Attempted</span><strong>{savedResults.attempted_count || 0}</strong></div>
                <div><span>Average Score</span><strong>{Math.round(savedResults.average_percentage || 0)}%</strong></div>
              </div>
              {!submitted && savedResults.latest_result && (
                <div className="quiz-score-card">
                  <strong>Latest saved result: {savedResults.latest_result.chapter_title}</strong>
                  <p>{savedResults.latest_result.score} / {savedResults.latest_result.total_marks} ({Math.round(savedResults.latest_result.percentage || 0)}%)</p>
                </div>
              )}
              {submitted && (
                <div className="quiz-score-card">
                  <strong>{marks >= totalMarks * 0.8 ? "Excellent work!" : marks >= totalMarks * 0.6 ? "Good attempt!" : "Keep practicing!"}</strong>
                  <p>You scored {marks} marks out of {totalMarks}.</p>
                </div>
              )}
            </article>
          </div>
          <div className="note-box">Click Ask AI to generate a fresh quiz from the selected chapter, then submit for auto correction.</div>
        </div>
      </section>
    </DashboardShell>
  );
}

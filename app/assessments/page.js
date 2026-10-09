"use client";

import { useEffect, useMemo, useState } from "react";
import { getApiBaseUrl } from "../api-base-url";
import { getLoggedInUserEmail } from "../login-session";
import AppSelect from "../app-select";
import DashboardShell from "../dashboard-shell";
import StudyTabs from "../study-tabs";
import StudentAnalysisView from "./student-analysis-view";

const API_BASE_URL = getApiBaseUrl();
const MOCK_TEST_DURATION_SECONDS = 15 * 60;

function TeacherRemarkView() {
  const emptyCards = [
    ["Performance Overview", "donut"],
    ["At-Risk Students", "bars"],
    ["Top Subjects", "rows"],
    ["Engagement Heatmap", "heatmap"],
    ["Learning Progress", "progress"],
    ["Growth Trend", "line"]
  ];

  return (
    <section className="assessment-dashboard teacher-remark-dashboard" aria-label="Teacher remark dashboard">
      <div className="assessment-dashboard-head">
        <div>
          <h2>Teacher Remark</h2>
          <p>Performance graphs will update after your teacher reviews an assessment.</p>
        </div>
      </div>
      <div className="analysis-grid">
        {emptyCards.map(([title, type]) => (
          <article className="analysis-card empty-graph-card" key={title}>
            <h3>{title}</h3>
            <div className={`empty-graph empty-graph-${type}`} aria-label={`${title}: no data available`}>
              {type === "donut" && <div className="empty-donut" />}
              {type === "bars" && <div className="empty-bars">{[1, 2, 3, 4, 5, 6].map((item) => <i key={item} />)}</div>}
              {type === "rows" && <div className="empty-rows">{[1, 2, 3, 4].map((item) => <i key={item} />)}</div>}
              {type === "heatmap" && <div className="empty-heatmap">{Array.from({ length: 24 }, (_, index) => <i key={index} />)}</div>}
              {type === "progress" && <div className="empty-progress">{[1, 2, 3, 4].map((item) => <i key={item} />)}</div>}
              {type === "line" && <div className="empty-line-chart"><i /></div>}
            </div>
            <span className="empty-graph-label">No data available</span>
          </article>
        ))}
      </div>
    </section>
  );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function formatMockTimer(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function MockTestView() {
  const [studentEmail, setStudentEmail] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");
  const [mockTestChapters, setMockTestChapters] = useState([]);
  const [chapterId, setChapterId] = useState("");
  const [chapterTitle, setChapterTitle] = useState("Select Chapter");
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [reviewed, setReviewed] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [timeLeft, setTimeLeft] = useState(MOCK_TEST_DURATION_SECONDS);
  const [phase, setPhase] = useState("setup");
  const [loading, setLoading] = useState(false);
  const [loadingChapters, setLoadingChapters] = useState(true);
  const [error, setError] = useState("");
  const [showSubmitConfirmation, setShowSubmitConfirmation] = useState(false);
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  const selectedChapter = useMemo(
    () => mockTestChapters.find((chapter) => String(chapter.chapter_id) === String(chapterId)) || null,
    [chapterId, mockTestChapters]
  );
  const answeredCount = Object.keys(answers).length;
  const score = useMemo(
    () => questions.reduce((total, question, index) => total + (answers[index] === question.answer ? 1 : 0), 0),
    [answers, questions]
  );
  const activeQuestion = questions[currentQuestion];

  useEffect(() => {
    let cancelled = false;

    async function loadMockTestSubjects() {
      setLoadingChapters(true);
      setError("");

      try {
        const email = await getLoggedInUserEmail();
        if (!email) throw new Error("Logged-in student email is unavailable.");
        const studentResponse = await fetch(`${API_BASE_URL}/students/current?${new URLSearchParams({ email }).toString()}`);
        const studentData = await studentResponse.json().catch(() => ({}));
        if (!studentResponse.ok) throw new Error(typeof studentData.detail === "string" ? studentData.detail : "Unable to load student class.");
        const response = await fetch(`${API_BASE_URL}/subjects?${new URLSearchParams({ class_id: String(studentData.student?.class_id), email }).toString()}`);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(typeof data.detail === "string" ? data.detail : "Unable to load mock-test subjects.");
        }

        const availableSubjects = Array.isArray(data.subjects) ? data.subjects : [];
        if (!cancelled) {
          setStudentEmail(email);
          setSubjects(availableSubjects);
          setSubjectId(availableSubjects[0] ? String(availableSubjects[0].subject_id) : "");
          if (availableSubjects.length === 0) setError("No subjects are assigned to this class.");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Unable to load mock-test chapters.");
        }
      } finally {
        if (!cancelled) {
          setLoadingChapters(false);
        }
      }
    }

    loadMockTestSubjects();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadMockTestChapters() {
      setMockTestChapters([]);
      setChapterId("");
      setChapterTitle("Select Chapter");
      setQuestions([]);
      setPhase("setup");
      if (!studentEmail || !subjectId) return;
      setLoadingChapters(true);
      setError("");
      try {
        const params = new URLSearchParams({ email: studentEmail, subject_id: subjectId });
        const response = await fetch(`${API_BASE_URL}/quiz-chapters?${params.toString()}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Unable to load mock-test chapters.");
        const availableChapters = Array.isArray(data.chapters) ? data.chapters : [];
        if (!cancelled) {
          setMockTestChapters(availableChapters);
          const firstChapter = availableChapters[0];
          setChapterId(firstChapter ? String(firstChapter.chapter_id) : "");
          setChapterTitle(firstChapter?.content_title || "Select Chapter");
          if (availableChapters.length === 0) setError("No linked chapters are available for this subject.");
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Unable to load mock-test chapters.");
      } finally {
        if (!cancelled) setLoadingChapters(false);
      }
    }
    loadMockTestChapters();
    return () => { cancelled = true; };
  }, [studentEmail, subjectId]);

  useEffect(() => {
    if (phase !== "testing") return undefined;

    if (timeLeft <= 0) {
      setAutoSubmitted(true);
      setPhase("results");
      setShowSubmitConfirmation(false);
      return undefined;
    }

    const timerId = window.setTimeout(() => setTimeLeft((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearTimeout(timerId);
  }, [phase, timeLeft]);

  async function generateMockTest() {
    if (!selectedChapter) {
      setError("Select a chapter before generating the mock test.");
      return;
    }

    setLoading(true);
    setError("");
    setQuestions([]);
    setAnswers({});
    setReviewed([]);
    setCurrentQuestion(0);
    setTimeLeft(MOCK_TEST_DURATION_SECONDS);
    setPhase("setup");
    setAutoSubmitted(false);

    try {
      const userEmail = await getLoggedInUserEmail();
      const response = await fetchWithTimeout(`${API_BASE_URL}/ai/generate-mock-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter_id: Number(chapterId), user_email: userEmail })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Unable to generate mock test.");
      }

      const generatedQuestions = Array.isArray(data.quiz) ? data.quiz : [];
      if (generatedQuestions.length !== 5) {
        throw new Error("AI must return exactly 5 valid questions. Please generate again.");
      }

      setQuestions(generatedQuestions);
      setChapterTitle(data.chapter_title || selectedChapter.content_title);
      setTimeLeft(Number(data.duration_minutes || 15) * 60);
      setPhase("testing");
    } catch (generationError) {
      setError(
        generationError.name === "AbortError"
          ? "AI question generation timed out. Please try again."
          : generationError.message
      );
    } finally {
      setLoading(false);
    }
  }

  function selectAnswer(optionIndex) {
    if (phase !== "testing") return;
    setAnswers((current) => ({ ...current, [currentQuestion]: optionIndex }));
  }

  function toggleReview() {
    setReviewed((current) => (
      current.includes(currentQuestion)
        ? current.filter((index) => index !== currentQuestion)
        : [...current, currentQuestion]
    ));
  }

  function submitMockTest() {
    setPhase("results");
    setShowSubmitConfirmation(false);
  }

  function resetMockTest() {
    setQuestions([]);
    setAnswers({});
    setReviewed([]);
    setCurrentQuestion(0);
    setTimeLeft(MOCK_TEST_DURATION_SECONDS);
    setPhase("setup");
    setError("");
    setAutoSubmitted(false);
    setShowSubmitConfirmation(false);
    setChapterTitle(selectedChapter.title);
  }

  const percentage = questions.length ? Math.round((score / questions.length) * 100) : 0;

  return (
    <section className="mock-test-view">
      {phase === "setup" && (
        <article className="module-card mock-test-setup-card">
          <div className="mock-test-setup-copy">
            <span className="mock-test-kicker">AI-powered practice exam</span>
            <h2>Generate a 5-Question Mock Test</h2>
            <p>AI will create exactly five multiple-choice questions from the selected chapter.</p>
          </div>

          <div className="mock-test-instructions">
            <div><strong>5</strong><span>Questions</span></div>
            <div><strong>15 min</strong><span>Duration</span></div>
            <div><strong>5</strong><span>Total Marks</span></div>
          </div>

          <label className="mock-test-chapter-field">
            <span>Select Subject</span>
            <AppSelect
              value={subjectId}
              options={subjects.map((subject) => ({ value: subject.subject_id, label: subject.subject_name }))}
              onChange={(value) => setSubjectId(String(value))}
              disabled={loading || subjects.length === 0}
              placeholder="Select Subject"
              ariaLabel="Select mock test subject"
              searchable
            />
          </label>

          <label className="mock-test-chapter-field">
            <span>Select Chapter</span>
            <AppSelect
              value={chapterId}
              options={mockTestChapters.map((chapter) => ({
                value: chapter.chapter_id,
                label: chapter.content_title
              }))}
              onChange={(value) => {
                const nextChapter = mockTestChapters.find((chapter) => String(chapter.chapter_id) === String(value));
                setChapterId(String(value));
                setChapterTitle(nextChapter?.content_title || "Select Chapter");
                setError("");
              }}
              disabled={loading || loadingChapters || mockTestChapters.length === 0}
              placeholder={loadingChapters ? "Loading Chapters..." : "Select Chapter"}
              ariaLabel="Select mock test chapter"
              searchable
            />
          </label>

          {error && <div className="learning-status error" role="alert">{error}</div>}
          <div className="quiz-submit-row">
            <button className="primary-button" type="button" onClick={generateMockTest} disabled={loading || loadingChapters || !selectedChapter}>
              {loading ? "AI is generating 5 questions..." : "Generate Mock Test"}
            </button>
          </div>
          {loading && <p className="mock-generation-note">This may take a few seconds. Questions are generated only from the selected chapter content.</p>}
        </article>
      )}

      {(phase === "testing" || phase === "results") && (
        <div className="mock-test-layout">
          <article className="module-card mock-question-card">
            <div className="mock-question-head">
              <div>
                <span>Question {currentQuestion + 1} of 5</span>
                <h2>{chapterTitle}</h2>
              </div>
              <span className={`mock-timer ${timeLeft <= 120 && phase === "testing" ? "urgent" : ""}`}>
                {phase === "results" ? "Completed" : formatMockTimer(timeLeft)}
              </span>
            </div>

            {activeQuestion && (
              <fieldset className="quiz-question mock-question" disabled={phase === "results"}>
                <legend>{currentQuestion + 1}. {activeQuestion.question}</legend>
                <div className="quiz-options">
                  {activeQuestion.options.map((option, optionIndex) => {
                    const selected = answers[currentQuestion] === optionIndex;
                    const correct = phase === "results" && activeQuestion.answer === optionIndex;
                    const wrong = phase === "results" && selected && activeQuestion.answer !== optionIndex;

                    return (
                      <label
                        className={`quiz-option ${selected ? "selected" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}
                        key={option}
                      >
                        <input
                          type="radio"
                          name={`mock-question-${currentQuestion}`}
                          checked={selected}
                          onChange={() => selectAnswer(optionIndex)}
                        />
                        <span>{option}</span>
                      </label>
                    );
                  })}
                </div>
                {phase === "results" && (
                  <p className="quiz-explanation">
                    <strong>{answers[currentQuestion] === activeQuestion.answer ? "Correct. " : "Correct answer shown above. "}</strong>
                    {activeQuestion.explanation || "Review this topic in the chapter material."}
                  </p>
                )}
              </fieldset>
            )}

            <div className="mock-question-actions">
              <button className="soft-button" type="button" onClick={() => setCurrentQuestion((current) => Math.max(0, current - 1))} disabled={currentQuestion === 0}>Previous</button>
              {phase === "testing" && (
                <button className={`soft-button ${reviewed.includes(currentQuestion) ? "review-active" : ""}`} type="button" onClick={toggleReview}>
                  {reviewed.includes(currentQuestion) ? "Remove Review Mark" : "Mark for Review"}
                </button>
              )}
              <button className="soft-button" type="button" onClick={() => setCurrentQuestion((current) => Math.min(4, current + 1))} disabled={currentQuestion === 4}>Next</button>
            </div>
          </article>

          <aside className="module-card mock-test-sidebar">
            <h2>{phase === "results" ? "Mock Test Result" : "Question Palette"}</h2>
            <div className="mock-question-palette">
              {questions.map((question, index) => (
                <button
                  className={`${currentQuestion === index ? "current" : ""} ${answers[index] !== undefined ? "answered" : ""} ${reviewed.includes(index) ? "reviewed" : ""}`}
                  type="button"
                  onClick={() => setCurrentQuestion(index)}
                  key={question.question}
                  aria-label={`Open question ${index + 1}`}
                >
                  {index + 1}
                </button>
              ))}
            </div>

            {phase === "testing" ? (
              <>
                <div className="mock-progress-details">
                  <div><span>Answered</span><strong>{answeredCount}/5</strong></div>
                  <div><span>For Review</span><strong>{reviewed.length}</strong></div>
                  <div><span>Unanswered</span><strong>{5 - answeredCount}</strong></div>
                </div>
                <button className="primary-button mock-submit-button" type="button" onClick={() => setShowSubmitConfirmation(true)}>Submit Mock Test</button>
              </>
            ) : (
              <>
                {autoSubmitted && <div className="submission-warning">Time completed, so the mock test was submitted automatically.</div>}
                <div className="mock-score">
                  <strong>{score} / 5</strong>
                  <span>{percentage}%</span>
                </div>
                <p className="mock-result-message">
                  {percentage >= 80 ? "Excellent work!" : percentage >= 60 ? "Good attempt—review the explanations." : "Keep practicing this chapter."}
                </p>
                <button className="primary-button mock-submit-button" type="button" onClick={resetMockTest}>Generate New Test</button>
              </>
            )}
          </aside>
        </div>
      )}

      {showSubmitConfirmation && (
        <div className="confirmation-backdrop" role="presentation">
          <section className="submission-confirmation" role="dialog" aria-modal="true" aria-labelledby="mock-submit-title">
            <div className="confirmation-icon">?</div>
            <h2 id="mock-submit-title">Submit Mock Test?</h2>
            <p>You answered {answeredCount} of 5 questions.</p>
            {answeredCount < 5 && <div className="submission-warning">{5 - answeredCount} question(s) are unanswered.</div>}
            <div className="confirmation-actions">
              <button className="soft-button" type="button" onClick={() => setShowSubmitConfirmation(false)}>Continue Test</button>
              <button className="primary-button" type="button" onClick={submitMockTest}>Submit Now</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

const COMPETITIVE_EXAMS = [
  {
    id: "science-talent-2026",
    title: "National Science Talent Search",
    subject: "Science",
    level: "School Level",
    duration: 30,
    marks: 15,
    availableUntil: "20 Oct 2026",
    questions: [
      { type: "single", question: "Which part of a plant primarily absorbs water from the soil?", options: ["Flower", "Root", "Stem", "Leaf"], answer: 1, topic: "Plant Life" },
      { type: "multiple", question: "Select all forces that can act without direct physical contact.", options: ["Gravity", "Magnetism", "Friction", "Muscular force"], answer: [0, 1], topic: "Force" },
      { type: "integer", question: "How many poles does a bar magnet have?", answer: "2", topic: "Magnetism" }
    ]
  },
  {
    id: "math-olympiad-2026",
    title: "Inter-School Mathematics Olympiad",
    subject: "Mathematics",
    level: "Inter-School",
    duration: 30,
    marks: 15,
    availableUntil: "25 Oct 2026",
    questions: [
      { type: "single", question: "What is 25% of 200?", options: ["25", "40", "50", "75"], answer: 2, topic: "Percentage" },
      { type: "multiple", question: "Select all prime numbers.", options: ["21", "29", "31", "51"], answer: [1, 2], topic: "Number System" },
      { type: "integer", question: "Enter the sum of the angles of a triangle in degrees.", answer: "180", topic: "Geometry" }
    ]
  }
];

function CompetitiveExamView() {
  const [exam, setExam] = useState(null);
  const [phase, setPhase] = useState("list");
  const [agreed, setAgreed] = useState(false);
  const [answers, setAnswers] = useState({});
  const [reviewed, setReviewed] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (phase !== "attempt" || timeLeft <= 0) return undefined;
    const timer = window.setTimeout(() => setTimeLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, timeLeft]);

  useEffect(() => {
    if (phase === "attempt" && timeLeft === 0) setPhase("result");
  }, [phase, timeLeft]);

  function openExam(selectedExam) {
    setExam(selectedExam);
    setPhase("instructions");
    setAgreed(false);
    setAnswers({});
    setReviewed([]);
    setCurrentQuestion(0);
  }

  function beginExam() {
    setTimeLeft(exam.duration * 60);
    setPhase("attempt");
  }

  function resetExam() {
    setExam(null);
    setPhase("list");
    setAnswers({});
    setReviewed([]);
    setCurrentQuestion(0);
  }

  const questions = exam?.questions || [];
  const activeQuestion = questions[currentQuestion];
  function isCorrect(question, answer) {
    if (question.type === "multiple") {
      const selected = Array.isArray(answer) ? [...answer].sort((a, b) => a - b) : [];
      const expected = [...question.answer].sort((a, b) => a - b);
      return selected.length === expected.length && selected.every((value, index) => value === expected[index]);
    }
    if (question.type === "integer") return String(answer ?? "").trim() === String(question.answer).trim();
    return answer === question.answer;
  }

  function toggleMultipleAnswer(optionIndex) {
    setAnswers((current) => {
      const selected = Array.isArray(current[currentQuestion]) ? current[currentQuestion] : [];
      const next = selected.includes(optionIndex) ? selected.filter((item) => item !== optionIndex) : [...selected, optionIndex];
      return { ...current, [currentQuestion]: next };
    });
  }

  function clearCurrentAnswer() {
    setAnswers((current) => {
      const next = { ...current };
      delete next[currentQuestion];
      return next;
    });
  }

  function correctAnswerLabel(question) {
    if (question.type === "integer") return question.answer;
    if (question.type === "multiple") return question.answer.map((index) => question.options[index]).join(", ");
    return question.options[question.answer];
  }

  const correctCount = questions.reduce((total, question, index) => total + (isCorrect(question, answers[index]) ? 1 : 0), 0);
  const score = correctCount * 5;
  const resultPercentage = questions.length ? Math.round((correctCount / questions.length) * 100) : 0;
  const weakTopics = questions.filter((question, index) => !isCorrect(question, answers[index])).map((question) => question.topic);
  const competitiveAnsweredCount = questions.filter((question, index) => {
    const answer = answers[index];
    return question.type === "multiple" ? Array.isArray(answer) && answer.length > 0 : String(answer ?? "").trim() !== "";
  }).length;

  if (phase === "list") {
    return <section className="competitive-view">
      <header className="competitive-heading"><div><span className="competitive-eyebrow">Competitive examinations</span><h2>Available Exams</h2><p>Attempt question papers uploaded by your faculty and receive an instant performance report.</p></div><div className="competitive-count"><strong>{COMPETITIVE_EXAMS.length}</strong><span>Available</span></div></header>
      <div className="competitive-exam-grid">{COMPETITIVE_EXAMS.map((item, index) => <article className="competitive-event-card" key={item.id}>
        <div className={`competitive-card-art tone-${(index % 4) + 1}`}><span>★</span><small>{item.level}</small></div>
        <div className="competitive-card-body"><div className="competitive-card-tags"><span>{item.subject}</span><span>MCQ</span></div><h3>{item.title}</h3><p>Question paper published for your class.</p><div className="competitive-card-meta"><span>{item.questions.length} Questions</span><span>{item.duration} Minutes</span></div><div className="competitive-card-foot"><span>Available until</span><strong>{item.availableUntil}</strong></div><button type="button" onClick={() => openExam(item)}>View &amp; Start Exam</button></div>
      </article>)}</div>
      <p className="competitive-preview-note">Preview data is shown for UI validation. Faculty-uploaded exams will replace it when the API is connected.</p>
    </section>;
  }

  if (phase === "instructions") {
    return <section className="competitive-view"><button className="competitive-back" type="button" onClick={resetExam}>← Back to exams</button><article className="competitive-notice-card">
      <div className="competitive-notice-banner"><span>MCQ</span><div><small>{exam.level}</small><h2>{exam.title}</h2><p>{exam.subject} competitive examination</p></div></div>
      <div className="competitive-facts"><div><span>Questions</span><strong>{questions.length}</strong></div><div><span>Duration</span><strong>{exam.duration} min</strong></div><div><span>Total Marks</span><strong>{exam.marks}</strong></div><div><span>Marks/Question</span><strong>5</strong></div><div><span>Question Type</span><strong>MCQ</strong></div><div><span>Result</span><strong>Instant</strong></div></div>
      <div className="competitive-instructions"><h3>Instructions</h3><ul><li>Select one answer for each question.</li><li>You can move between questions and mark them for review.</li><li>The exam will submit automatically when the timer ends.</li><li>Your result and AI-generated feedback will appear after submission.</li></ul></div>
      <label className="competitive-agreement"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /><span>I have read and understood the exam instructions.</span></label>
      <button className="primary-button" type="button" disabled={!agreed} onClick={beginExam}>Start Exam</button>
    </article></section>;
  }

  return <section className="competitive-view">
    <header className="competitive-attempt-head"><div><span>{exam.subject} • {exam.level}</span><h2>{exam.title}</h2></div><div className="competitive-timer"><span>{phase === "result" ? "Status" : "Time Left"}</span><strong>{phase === "result" ? "Completed" : formatMockTimer(timeLeft)}</strong></div></header>
    <div className="competitive-attempt-layout"><article className="module-card competitive-question-card">
      <div className="competitive-question-label"><span>Question {currentQuestion + 1} of {questions.length}</span><span>5 marks</span></div><h3>{activeQuestion.question}</h3>
      <span className="competitive-answer-type">{activeQuestion.type === "multiple" ? "Select all correct options" : activeQuestion.type === "integer" ? "Enter an integer answer" : "Select one correct option"}</span>
      {activeQuestion.type === "integer" ? <label className="competitive-integer-answer"><span>Your Answer</span><input type="number" step="1" value={answers[currentQuestion] ?? ""} disabled={phase === "result"} onChange={(event) => setAnswers((current) => ({ ...current, [currentQuestion]: event.target.value }))} placeholder="Enter numerical answer" /></label> : <div className="competitive-options">{activeQuestion.options.map((option, index) => {
        const selected = activeQuestion.type === "multiple" ? (answers[currentQuestion] || []).includes(index) : answers[currentQuestion] === index;
        const correct = phase === "result" && (activeQuestion.type === "multiple" ? activeQuestion.answer.includes(index) : activeQuestion.answer === index);
        const wrong = phase === "result" && selected && !correct;
        return <label className={`${selected ? "selected" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`} key={option}><input type={activeQuestion.type === "multiple" ? "checkbox" : "radio"} name={`competitive-${currentQuestion}`} checked={selected} disabled={phase === "result"} onChange={() => activeQuestion.type === "multiple" ? toggleMultipleAnswer(index) : setAnswers((current) => ({ ...current, [currentQuestion]: index }))} /><i>{String.fromCharCode(65 + index)}</i><span>{option}</span></label>;
      })}</div>}
      {phase === "result" && <div className={`competitive-feedback ${isCorrect(activeQuestion, answers[currentQuestion]) ? "correct" : "wrong"}`}>{isCorrect(activeQuestion, answers[currentQuestion]) ? "Correct answer." : `Correct answer: ${correctAnswerLabel(activeQuestion)}`}</div>}
      <div className="competitive-question-actions"><button className="soft-button" type="button" disabled={currentQuestion === 0} onClick={() => setCurrentQuestion((value) => value - 1)}>Previous</button>{phase === "attempt" && <><button className="soft-button" type="button" onClick={clearCurrentAnswer}>Clear Answer</button><button className="soft-button" type="button" onClick={() => setReviewed((items) => items.includes(currentQuestion) ? items.filter((item) => item !== currentQuestion) : [...items, currentQuestion])}>{reviewed.includes(currentQuestion) ? "Remove Review" : "Mark for Review"}</button></>}<button className="soft-button" type="button" disabled={currentQuestion === questions.length - 1} onClick={() => setCurrentQuestion((value) => value + 1)}>Next</button></div>
    </article><aside className="module-card competitive-palette"><h3>{phase === "result" ? "Exam Result" : "Question Palette"}</h3><div className="competitive-palette-grid">{questions.map((question, index) => <button className={`${answers[index] !== undefined ? "answered" : ""} ${reviewed.includes(index) ? "reviewed" : ""} ${currentQuestion === index ? "current" : ""}`} type="button" key={question.question} onClick={() => setCurrentQuestion(index)}>{index + 1}</button>)}</div>
      {phase === "attempt" ? <><div className="competitive-progress"><span>Answered <strong>{competitiveAnsweredCount}/{questions.length}</strong></span><span>Marked for review <strong>{reviewed.length}</strong></span><span>Unanswered <strong>{questions.length - competitiveAnsweredCount}</strong></span></div><button className="competitive-submit" type="button" onClick={() => setPhase("result")}>Submit Exam</button></> : <div className="competitive-result"><strong>{score}/{exam.marks}</strong><span>{resultPercentage}% Score</span><p>{resultPercentage >= 80 ? "Excellent performance!" : resultPercentage >= 60 ? "Good attempt. Keep practising." : "More practice will improve your score."}</p><div className="competitive-ai-summary"><b>AI Performance Insight</b><span>{weakTopics.length ? `Revise: ${[...new Set(weakTopics)].join(", ")}.` : "Strong performance across all assessed topics."}</span></div><button className="competitive-submit" type="button" onClick={resetExam}>Back to Exams</button></div>}
    </aside></div>
  </section>;
}

export default function AssessmentsPage() {
  const [activeOption, setActiveOption] = useState("mock-test");

  useEffect(() => {
    function applyRequestedView() {
      const requestedView = new URLSearchParams(window.location.search).get("view");
      if (["mock-test", "competitive-exams", "student-analysis", "teacher-remark"].includes(requestedView)) {
        setActiveOption(requestedView);
      }
    }

    applyRequestedView();
    window.addEventListener("popstate", applyRequestedView);
    return () => window.removeEventListener("popstate", applyRequestedView);
  }, []);

  return (
    <DashboardShell>
      <section className="module-page">
        <StudyTabs onAssessmentViewChange={setActiveOption} />
        <div className="module-content-area assessment-content-area">
          {activeOption === "mock-test" && <MockTestView />}
          {activeOption === "competitive-exams" && <CompetitiveExamView />}
          {activeOption === "student-analysis" && <StudentAnalysisView />}
          {activeOption === "teacher-remark" && <TeacherRemarkView />}
        </div>
      </section>
    </DashboardShell>
  );
}

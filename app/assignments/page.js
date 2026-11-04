"use client";

import { useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "../api-base-url";
import DashboardShell from "../dashboard-shell";
import { getLoggedInUserEmail } from "../login-session";
import StudyTabs from "../study-tabs";
import { filterAssignments, isCompleted, sortAssignments } from "./assignment-list.mjs";
import styles from "./assignment-list.module.css";

const API_BASE_URL = getApiBaseUrl();
const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png"
]);

function formatDate(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatFileSize(size) {
  if (!size) {
    return "-";
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.onerror = () => reject(new Error("Unable to read selected file."));
    reader.readAsDataURL(file);
  });
}

export default function AssignmentsPage() {
  const fileInputRef = useRef(null);
  const uploadCardRef = useRef(null);
  const [assignments, setAssignments] = useState([]);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState("materials");
  const [category, setCategory] = useState("pending");

  async function loadAssignments() {
    setLoading(true);
    setError("");

    try {
      const studentEmail = await getLoggedInUserEmail();
      const params = new URLSearchParams();
      if (studentEmail) params.set("email", studentEmail);
      const query = params.toString();
      const response = await fetch(`${API_BASE_URL}/assignments/current${query ? `?${query}` : ""}`, { credentials: "include", cache: "no-store" });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Unable to load assignments.");
      }

      const nextAssignments = sortAssignments(Array.isArray(data.assignments) ? data.assignments : []);
      const visible = filterAssignments(nextAssignments, category);
      setAssignments(nextAssignments);
      setSelectedAssignment((current) => {
        if (current) {
          return visible.find((assignment) => assignment.assignment_id === current.assignment_id) || visible[0] || null;
        }
        return visible[0] || null;
      });
    } catch (loadError) {
      setError(loadError.message || "Unable to load assignments.");
      setAssignments([]);
      setSelectedAssignment(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssignments();
  }, []);

  useEffect(() => {
    function applyRequestedView() {
      const requestedView = new URLSearchParams(window.location.search).get("view");
      if (["materials", "submit", "feedback"].includes(requestedView)) {
        setActiveView(requestedView);
      }
    }

    applyRequestedView();
    window.addEventListener("popstate", applyRequestedView);
    return () => window.removeEventListener("popstate", applyRequestedView);
  }, []);

  function selectAssignment(assignment) {
    setSelectedAssignment(assignment);
    setSelectedFile(null);
    setMessage("");
    setError("");
    window.setTimeout(() => uploadCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
  }

  function handleBrowseFiles() {
    fileInputRef.current?.click();
  }

  function validateAndSetFile(file) {
    if (!file) {
      return;
    }

    setMessage("");
    setError("");

    if (file.size > maxFileSize) {
      setError("File size must be 10 MB or less.");
      return;
    }

    if (file.type && !allowedTypes.has(file.type)) {
      setError("Only PDF, DOC, DOCX, JPG, and PNG files are supported.");
      return;
    }

    setSelectedFile(file);
  }

  function handleFileChange(event) {
    validateAndSetFile(event.target.files?.[0]);
  }

  function handleDrop(event) {
    event.preventDefault();
    validateAndSetFile(event.dataTransfer.files?.[0]);
  }

  async function handleSubmitAssignment() {
    if (!selectedAssignment) {
      setError("Please select an assignment.");
      return;
    }

    if (!selectedFile) {
      setError("Please choose a file before submitting.");
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const studentEmail = await getLoggedInUserEmail();
      const fileContentBase64 = await fileToBase64(selectedFile);
      const response = await fetch(`${API_BASE_URL}/assignments/submit`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          assignment_id: selectedAssignment.assignment_id,
          student_email: studentEmail,
          file_name: selectedFile.name,
          file_type: selectedFile.type || "application/octet-stream",
          file_size: selectedFile.size,
          file_content_base64: fileContentBase64
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Unable to submit assignment.");
      }

      setMessage("Assignment submitted successfully.");
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await loadAssignments();
    } catch (submitError) {
      setError(submitError.message || "Unable to submit assignment.");
    } finally {
      setSaving(false);
    }
  }

  const visibleAssignments = filterAssignments(assignments, category);
  const submittedAssignments = assignments.filter(isCompleted);
  const categories = [["pending", "Pending"], ["recent", "Recent (last 7 days)"], ["completed", "Completed"], ["all", "View All"]];

  function changeCategory(nextCategory) {
    setCategory(nextCategory);
    const visible = filterAssignments(assignments, nextCategory);
    setSelectedAssignment(current => visible.find(assignment => assignment.assignment_id === current?.assignment_id) || visible[0] || null);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setMessage("");
  }

  function changeView(view) {
    setActiveView(view);
    setMessage("");
    setError("");
  }

  function renderUploadCard() {
    return (
      <article className="module-card assignment-upload-card" ref={uploadCardRef}>
        <div className="card-title-row">
          <h2>{selectedAssignment?.assignment_title || "Select an assignment"}</h2>
          {selectedAssignment && (
            <span className={`status-pill ${(selectedAssignment.status || "Not Started").toLowerCase().replaceAll(" ", "-")}`}>
              {selectedAssignment.status || "Not Started"}
            </span>
          )}
        </div>
        <div className="meta-row">
          <span>Due Date: {formatDate(selectedAssignment?.due_date)}</span>
          <span>Assignment ID: {selectedAssignment?.assignment_id || "-"}</span>
        </div>
        {selectedAssignment?.assignment_text ? (
          <div className="assignment-question-block">
            <strong>Assignment Questions / Description</strong>
            <p>{selectedAssignment.assignment_text}</p>
          </div>
        ) : <p>Choose an assignment from the list to upload your work.</p>}
        <div className="upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={handleFileChange} hidden />
          <div className="upload-icon">Upload</div>
          <strong>Drag & drop your file here</strong>
          <span>or</span>
          <button className="soft-button" type="button" onClick={handleBrowseFiles} disabled={!selectedAssignment || saving}>Browse Files</button>
          <small>Supported formats: PDF, DOC, DOCX, JPG, PNG (Max 10 MB)</small>
        </div>
        <div className="submit-row">
          <div>
            <p>{selectedFile ? `Selected: ${selectedFile.name} (${formatFileSize(selectedFile.size)})` : selectedAssignment?.submitted_file_name ? `Uploaded: ${selectedAssignment.submitted_file_name}` : "No file uploaded yet"}</p>
            <p>Last submitted: {formatDateTime(selectedAssignment?.submitted_at)}</p>
          </div>
          <button className="primary-button" type="button" onClick={handleSubmitAssignment} disabled={!selectedAssignment || !selectedFile || saving}>
            {saving ? "Submitting..." : selectedAssignment?.submitted_at ? "Resubmit Assignment" : "Submit Assignment"}
          </button>
        </div>
      </article>
    );
  }

  return (
    <DashboardShell>
      <section className="module-page">
        <StudyTabs onAssignmentViewChange={changeView} />
        <div className="module-content-area">
          {error && <div className="tip-box red-action">{error}</div>}
          {message && <div className="download-message">{message}</div>}
          {activeView !== "feedback" && <>
            <div className={styles.filters} role="group" aria-label="Filter assignments">
              {categories.map(([value, label]) => <button key={value} type="button"
                aria-pressed={category === value} disabled={loading || saving}
                onClick={() => changeCategory(value)}>
                {label} <span>{filterAssignments(assignments, value).length}</span>
              </button>)}
            </div>
            <p className={styles.hint}>Newest assignments first. Pending includes overdue work and stays here until submitted.</p>
          </>}

          {activeView === "materials" && <>
          <div className="assignment-layout">
            <article className="module-card assignment-list-card">
              <div className="card-title-row">
                <h2>Assignment Materials</h2>
                <span className="status-pill">{visibleAssignments.length}</span>
              </div>
              <table className="data-table">
                <thead><tr><th>Assignment</th><th>Action</th></tr></thead>
                <tbody>
                  {visibleAssignments.flatMap((assignment) => {
                    const rows = assignment.attachments?.length ? assignment.attachments : [null];
                    return rows.map((attachment) => (
                    <tr key={attachment?.file_id || `assignment-${assignment.assignment_id}`}>
                      <td data-label="Assignment">{assignment.assignment_title}
                        <small className={styles.metadata}>Created: {formatDate(assignment.created_datetime)} · Due: {formatDate(assignment.due_date)} · {isCompleted(assignment) ? "Completed" : "Pending"}</small>
                      </td>
                      <td data-label="Action">
                        {attachment ? <a className="table-action" href={attachment.view_url} target="_blank" rel="noreferrer" onClick={() => selectAssignment(assignment)}>
                          {attachment.file_name?.toLowerCase().endsWith(".pdf") ? "View PDF" : "View File"}
                        </a> : <button className="table-action" type="button" onClick={() => selectAssignment(assignment)}>Open</button>}
                      </td>
                    </tr>
                  ));})}
                  {loading && <tr><td colSpan="2" role="status">Loading assignments…</td></tr>}
                  {!loading && visibleAssignments.length === 0 && <tr><td colSpan="2">No assignments in this category.</td></tr>}
                </tbody>
              </table>
              <div className="tip-box">Tip: Submit your assignments on time to get early feedback and improve your score!</div>
            </article>

            {renderUploadCard()}
          </div>

          </>}

          {activeView === "submit" && (
            <article className="module-card assignment-status-card">
              <div className="card-title-row"><h2>Assignment Submission Status</h2><span className="status-pill">{visibleAssignments.length}</span></div>
              <table className="data-table">
                <thead><tr><th>Assignment</th><th>Due Date</th><th>Status</th></tr></thead>
                <tbody>
                  {visibleAssignments.map((assignment) => {
                    const completed = isCompleted(assignment);
                    return (
                      <tr key={assignment.assignment_id}>
                        <td data-label="Assignment">{assignment.assignment_title}</td>
                        <td data-label="Due Date">{formatDate(assignment.due_date)}</td>
                        <td data-label="Status"><span className={`completion-status ${completed ? "completed" : "not-completed"}`}>{completed ? "Completed" : "Not Completed"}</span></td>
                      </tr>
                    );
                  })}
                  {loading && <tr><td colSpan="3" role="status">Loading assignments…</td></tr>}
                  {!loading && visibleAssignments.length === 0 && <tr><td colSpan="3">No assignments in this category.</td></tr>}
                </tbody>
              </table>
            </article>
          )}

          {activeView === "feedback" && (
            <article className="module-card assignment-feedback-card">
              <div className="card-title-row"><h2>Feedback &amp; Marks</h2><span className="status-pill">{submittedAssignments.length}</span></div>
              <table className="data-table">
                <thead><tr><th>Assignment</th><th>Submitted</th><th>Status</th><th>Marks</th><th>Feedback</th></tr></thead>
                <tbody>
                  {submittedAssignments.map((assignment) => {
                    const hasMarks = assignment.marks_obtained !== null && assignment.marks_obtained !== undefined;
                    return (
                      <tr key={assignment.assignment_id}>
                        <td data-label="Assignment">{assignment.assignment_title}</td>
                        <td data-label="Submitted">{formatDateTime(assignment.submitted_at)}</td>
                        <td data-label="Status">{assignment.status || "Submitted"}</td>
                        <td data-label="Marks">{hasMarks ? `${assignment.marks_obtained}${assignment.total_marks != null ? ` / ${assignment.total_marks}` : ""}` : "Not graded"}</td>
                        <td data-label="Feedback">{hasMarks ? "No teacher feedback added." : "Awaiting teacher review."}</td>
                      </tr>
                    );
                  })}
                  {!loading && submittedAssignments.length === 0 && <tr><td colSpan="5">No submitted assignments available.</td></tr>}
                </tbody>
              </table>
            </article>
          )}
        </div>
      </section>
    </DashboardShell>
  );
}

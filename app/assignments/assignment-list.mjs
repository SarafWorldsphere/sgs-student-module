const WEEK = 7 * 24 * 60 * 60 * 1000;

function createdTime(assignment) {
  const value = assignment.created_datetime;
  return value ? Date.parse(value) : NaN;
}

export function isCompleted(assignment) {
  return Boolean(assignment.submitted_at || assignment.submitted_file_name)
    || ["submitted", "completed", "graded", "evaluated"].includes(String(assignment.status || "").trim().toLowerCase());
}

export function sortAssignments(assignments) {
  return [...assignments].sort((a, b) => {
    const first = createdTime(a);
    const second = createdTime(b);
    if (Number.isFinite(first) && Number.isFinite(second) && first !== second) return second - first;
    if (Number.isFinite(first) !== Number.isFinite(second)) return Number.isFinite(first) ? -1 : 1;
    return Number(b.assignment_id) - Number(a.assignment_id);
  });
}

export function filterAssignments(assignments, category, now = Date.now()) {
  return assignments.filter(assignment => {
    if (category === "pending") return !isCompleted(assignment);
    if (category === "completed") return isCompleted(assignment);
    if (category === "recent") {
      const created = createdTime(assignment);
      return created >= now - WEEK && created <= now;
    }
    return true;
  });
}

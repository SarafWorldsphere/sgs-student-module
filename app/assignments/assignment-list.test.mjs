import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAssignments, isCompleted, sortAssignments } from './assignment-list.mjs';

const now = Date.parse('2026-11-02T12:00:00Z');
const rows = [
  { assignment_id: 99, created_datetime: '2026-10-01T12:00:00Z', due_date: '2026-10-02' },
  { assignment_id: 1, created_datetime: '2026-11-02T10:00:00Z', due_date: '2026-12-01' },
  { assignment_id: 2, created_datetime: '2026-11-01T12:00:00Z', submitted_at: '2026-11-02T10:00:00Z' },
  { assignment_id: 3, created_datetime: null, status: 'Graded', marks_obtained: 0 },
];

test('newest creation date wins over assignment ID and due date; input remains unchanged', () => {
  assert.deepEqual(sortAssignments(rows).map(a => a.assignment_id), [1, 2, 99, 3]);
  assert.equal(rows[0].assignment_id, 99);
});
test('missing and invalid creation dates sort last with deterministic ID ties', () => {
  const data = [{ assignment_id: 2 }, { assignment_id: 4, created_datetime: 'invalid' },
    { assignment_id: 1, created_datetime: '2026-11-01' }, { assignment_id: 3, created_datetime: '2026-11-01' }];
  assert.deepEqual(sortAssignments(data).map(a => a.assignment_id), [3, 1, 4, 2]);
});
test('pending includes old and overdue work without any recent cutoff', () => {
  assert.deepEqual(filterAssignments(rows, 'pending', now).map(a => a.assignment_id), [99, 1]);
});
test('submitted or graded records move to completed even with a zero grade', () => {
  assert.deepEqual(filterAssignments(rows, 'completed', now).map(a => a.assignment_id), [2, 3]);
  assert.equal(isCompleted({ submitted_file_name: 'answer.pdf' }), true);
  assert.equal(isCompleted({ status: 'In Progress', marks_obtained: null }), false);
});
test('recent uses creation time, includes exact seven-day boundary and excludes future/unknown dates', () => {
  const data = [...rows, { assignment_id: 5, created_datetime: '2026-10-26T12:00:00Z' },
    { assignment_id: 6, created_datetime: '2026-10-26T11:59:59Z' },
    { assignment_id: 7, created_datetime: '2026-11-03T12:00:00Z' }];
  assert.deepEqual(filterAssignments(data, 'recent', now).map(a => a.assignment_id), [1, 2, 5]);
});
test('submission moves a pending assignment to completed; View All keeps every record', () => {
  const updated = rows.map(a => a.assignment_id === 99 ? { ...a, submitted_at: '2026-11-02T12:00:00Z' } : a);
  assert.deepEqual(filterAssignments(updated, 'pending', now).map(a => a.assignment_id), [1]);
  assert.equal(filterAssignments(updated, 'completed', now).length, 3);
  assert.equal(filterAssignments(updated, 'all', now).length, rows.length);
});

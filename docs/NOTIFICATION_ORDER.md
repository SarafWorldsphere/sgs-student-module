# Student notifications: newest first

The bell and Latest Updates popup both use GET /notifications. Previously this
API concatenated assignment alerts, notices and results in that order, with no
cross-type sort. A newly published notice/result could appear below old work.

The shared response now sorts all notification types by created_at descending:

- Assignment alerts: assignment_master.created_datetime.
- Notices: notice_board.created_datetime.
- Result alerts: assessment_results.created_at (publication of that student's
  result, rather than the assessment date).

Source queries sort by these timestamps before applying their existing limits.
Due-date urgency, read markers, counts, student/class filters and eligibility
windows are preserved. Missing timestamps sort last; due dates are never used
as creation dates. Equal timestamps retain stable source/ID order.

No frontend duplication is needed because both notification components consume
the shared API order. SaaS uses the existing tenant-bound pool and canonical
unprefixed tables. No schema migration or data update is needed.

Run `python -m unittest discover -s backend/tests -p test_notification_order.py -v`
from the repository root. Browser/staging verification is still pending.

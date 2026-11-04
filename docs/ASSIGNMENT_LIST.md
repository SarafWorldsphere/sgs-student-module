# Student assignment list

Staging/main change on local branch `fix/assignment-list-order-and-filters`.

`GET /assignments/current` now returns `created_datetime` from
`sgs_assignment_master` and sorts by that timestamp descending, nulls last,
then assignment ID descending. Existing class/student scoping is preserved;
there is no due-date cutoff that could hide overdue pending work.

The Materials and Submission Status lists use these filters:

- Pending (default): not submitted, including old and overdue assignments.
- Recent: created within the last rolling seven days, including submitted work.
- Completed: has a submitted timestamp/file or a Submitted/Completed/Graded/
  Evaluated result status.
- View All: all assignments, newest creation first.

Missing/invalid creation dates are excluded from Recent, placed last in sorted
lists, and remain visible under Pending/Completed and View All as appropriate.
Zero marks do not make a graded assignment pending.

Submission refreshes the server list and updates the counts and pending
selection. Feedback & Marks continues to show submitted work independently.
Assignment date and due date are displayed in the Materials list.

Verification commands:

```powershell
node --test app/assignments/assignment-list.test.mjs
python -m unittest discover -s backend/tests -p test_assignment_list.py -v
npm run build
```

No new schema, school data writes, SaaS changes, remote push or deployment are
part of this change. Browser testing with a logged-in student is still pending.

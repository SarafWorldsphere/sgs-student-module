# Learning path: academic marks and readable content

This staging/main feature fixes dark labels and generated list text that blended
into dark cards. Labels, generated steps and selected-track text now use explicit
contrast scoped to the learning-path page.

## Approved classification rule

The five categories are **PT1, PT2, weekly test, quiz, assignment**. Convert each
graded result to a percentage, average within its category, then take an equal-
weight average of the available category percentages:

- Below 50%: Slow Reader material.
- 50% to below 75%: Average Reader material.
- 75% and above: Fast Reader material.

These labels choose a study-material track; they are not measurements of reading
speed. Retry counts and the previous combined unit-test average do not affect the
new classification. Missing marks are `null`/Not graded, not zero. A recorded zero
is included. No graded categories means no classification and no AI call (409).

For example, PT1 80%, PT2 70%, weekly 60%, quiz 80% and assignment 50% produce
68% / Average Reader. If only quiz 80% is graded, the score is 80%, not 16%.

## Sources and grading scales

Table names and thresholds live in `backend/performance_config.json`; restart the
backend after changing configuration. SQL identifiers are validated and quoted.

PT1/PT2/weekly category source precedence:

1. Explicit `pt1`, `pt2`, `weekly_test` columns in student marks, **only if their
   category's maximum marks have been explicitly configured**.
2. Student marks linked to labelled PT1/PT2/weekly exams, using that row's recorded
   `max_marks`.
3. Labelled assessment results, using their stored percentage or marks/max marks.

Direct component maxima initially remain `null` because the school has not yet
confirmed their scale. Set `direct_component_maxima` for the real school scale;
e.g. an out-of-20 component uses 20, and an already-percentage column uses 100.
The code does not assume a small percentage is a mark out of 20. Unconfigured
direct component values produce a visible grading-scale notice and are not used
to invent scores. Named exam results with recorded denominators still work.

PT1/PT2 labels accept variants such as PT-1, PT 1 and Periodic Test 2. Generic unit,
half-yearly, quarterly or annual tests are not guessed to be weekly/PT results.

Assignments prefer graded assignment results, falling back to explicitly typed
assignment assessments only if no graded result is available. Quizzes prefer
completed quiz results, falling back to typed quiz assessments. These sources
are not combined twice. Inactive rows, absent assessments, incomplete quizzes,
invalid percentages and marks without a usable maximum are excluded.

## API and generation consistency

`GET /student-performance-summary?student_id=...` now includes the five category
percentages, `overall_score`, classification, available categories, counts and
the calculation rule. The frontend displays all five marks and the overall score.

`POST /learning-path/generate-overall` needs only `student_id`. It rereads marks
from the database instead of trusting percentages posted by the browser. Study
content generation also uses that same server-calculated classification; a stale
classification supplied by a client does not override it. Responses include the
fresh `performance` object so the UI stays consistent.

AI prompts distinguish missing grades from failed assignments and forbid invented
claims about retry counts, attendance, time management or measured reading speed.
The older reading-time/comprehension profile flow remains available separately.

## Verification

All 36 backend tests passed, including local PostgreSQL tests for real data
filtering, denominator normalization, all five categories and connection pooling.
Production Next.js build passed. No real AI-provider requests or live database
writes were needed. Visual review and deployed integration testing remain separate.

```bash
python -B -m unittest discover -s backend/tests -v
npm run build
```

Optional real SQL tests require `PERFORMANCE_TEST_DATABASE_URL` to point to a
local disposable database named `student_learning_path_test`. Fixture tables are
connection-local temporary tables; remote hosts are rejected.

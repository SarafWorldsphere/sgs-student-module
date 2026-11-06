"""Mixed notifications must be newest-first, not grouped by notification type."""
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from notification_order import newest_notifications
import main


class NotificationOrderTests(unittest.TestCase):
    def test_mixed_types_follow_creation_time_not_due_date_or_priority(self):
        items = [dict(id='assignment-1', created_at='2026-10-01T10:00:00', due_date='2027-01-01', priority='high'),
                 dict(id='notice-1', created_at='2026-11-05T10:00:00', priority='low'),
                 dict(id='result-1', created_at='2026-11-06T10:00:00', assessment_date='2026-01-01')]
        self.assertEqual([i['id'] for i in newest_notifications(items)], ['result-1', 'notice-1', 'assignment-1'])
        self.assertEqual(items[0]['id'], 'assignment-1')

    def test_naive_and_offset_timestamps_are_compared_consistently(self):
        items = [dict(id='a', created_at=datetime(2026, 11, 6, 8)),
                 dict(id='b', created_at='2026-11-06T14:00:00+05:30'),
                 dict(id='c', created_at=datetime(2026, 11, 6, 9, tzinfo=timezone.utc))]
        self.assertEqual([i['id'] for i in newest_notifications(items)], ['c', 'b', 'a'])

    def test_missing_invalid_dates_go_last_and_ties_keep_source_order(self):
        items = [dict(id='missing'), dict(id='invalid', created_at='bad'),
                 dict(id='a', created_at='2026-11-06T08:00:00Z'),
                 dict(id='b', created_at='2026-11-06T08:00:00Z')]
        self.assertEqual([i['id'] for i in newest_notifications(items)], ['a', 'b', 'missing', 'invalid'])


class NotificationApiOrderTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_api_sorts_across_groups_and_preserves_unread_counts(self):
        cursor = AsyncMock()
        cursor.fetchone.return_value = dict(student_id=1, class_id=8, class_name='8th', student_email='student@example.com')
        cursor.fetchall.side_effect = [
            [dict(assignment_id=1, assignment_title='Older urgent work', due_date=date(2026, 1, 1), created_datetime=datetime(2026, 10, 1))],
            [dict(notice_id=1, notice_title='New notice', created_datetime=datetime(2026, 11, 5), is_read=False)],
            [dict(assessment_id=1, title='Latest result', result_created_at=datetime(2026, 11, 6), marks_obtained=0, max_marks=10)],
            [dict(notification_type='notice', source_id=1)],
        ]

        @asynccontextmanager
        async def connection():
            class Connection:
                @asynccontextmanager
                async def cursor(self, **kwargs):
                    yield cursor
            yield Connection()

        async def keep_alerts(items, _email):
            return items

        with patch.object(main, 'get_connection', connection), patch.object(main, 'apply_ai_assignment_messages', keep_alerts):
            result = await main.get_notifications('student@example.com')
        self.assertEqual([i['id'] for i in result['notifications']], ['result-1', 'notice-1', 'assignment-1'])
        self.assertEqual(result['count'], 2)
        self.assertTrue(result['notifications'][1]['is_read'])
        self.assertEqual(result['assignments'][0]['created_at'], datetime(2026, 10, 1))
        self.assertEqual(result['results'][0]['message'], 'Score: 0 / 10')


if __name__ == '__main__':
    unittest.main()

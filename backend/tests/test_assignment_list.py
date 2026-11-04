"""Assignment response regression tests; no database, S3 or AI calls."""
from contextlib import asynccontextmanager
from datetime import datetime
import unittest
from pathlib import Path
import sys
from unittest.mock import AsyncMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main


class AssignmentListTests(unittest.IsolatedAsyncioTestCase):
    async def test_created_date_and_old_pending_records_are_preserved(self):
        rows = [dict(assignment_id=1, created_datetime=datetime(2026, 11, 2), submission_status='Graded'),
                dict(assignment_id=2, created_datetime=datetime(2025, 1, 1), submission_status='Not Started')]
        cursor = AsyncMock()
        cursor.fetchall.side_effect = [rows, []]

        @asynccontextmanager
        async def connection():
            class Connection:
                @asynccontextmanager
                async def cursor(self, **kwargs):
                    yield cursor
            yield Connection()

        with patch.object(main, 'get_connection', connection), patch.object(main, 'fetch_student_with_class',
                AsyncMock(return_value=dict(student_id=7, class_id=8))):
            data = await main.get_current_assignments(email='student@example.com')
        self.assertEqual(len(data['assignments']), 2)
        self.assertEqual(data['assignments'][0]['created_datetime'], datetime(2026, 11, 2))
        self.assertEqual(data['assignments'][0]['status'], 'Submitted')
        self.assertEqual(data['assignments'][1]['status'], 'Not Started')
        self.assertEqual(data['assignments'][1]['created_datetime'], datetime(2025, 1, 1))


if __name__ == '__main__':
    unittest.main()

"""Actual chapter selection SQL against temporary local fixtures, never staging."""
import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import psycopg
from psycopg.conninfo import conninfo_to_dict
import main

URL = os.getenv('CHAPTER_PDF_TEST_DATABASE_URL', '')
if URL and sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


@unittest.skipUnless(URL, 'Set CHAPTER_PDF_TEST_DATABASE_URL to local student_timetable_test')
class ChapterPdfSelectionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        details = conninfo_to_dict(URL)
        if details.get('host') not in ('localhost', '127.0.0.1') or details.get('dbname') != 'student_timetable_test':
            raise RuntimeError('Chapter SQL fixtures require local student_timetable_test')
        self.db = await psycopg.AsyncConnection.connect(URL)
        await self.db.execute('''
            CREATE TEMP TABLE sgs_chapter_master (chapter_id bigint, chapter_no int);
            CREATE TEMP TABLE sgs_chapter_content (chapter_content_id bigint, chapter_id bigint,
                class_id bigint, subject_id bigint, content_title text, full_text_content text,
                content_format text, is_active bool, record_status text);
            CREATE TEMP TABLE sgs_file_storage_metadata (file_id bigint, entity_id bigint,
                entity_type text, file_name text, file_url text, created_at timestamp, record_status text);
            INSERT INTO sgs_chapter_master VALUES (40,4),(41,5);
            INSERT INTO sgs_chapter_content VALUES
                (25,40,18,26,'Chapter 4','Actual chapter text',NULL,true,'Active'),
                (26,41,18,26,'Image only',NULL,NULL,true,'Active');
            INSERT INTO sgs_file_storage_metadata VALUES
                (4,40,'CHAPTER_STUDY_MATERIAL','Chapter 4.pdf','s3://bucket/chapter-40.pdf','2026-07-29','Active'),
                (25,40,'CHAPTER_STUDY_MATERIAL','Admin screenshot.png','s3://bucket/admin.png','2026-11-06','Active'),
                (26,40,'CHAPTER_STUDY_MATERIAL','Inactive.pdf','s3://bucket/inactive.pdf','2026-11-07','Inactive'),
                (27,41,'CHAPTER_STUDY_MATERIAL','Other screenshot.png','s3://bucket/other.png','2026-11-08','Active');
        ''')

        @asynccontextmanager
        async def connection():
            yield self.db

        self.patches = [patch.object(main, 'get_connection', connection),
                        patch.object(main, 'fetch_student_with_class', AsyncMock(return_value={'class_id':18})),
                        patch.object(main, 'create_material_urls', return_value=('https://example.test/chapter.pdf', 'https://example.test/download.pdf'))]
        for p in self.patches:
            p.start()

    async def asyncTearDown(self):
        for p in reversed(self.patches):
            p.stop()
        await self.db.close()

    async def test_older_pdf_wins_over_newer_screenshot_and_inactive_pdf(self):
        row = await main.get_chapter_content(chapter_content_id=25, email='student@example.com')
        self.assertEqual(row['pdf_url'], 's3://bucket/chapter-40.pdf')
        self.assertEqual(row['file_name'], 'Chapter 4.pdf')
        self.assertIn('view_url', row)
        main.create_material_urls.assert_called_once_with('s3://bucket/chapter-40.pdf', 'Chapter 4.pdf')
        rows = await (await self.db.execute('SELECT count(*) FROM sgs_file_storage_metadata')).fetchone()
        self.assertEqual(rows[0], 4)

    async def test_no_pdf_uses_existing_text_and_hides_image_only_chapter(self):
        await self.db.execute('DELETE FROM sgs_file_storage_metadata WHERE file_id=4')
        row = await main.get_chapter_content(chapter_content_id=25, email='student@example.com')
        self.assertIsNone(row['pdf_url'])
        self.assertNotIn('view_url', row)
        self.assertEqual(row['full_text_content'], 'Actual chapter text')
        result = await main.get_chapter_content_list(class_id=18, subject_id=26, email='student@example.com')
        self.assertEqual([c['chapter_content_id'] for c in result['chapters']], [25])
        main.create_material_urls.assert_not_called()

    async def test_pdf_without_filename_uses_url_extension_and_newest_pdf(self):
        await self.db.execute("INSERT INTO sgs_file_storage_metadata VALUES (28,40,'CHAPTER_STUDY_MATERIAL',NULL,'s3://bucket/latest.PDF','2026-11-09','Active')")
        row = await main.get_chapter_content(chapter_content_id=25, email='student@example.com')
        self.assertEqual(row['pdf_url'], 's3://bucket/latest.PDF')
        main.create_material_urls.assert_called_once_with('s3://bucket/latest.PDF', 'Chapter 4.pdf')

"""Sort mixed notification types by publication time, without changing their data."""
from datetime import datetime, timezone


def publication_time(item):
    value = item.get('created_at')
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return float('-inf')
    if not isinstance(value, datetime):
        return float('-inf')
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.timestamp()


def newest_notifications(items):
    # Python's stable sort preserves deterministic source/ID order for ties.
    return sorted(items, key=publication_time, reverse=True)

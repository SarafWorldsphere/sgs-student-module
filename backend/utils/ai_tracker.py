import logging
from typing import Any, Mapping

import psycopg
from psycopg_pool import PoolTimeout

from database import database_connection
from settings import get_settings


logger = logging.getLogger(__name__)


def extract_token_usage(response: Mapping[str, Any] | None) -> tuple[int, int, int]:
    """Return prompt, completion, and total tokens from supported AI responses."""
    if not response:
        return 0, 0, 0

    usage = response.get("usageMetadata") or response.get("usage_metadata") or response.get("usage") or {}
    prompt_tokens = int(
        usage.get("promptTokenCount")
        or usage.get("prompt_tokens")
        or usage.get("input_tokens")
        or 0
    )
    completion_tokens = int(
        usage.get("candidatesTokenCount")
        or usage.get("completion_tokens")
        or usage.get("output_tokens")
        or 0
    )
    total_tokens = int(
        usage.get("totalTokenCount")
        or usage.get("total_tokens")
        or (prompt_tokens + completion_tokens)
    )
    return prompt_tokens, completion_tokens, total_tokens


async def log_ai_usage(
    *,
    module_name: str,
    feature_used: str,
    user_email: str | None = None,
    response: Mapping[str, Any] | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    total_tokens: int | None = None,
) -> bool:
    """Write one usage row without allowing analytics failures to break the AI feature."""
    extracted_prompt, extracted_completion, extracted_total = extract_token_usage(response)
    prompt_count = max(0, int(prompt_tokens if prompt_tokens is not None else extracted_prompt))
    completion_count = max(
        0,
        int(completion_tokens if completion_tokens is not None else extracted_completion),
    )
    total_count = max(
        0,
        int(total_tokens if total_tokens is not None else extracted_total or prompt_count + completion_count),
    )

    try:
        settings = get_settings()
        async with database_connection() as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(
                    """
                    INSERT INTO ai_usage_logs (
                        client_name,
                        user_email,
                        module_name,
                        feature_used,
                        prompt_tokens,
                        completion_tokens,
                        total_tokens
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s);
                    """,
                    (
                        settings.client_name.strip(),
                        (user_email or "").strip() or None,
                        module_name.strip(),
                        feature_used.strip(),
                        prompt_count,
                        completion_count,
                        total_count,
                    ),
                )
            await connection.commit()
        return True
    except (psycopg.Error, PoolTimeout, RuntimeError, ValueError, TypeError) as error:
        logger.warning("Unable to write ai_usage_logs: %s", error)
        return False

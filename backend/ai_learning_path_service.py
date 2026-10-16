from starlette.concurrency import run_in_threadpool
import json
import os
from urllib.parse import quote
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from typing import Any

from utils.ai_tracker import log_ai_usage


TRACKS = {
    "Fast Reader": {
        "title": "Fast Reader Material",
        "summary": "Short, challenge-focused material for students who read quickly and score strongly.",
        "steps": [
            "Read the chapter summary and mark unfamiliar terms.",
            "Attempt higher-order questions before reviewing notes.",
            "Create a one-page revision map for the chapter.",
            "Take a timed quiz and move to enrichment practice.",
        ],
    },
    "Average Reader": {
        "title": "Average Reader Material",
        "summary": "Balanced explanations, guided practice, and review checkpoints.",
        "steps": [
            "Read the chapter in two focused sections.",
            "Write three key points after each section.",
            "Review solved examples or teacher notes.",
            "Attempt the quiz, revise weak areas, then retry missed questions.",
        ],
    },
    "Slow Reader": {
        "title": "Slow Reader Material",
        "summary": "Step-by-step material with smaller reading blocks and extra comprehension support.",
        "steps": [
            "Read one small section at a time with audio support if needed.",
            "Underline keywords and write their meanings.",
            "Use short recap notes before each quiz attempt.",
            "Practice easier questions first, then retry with teacher/AI hints.",
        ],
    },
}


def classify_reader(
    reading_time_minutes: int,
    quiz_score: int,
    retry_count: int,
    comprehension_score: int,
) -> str:
    """Classify the learner using transparent rules until a real model is connected."""
    score = 0

    if reading_time_minutes <= 20:
        score += 2
    elif reading_time_minutes <= 40:
        score += 1

    if quiz_score >= 85:
        score += 2
    elif quiz_score >= 60:
        score += 1

    if comprehension_score >= 85:
        score += 2
    elif comprehension_score >= 60:
        score += 1

    if retry_count == 0:
        score += 1
    elif retry_count >= 3:
        score -= 1

    if score >= 5:
        return "Fast Reader"
    if score >= 3:
        return "Average Reader"
    return "Slow Reader"


def classify_performance(
    assignment_marks: int | float,
    quiz_score: int | float,
    unit_test_marks: int | float,
    retry_count: int,
) -> str:
    """Classify the learner from overall academic performance metrics."""
    score = 0

    if assignment_marks >= 85:
        score += 2
    elif assignment_marks >= 60:
        score += 1

    if quiz_score >= 85:
        score += 2
    elif quiz_score >= 60:
        score += 1

    if unit_test_marks >= 85:
        score += 2
    elif unit_test_marks >= 60:
        score += 1

    if retry_count <= 1:
        score += 1
    elif retry_count >= 3:
        score -= 1

    if score >= 5:
        return "Fast Reader"
    if score >= 3:
        return "Average Reader"
    return "Slow Reader"


class MockLearningPathLLM:
    """Deterministic fallback used only when no real AI provider is configured."""

    provider_name = "mock-free-llm"

    async def generate_path(
        self,
        chapter_title: str,
        classification: str,
        metrics: dict[str, int],
        user_email: str | None = None,
    ) -> dict[str, Any]:
        track = TRACKS[classification]
        focus = _focus_area(metrics)

        return {
            "provider": self.provider_name,
            "chapter_title": chapter_title,
            "classification": classification,
            "track_title": track["title"],
            "summary": track["summary"],
            "focus_area": focus,
            "steps": track["steps"],
            "recommended_materials": [
                f"{track['title']} - {chapter_title} reading notes",
                f"{chapter_title} recap worksheet",
                f"{chapter_title} adaptive quiz practice",
            ],
        }


class DeepSeekLearningPathLLM:
    """DeepSeek adapter using the OpenAI-compatible /chat/completions API."""

    provider_name = "deepseek"

    def __init__(self):
        self.api_key = os.getenv("DEEPSEEK_API_KEY")
        self.base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
        self.model = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")

    async def generate_path(
        self,
        chapter_title: str,
        classification: str,
        metrics: dict[str, int],
        user_email: str | None = None,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("DEEPSEEK_API_KEY is not configured.")

        prompt = {
            "chapter_title": chapter_title,
            "classification": classification,
            "metrics": metrics,
            "required_json_shape": {
                "summary": "short learner-friendly summary",
                "focus_area": "main improvement area",
                "steps": ["4 to 6 concrete study steps"],
                "recommended_materials": ["3 recommended materials"],
            },
        }
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You create personalized school study paths. "
                        "Return only valid JSON with keys: summary, focus_area, steps, recommended_materials."
                    ),
                },
                {"role": "user", "content": json.dumps(prompt)},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": 900,
            "temperature": 0.4,
        }

        try:
            response = await run_in_threadpool(self._post_chat_completion, payload)
            content = response["choices"][0]["message"]["content"]
            ai_path = json.loads(content)
            await log_ai_usage(
                module_name="AI Learning Path",
                feature_used="Learning Path Generation",
                user_email=user_email,
                response=response,
            )
        except HTTPError as error:
            raise RuntimeError(_deepseek_http_error_message(error)) from error
        except URLError as error:
            raise RuntimeError(f"DeepSeek connection failed: {error.reason}") from error
        except (KeyError, IndexError, json.JSONDecodeError) as error:
            raise RuntimeError("DeepSeek returned an invalid learning path response.") from error

        track = TRACKS[classification]

        return {
            "provider": self.provider_name,
            "chapter_title": chapter_title,
            "classification": classification,
            "track_title": track["title"],
            "summary": ai_path.get("summary") or track["summary"],
            "focus_area": ai_path.get("focus_area") or _focus_area(metrics),
            "steps": _list_or_default(ai_path.get("steps"), track["steps"]),
            "recommended_materials": _list_or_default(
                ai_path.get("recommended_materials"),
                [
                    f"{track['title']} - {chapter_title} reading notes",
                    f"{chapter_title} recap worksheet",
                    f"{chapter_title} adaptive quiz practice",
                ],
            ),
        }

    def _post_chat_completion(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        with urlopen(request, timeout=25) as response:
            return json.loads(response.read().decode("utf-8"))


class GeminiLearningPathLLM:
    """Gemini adapter using Google AI Studio's generateContent REST API."""

    provider_name = "gemini"

    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        self.base_url = os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com").rstrip("/")
        self.model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    async def generate_path(
        self,
        chapter_title: str,
        classification: str,
        metrics: dict[str, int],
        user_email: str | None = None,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured.")

        prompt = {
            "chapter_title": chapter_title,
            "classification": classification,
            "metrics": metrics,
            "instructions": "Return concise JSON only: summary, focus_area, steps, recommended_materials.",
        }
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": json.dumps(prompt)}],
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.4,
                "maxOutputTokens": 2048,
            },
        }

        try:
            response = await run_in_threadpool(self._generate_content, payload)
            content = _gemini_text(response)
            ai_path = _loads_json_object(content)
            await log_ai_usage(
                module_name="AI Learning Path",
                feature_used="Learning Path Generation",
                user_email=user_email,
                response=response,
            )
        except HTTPError as error:
            raise RuntimeError(_gemini_http_error_message(error)) from error
        except URLError as error:
            raise RuntimeError(f"Gemini connection failed: {error.reason}") from error
        except (KeyError, IndexError, json.JSONDecodeError) as error:
            raise RuntimeError("Gemini returned an invalid learning path response.") from error

        track = TRACKS[classification]

        return {
            "provider": self.provider_name,
            "chapter_title": chapter_title,
            "classification": classification,
            "track_title": track["title"],
            "summary": ai_path.get("summary") or track["summary"],
            "focus_area": ai_path.get("focus_area") or _focus_area(metrics),
            "steps": _list_or_default(ai_path.get("steps"), track["steps"]),
            "recommended_materials": _list_or_default(
                ai_path.get("recommended_materials"),
                [
                    f"{track['title']} - {chapter_title} reading notes",
                    f"{chapter_title} recap worksheet",
                    f"{chapter_title} adaptive quiz practice",
                ],
            ),
        }

    def _generate_content(self, payload: dict[str, Any]) -> dict[str, Any]:
        model = quote(self.model, safe="")
        request = Request(
            f"{self.base_url}/v1beta/models/{model}:generateContent?key={self.api_key}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urlopen(request, timeout=25) as response:
            return json.loads(response.read().decode("utf-8"))


def _deepseek_http_error_message(error: HTTPError) -> str:
    try:
        body = json.loads(error.read().decode("utf-8"))
        message = body.get("error", {}).get("message")
    except (json.JSONDecodeError, UnicodeDecodeError):
        message = None

    if message:
        return f"DeepSeek API error {error.code}: {message}"

    return f"DeepSeek API error {error.code}."


def _gemini_http_error_message(error: HTTPError) -> str:
    try:
        body = json.loads(error.read().decode("utf-8"))
        message = body.get("error", {}).get("message")
    except (json.JSONDecodeError, UnicodeDecodeError):
        message = None

    if message:
        return f"Gemini API error {error.code}: {message}"

    return f"Gemini API error {error.code}."


def _gemini_text(response: dict[str, Any]) -> str:
    parts = response["candidates"][0]["content"]["parts"]
    return "\n".join(part.get("text", "") for part in parts).strip()


def _loads_json_object(content: str) -> dict[str, Any]:
    cleaned = content.strip()

    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        parsed = json.loads(cleaned[start : end + 1])

    if not isinstance(parsed, dict):
        raise json.JSONDecodeError("Expected a JSON object.", cleaned, 0)

    return parsed


def _list_or_default(value: Any, default: list[str]) -> list[str]:
    if isinstance(value, list):
        cleaned = [str(item).strip() for item in value if str(item).strip()]
        if cleaned:
            return cleaned

    return default


def _focus_area(metrics: dict[str, int]) -> str:
    if "assignment_marks" in metrics or "unit_test_marks" in metrics:
        assignment_marks = metrics.get("assignment_marks", 0)
        quiz_score = metrics.get("quiz_score", 0)
        unit_test_marks = metrics.get("unit_test_marks", 0)
        retry_count = metrics.get("retry_count", 0)

        if unit_test_marks < 60:
            return "Strengthen core exam readiness with guided revision and frequent checkpoints."
        if quiz_score < 60:
            return "Improve quick recall and quiz accuracy through targeted practice."
        if assignment_marks < 60:
            return "Build consistency in assignment completion and concept application."
        if retry_count >= 3:
            return "Reduce repeated attempts with focused review before practice."
        return "Maintain strong performance with challenge practice and periodic revision."

    if metrics["comprehension_score"] < 60:
        return "Build comprehension through smaller reading blocks and recap questions."
    if metrics["quiz_score"] < 60:
        return "Improve quiz accuracy by revising mistakes before retrying."
    if metrics["retry_count"] >= 3:
        return "Reduce repeated attempts with guided review after each quiz."
    return "Maintain pace and deepen understanding with challenge practice."


def get_learning_path_generator() -> MockLearningPathLLM:
    configured_provider = os.getenv("AI_PROVIDER", "").strip().lower()
    provider = configured_provider or ("gemini" if os.getenv("GEMINI_API_KEY") else "mock")

    if provider in {"gemini", "geminai", "google", "google-gemini"}:
        return GeminiLearningPathLLM()

    if provider == "deepseek":
        return DeepSeekLearningPathLLM()

    return MockLearningPathLLM()

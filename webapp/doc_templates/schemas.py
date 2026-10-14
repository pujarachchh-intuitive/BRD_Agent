"""Template content format, request bodies, and the content checks every save goes through.

A template's content (stored as JSON on each document_template_versions row) is:

    {
      "domain_guidance": "...",          # plain text for the gap-filler; never shown as form values
      "questions": [{"key", "text", "default"}],   # applicability questions, e.g. "Handles PHI?"
      "items": {"<form field>": [{"key", "values", "tag", "source", "source_url", "applies_if"}]}
    }

Item `values` use the field's subfield names (list_obj fields) or {"text": ...} (list_str fields).
Item keys are stable across versions, so what users did with an item can be compared over time.
"""

import re
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from brd_agent_suite.schema import FunctionalRequirement, NonFunctionalRequirement, Risk, Stakeholder

# list_obj fields a template may seed -> the schema model its rows must satisfy. Identity and
# project-specific fields (project_name, problem_statement, objectives, scope, timeline, ...) are
# deliberately absent: no template can know those.
_LIST_OBJ_MODELS: dict[str, type[BaseModel]] = {
    "stakeholders": Stakeholder,
    "functional_requirements": FunctionalRequirement,
    "non_functional_requirements": NonFunctionalRequirement,
    "risks": Risk,
}
_LIST_STR_FIELDS = ("constraints", "dependencies", "integrations", "open_questions")

# The `id` subfield is server-assigned (webapp/service.py's _assign_ids), never template content.
SEEDABLE_FIELDS: dict[str, list[str]] = {
    **{name: [f for f in model.model_fields if f != "id"] for name, model in _LIST_OBJ_MODELS.items()},
    **{name: ["text"] for name in _LIST_STR_FIELDS},
}

ICONS = (
    "health", "finance", "insurance", "pharma", "government", "retail", "education", "factory",
    "telecom", "energy", "logistics", "media", "hospitality", "realestate", "technology", "generic",
)

MAX_ITEMS_PER_FIELD = 40
MAX_VALUE_LENGTH = 600
_ITEM_KEY = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}$")
_QUESTION_KEY = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_SLUG = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _no_braces(value: str, where: str) -> str:
    # Template text reaches an ADK instruction, where {name} is read as a session-state placeholder.
    if "{" in value or "}" in value:
        raise ValueError(f"{where} must not contain curly braces")
    return value


class TemplateQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    text: str = Field(min_length=1, max_length=200)
    default: bool = False

    @field_validator("key")
    @classmethod
    def _key(cls, value: str) -> str:
        if not _QUESTION_KEY.match(value):
            raise ValueError("question key must be lowercase letters, digits or underscores (max 40)")
        return value

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return _no_braces(value.strip(), "Question text")


class TemplateItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str
    values: dict[str, str]
    tag: Literal["regulatory", "best_practice"]
    source: str = Field(default="", max_length=300)
    source_url: Optional[str] = Field(default=None, max_length=500)
    applies_if: Optional[str] = None

    @field_validator("key")
    @classmethod
    def _key(cls, value: str) -> str:
        if not _ITEM_KEY.match(value):
            raise ValueError(f"item key '{value}' must be lowercase letters, digits or hyphens (max 60)")
        return value

    @field_validator("source")
    @classmethod
    def _source(cls, value: str) -> str:
        return _no_braces(value.strip(), "Source")

    @field_validator("source_url")
    @classmethod
    def _url(cls, value: Optional[str]) -> Optional[str]:
        value = (value or "").strip()
        if not value:
            return None
        if not value.startswith("https://"):
            raise ValueError("source URL must start with https://")
        return _no_braces(value, "Source URL")


class TemplateContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    domain_guidance: str = Field(default="", max_length=4000)
    questions: list[TemplateQuestion] = Field(default_factory=list, max_length=10)
    items: dict[str, list[TemplateItem]] = Field(default_factory=dict)

    @field_validator("domain_guidance")
    @classmethod
    def _guidance(cls, value: str) -> str:
        return _no_braces(value.strip(), "Domain guidance")

    @model_validator(mode="after")
    def _check_items(self) -> "TemplateContent":
        question_keys = [q.key for q in self.questions]
        if len(set(question_keys)) != len(question_keys):
            raise ValueError("question keys must be unique")
        seen_keys: set[str] = set()
        for field, items in self.items.items():
            if field not in SEEDABLE_FIELDS:
                raise ValueError(f"'{field}' can't be pre-filled by a template (allowed: {', '.join(SEEDABLE_FIELDS)})")
            if len(items) > MAX_ITEMS_PER_FIELD:
                raise ValueError(f"'{field}' has more than {MAX_ITEMS_PER_FIELD} items")
            expected = set(SEEDABLE_FIELDS[field])
            for item in items:
                if item.key in seen_keys:
                    raise ValueError(f"item key '{item.key}' is used more than once")
                seen_keys.add(item.key)
                if item.applies_if is not None and item.applies_if not in question_keys:
                    raise ValueError(f"item '{item.key}' refers to an unknown question '{item.applies_if}'")
                if set(item.values) != expected:
                    raise ValueError(f"item '{item.key}' in '{field}' must have exactly: {', '.join(sorted(expected))}")
                cleaned = {}
                for name, value in item.values.items():
                    value = _no_braces(value.strip(), f"Item '{item.key}'")
                    if not value:
                        raise ValueError(f"item '{item.key}' has an empty '{name}'")
                    if len(value) > MAX_VALUE_LENGTH:
                        raise ValueError(f"item '{item.key}' '{name}' is longer than {MAX_VALUE_LENGTH} characters")
                    cleaned[name] = value
                item.values = cleaned
                if field in _LIST_OBJ_MODELS:
                    try:  # catches e.g. an impact of "Critical" or a priority of "Must"
                        _LIST_OBJ_MODELS[field](id="X", **cleaned)
                    except ValidationError as exc:
                        first = exc.errors()[0]
                        raise ValueError(f"item '{item.key}': {'.'.join(map(str, first['loc']))} {first['msg']}") from None
        # Drop empty field lists so stored content stays minimal.
        self.items = {field: items for field, items in self.items.items() if items}
        return self

    def all_items(self) -> list[tuple[str, TemplateItem]]:
        return [(field, item) for field, items in self.items.items() for item in items]

    def required_item_keys(self, answers: dict[str, bool]) -> set[str]:
        """Keys of the items a user of this content had to decide on: every item whose
        applicability question (if any) they answered yes to — or left at its default."""
        defaults = {q.key: q.default for q in self.questions}
        return {
            item.key
            for _, item in self.all_items()
            if item.applies_if is None or answers.get(item.applies_if, defaults.get(item.applies_if, False))
        }


class _TemplateMetaFields(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    domain_id: str
    description: str = Field(default="", max_length=300)
    icon: str = "generic"
    color: str = "#4f46e5"

    @field_validator("name", "description")
    @classmethod
    def _strip(cls, value: str) -> str:
        return _no_braces(value.strip(), "Name and description")

    @field_validator("icon")
    @classmethod
    def _icon(cls, value: str) -> str:
        if value not in ICONS:
            raise ValueError(f"icon must be one of: {', '.join(ICONS)}")
        return value

    @field_validator("color")
    @classmethod
    def _color(cls, value: str) -> str:
        if not _COLOR.match(value):
            raise ValueError("color must be a hex colour like #0f9d8a")
        return value.lower()


class TemplateCreateRequest(_TemplateMetaFields):
    slug: Optional[str] = None
    content: TemplateContent = Field(default_factory=TemplateContent)

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        if not _SLUG.match(value):
            raise ValueError("slug must be lowercase letters, digits or underscores (2-40)")
        return value


class TemplateUpdateRequest(_TemplateMetaFields):
    pass


class DraftSaveRequest(BaseModel):
    content: TemplateContent
    change_note: str = Field(default="", max_length=300)


class PublishRequest(BaseModel):
    change_note: str = Field(default="", max_length=300)


class DomainCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=60)

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        return _no_braces(" ".join(value.split()), "Domain name")


class DomainUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=60)
    is_active: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=0, le=10000)

    @field_validator("name")
    @classmethod
    def _strip(cls, value: Optional[str]) -> Optional[str]:
        return _no_braces(" ".join(value.split()), "Domain name") if value is not None else None


# ---------- Sent with POST /api/generate ----------


class TemplateUsage(BaseModel):
    """Which published template version the form was started from, the user's answers to its
    applicability questions, and what they did with each item it offered."""

    template_id: str
    version: int = Field(ge=1)
    answers: dict[str, bool] = Field(default_factory=dict)
    decisions: dict[str, Literal["accepted", "edited", "rejected"]] = Field(default_factory=dict)


class DomainChoice(BaseModel):
    """The project's domain: one from the admin-managed list, or free text typed under "Other"."""

    domain_id: Optional[str] = None
    other: Optional[str] = Field(default=None, max_length=60)

    @field_validator("other")
    @classmethod
    def _clean_other(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        # Printable characters only, whitespace collapsed; braces dropped (see _no_braces).
        value = "".join(ch for ch in value if ch.isprintable() and ch not in "{}")
        return " ".join(value.split()) or None

    @model_validator(mode="after")
    def _one_of(self) -> "DomainChoice":
        if bool(self.domain_id) == bool(self.other):
            raise ValueError("choose a domain from the list or type one under Other, not both")
        return self

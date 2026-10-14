"""Turns the extraction agent's raw output into the review the user sees: verifies every evidence
quote against the parsed source text, then sorts each form field into a review state.

This is deliberately plain code, not another LLM call. The model's own view of what's missing
or uncertain is an input here, but the final say on what blocks generation is deterministic:

- "blocking": a critical field that's missing or too vague. The user must fill it in.
- "confirm":  a value that's low-confidence, inferred, contradicted between documents, or whose
              quote couldn't be found in the source. The user must check it.
- "auto":     a non-critical field the documents don't (fully) cover. Pre-ticked for the AI to
              complete at generation time, grounded in the documents.
- "found":    stated clearly, with verified evidence.
- "optional": additional_sections, which may legitimately stay empty.
"""

import re
import unicodedata
from typing import Any, Optional

from brd_agent_suite.field_guide import FIELD_GUIDE_BY_NAME
from webapp.service import CRITICAL_FIELDS, FORM_FIELDS

# The rubric marks functional requirements Critical ("Ask."), so the document flow asks for them
# too, on top of the form's own CRITICAL_FIELDS.
BLOCKING_FIELDS = CRITICAL_FIELDS | {"functional_requirements"}

_OPTIONAL_FIELDS = {"additional_sections"}
_MAX_SUGGESTIONS = 5


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"-\s*\n\s*(\w)", r"\1", text)  # re-join words hyphenated across a line break
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def quote_found(quote: str, normalized_source: str) -> bool:
    """Whether a model-supplied quote really appears in the source. Tolerant of whitespace,
    punctuation, and case differences, of "..." elisions, and of a small deviation in the middle of
    a long quote; never of a paraphrase."""
    normalized_quote = _normalize(quote)
    if not normalized_quote:
        return False
    if normalized_quote in normalized_source:
        return True
    segments = [_normalize(s) for s in re.split(r"\.\.\.|…", quote)]
    segments = [s for s in segments if len(s.split()) >= 3]
    if len(segments) > 1 and all(s in normalized_source for s in segments):
        return True
    words = normalized_quote.split()
    if len(words) >= 10:
        return " ".join(words[:6]) in normalized_source and " ".join(words[-6:]) in normalized_source
    return False


def is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return all(is_empty(item) for item in value)
    if isinstance(value, dict):
        return all(is_empty(v) for v in value.values())
    return False


def _find_source(file_name: str, sources: dict[str, Optional[str]]) -> tuple[bool, Optional[str]]:
    """(known, normalized_text). normalized_text is None for a known file with no text layer (a
    scanned PDF the model read natively): its quotes can't be checked."""
    if file_name in sources:
        return True, sources[file_name]
    lowered = file_name.strip().lower()
    for name, text in sources.items():
        if name.lower() == lowered:
            return True, text
    return False, None


def build_review(extraction: dict, source_texts: dict[str, Optional[str]]) -> dict:
    """extraction is a DocumentExtraction dump; source_texts maps each uploaded file name to its
    parsed text, or None for a scanned PDF."""
    normalized_sources = {name: (_normalize(text) if text is not None else None) for name, text in source_texts.items()}
    any_checkable = any(text is not None for text in normalized_sources.values())

    form: dict[str, Any] = dict(extraction.get("form") or {})
    reports = {r.get("field"): r for r in extraction.get("field_reports") or [] if r.get("field") in FIELD_GUIDE_BY_NAME}
    conflicts = [
        {**c, "options": [o for o in c.get("options") or [] if (o.get("value") or "").strip()]}
        for c in extraction.get("conflicts") or []
        if c.get("field") in FIELD_GUIDE_BY_NAME
    ]
    conflicted = {c["field"] for c in conflicts}

    fields = []
    for name, kind in FORM_FIELDS:
        value = form.get(name)
        if value is None:
            value = "" if kind == "scalar" else []
            form[name] = value
        report = reports.get(name) or {}
        empty = is_empty(value)
        status = "missing" if empty else (report.get("status") or "found")
        confidence = report.get("confidence") or ("low" if status != "found" else "medium")

        evidence = []
        for item in report.get("evidence") or []:
            quote = (item.get("quote") or "").strip()
            if not quote:
                continue
            known, normalized = _find_source(item.get("file") or "", normalized_sources)
            verified = None if (known and normalized is None) else (known and quote_found(quote, normalized))
            evidence.append({
                "file": item.get("file") or "",
                "location": item.get("location") or "",
                "quote": quote,
                "verified": verified,
            })
        if empty:
            evidence = []

        state, reason = _classify(name, empty, status, confidence, evidence, name in conflicted, any_checkable)
        fields.append({
            "field": name,
            "label": FIELD_GUIDE_BY_NAME[name].label,
            "state": state,
            "status": status,
            "confidence": confidence,
            "reason": reason or report.get("note") or "",
            "note": report.get("note") or "",
            "evidence": evidence,
        })

    blocking = [f["field"] for f in fields if f["state"] == "blocking"]
    return {
        "form": form,
        "fields": fields,
        "blocking": blocking,
        "confirm": [f["field"] for f in fields if f["state"] == "confirm"],
        "auto_fields": [f["field"] for f in fields if f["state"] == "auto"],
        "conflicts": conflicts,
        "gap_questions": _gap_questions(extraction.get("gap_questions") or [], blocking),
        "summary": extraction.get("summary") or "",
        "digest": extraction.get("digest") or "",
    }


def _classify(
    name: str,
    empty: bool,
    status: str,
    confidence: str,
    evidence: list[dict],
    conflicted: bool,
    any_checkable: bool,
) -> tuple[str, str]:
    if name in _OPTIONAL_FIELDS:
        return ("optional" if empty else "found"), ""
    critical = name in BLOCKING_FIELDS
    if empty:
        if critical:
            return "blocking", "The documents don't cover this, and it's required."
        return "auto", "Not covered by the documents. The AI will draft it from the documents' context."
    if status == "partial":
        if critical:
            return "blocking", "The documents only mention this vaguely. Please make it specific."
        return "auto", "Only partly covered. The AI will expand it, keeping what the documents say."
    if conflicted:
        return "confirm", "The documents disagree about this. Please pick the right value."
    if status == "inferred":
        return "confirm", "Not stated outright; inferred from the documents. Please check it."
    if confidence == "low":
        return "confirm", "Low confidence. Please check this against your documents."
    if any(e["verified"] is False for e in evidence) and not any(e["verified"] for e in evidence):
        return "confirm", "The supporting quote couldn't be found in the documents. Please check this value."
    if not evidence and any_checkable:
        return "confirm", "No supporting quote was given for this value. Please check it."
    return "found", ""


def _gap_questions(raw_questions: list[dict], blocking: list[str]) -> list[dict]:
    """The model's questions, cleaned up, plus a fallback question for any blocking field the
    model didn't ask about, so every blocking gap always comes with a question."""
    questions: list[dict] = []
    seen: set[str] = set()
    for q in raw_questions:
        name = q.get("field")
        text = (q.get("question") or "").strip()
        if name not in FIELD_GUIDE_BY_NAME or not text or name in seen:
            continue
        seen.add(name)
        suggestions: list[str] = []
        for s in q.get("suggested_answers") or []:
            s = (s or "").strip()
            if s and s not in suggestions:
                suggestions.append(s)
        questions.append({"field": name, "question": text, "suggested_answers": suggestions[:_MAX_SUGGESTIONS]})
    for name in blocking:
        if name not in seen:
            questions.append({
                "field": name,
                "question": f"The documents don't make this clear. {FIELD_GUIDE_BY_NAME[name].question}",
                "suggested_answers": [],
            })
    # Blocking questions first, in form order; then the rest as the model ordered them.
    order = {name: i for i, name in enumerate(blocking)}
    return sorted(questions, key=lambda q: order.get(q["field"], len(order)))

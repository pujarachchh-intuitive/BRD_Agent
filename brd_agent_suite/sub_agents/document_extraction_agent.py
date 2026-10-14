from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..document_schema import DocumentExtraction
from ..observability import log_after_model_call, log_before_model_call, log_model_error_call
from ..prompts.document_extraction_prompt import DOCUMENT_EXTRACTION_INSTRUCTION, EXTRACTION_MERGE_INSTRUCTION


def build_document_extraction_agent() -> LlmAgent:
    """Runs on its own, not as a pipeline first stage: its output goes to the user for review
    before anything is generated (see webapp/ingestion/service.py)."""
    return LlmAgent(
        name="document_extraction_agent",
        model=MODEL_NAME,
        description="Extracts a structured requirements form, with evidence, from uploaded project documents.",
        instruction=DOCUMENT_EXTRACTION_INSTRUCTION,
        output_schema=DocumentExtraction,
        output_key="document_extraction",
        before_model_callback=log_before_model_call,
        after_model_callback=log_after_model_call,
        on_model_error_callback=log_model_error_call,
    )


def build_extraction_merge_agent() -> LlmAgent:
    """Combines per-document extractions when the uploaded documents are too long to extract in a
    single call together."""
    return LlmAgent(
        name="extraction_merge_agent",
        model=MODEL_NAME,
        description="Merges several per-document extractions into one combined extraction.",
        instruction=EXTRACTION_MERGE_INSTRUCTION,
        output_schema=DocumentExtraction,
        output_key="document_extraction",
        before_model_callback=log_before_model_call,
        after_model_callback=log_after_model_call,
        on_model_error_callback=log_model_error_call,
    )

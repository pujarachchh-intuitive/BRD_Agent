from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..observability import log_after_model_call, log_before_model_call, log_model_error_call
from ..prompts.brd_prompt import BRD_INSTRUCTION


def build_brd_agent() -> LlmAgent:
    """Fresh instance — ADK agents are single-parent, so each pipeline needs its own copy."""
    return LlmAgent(
        name="brd_agent",
        model=MODEL_NAME,
        description="Generates the Business Requirements Document from the shared requirements JSON.",
        instruction=BRD_INSTRUCTION,
        output_key="brd_markdown",
        before_model_callback=log_before_model_call,
        after_model_callback=log_after_model_call,
        on_model_error_callback=log_model_error_call,
    )


brd_agent = build_brd_agent()

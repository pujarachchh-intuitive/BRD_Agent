from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..observability import log_after_model_call, log_before_model_call, log_model_error_call
from ..prompts.consistency_prompt import CONSISTENCY_CHECK_INSTRUCTION


def build_consistency_check_agent() -> LlmAgent:
    return LlmAgent(
        name="consistency_check_agent",
        model=MODEL_NAME,
        description="Reads all five generated documents and flags any contradiction between them.",
        instruction=CONSISTENCY_CHECK_INSTRUCTION,
        output_key="consistency_report",
        before_model_callback=log_before_model_call,
        after_model_callback=log_after_model_call,
        on_model_error_callback=log_model_error_call,
    )


consistency_check_agent = build_consistency_check_agent()

from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..observability import log_after_model_call, log_before_model_call, log_model_error_call
from ..prompts.tsd_prompt import TSD_INSTRUCTION


def build_tsd_agent() -> LlmAgent:
    return LlmAgent(
        name="tsd_agent",
        model=MODEL_NAME,
        description="Generates the Technical Specification Document from the shared requirements JSON.",
        instruction=TSD_INSTRUCTION,
        output_key="tsd_markdown",
        before_model_callback=log_before_model_call,
        after_model_callback=log_after_model_call,
        on_model_error_callback=log_model_error_call,
    )


tsd_agent = build_tsd_agent()

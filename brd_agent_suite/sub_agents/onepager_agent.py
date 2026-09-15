from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..observability import log_after_model_call, log_before_model_call, log_model_error_call
from ..prompts.onepager_prompt import ONEPAGER_INSTRUCTION


def build_onepager_agent() -> LlmAgent:
    return LlmAgent(
        name="onepager_agent",
        model=MODEL_NAME,
        description="Generates the executive one-pager from the shared requirements JSON.",
        instruction=ONEPAGER_INSTRUCTION,
        output_key="onepager_markdown",
        before_model_callback=log_before_model_call,
        after_model_callback=log_after_model_call,
        on_model_error_callback=log_model_error_call,
    )


onepager_agent = build_onepager_agent()

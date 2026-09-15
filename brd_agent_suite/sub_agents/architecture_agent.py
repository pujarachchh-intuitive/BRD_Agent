from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..observability import log_after_model_call, log_before_model_call, log_model_error_call
from ..prompts.architecture_prompt import ARCHITECTURE_INSTRUCTION


def build_architecture_agent() -> LlmAgent:
    return LlmAgent(
        name="architecture_agent",
        model=MODEL_NAME,
        description="Generates a Mermaid architecture/component diagram from the shared requirements JSON.",
        instruction=ARCHITECTURE_INSTRUCTION,
        output_key="architecture_mermaid",
        before_model_callback=log_before_model_call,
        after_model_callback=log_after_model_call,
        on_model_error_callback=log_model_error_call,
    )


architecture_agent = build_architecture_agent()

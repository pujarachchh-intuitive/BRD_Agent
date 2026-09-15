from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..observability import log_after_model_call, log_before_model_call, log_model_error_call
from ..prompts.flowchart_prompt import FLOWCHART_INSTRUCTION


def build_flowchart_agent() -> LlmAgent:
    return LlmAgent(
        name="flowchart_agent",
        model=MODEL_NAME,
        description="Generates a Mermaid process flowchart from the shared requirements JSON.",
        instruction=FLOWCHART_INSTRUCTION,
        output_key="flowchart_mermaid",
        before_model_callback=log_before_model_call,
        after_model_callback=log_after_model_call,
        on_model_error_callback=log_model_error_call,
    )


flowchart_agent = build_flowchart_agent()

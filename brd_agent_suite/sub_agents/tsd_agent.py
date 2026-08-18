from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..prompts.tsd_prompt import TSD_INSTRUCTION


def build_tsd_agent() -> LlmAgent:
    return LlmAgent(
        name="tsd_agent",
        model=MODEL_NAME,
        description="Generates the Technical Specification Document from the shared requirements JSON.",
        instruction=TSD_INSTRUCTION,
        output_key="tsd_markdown",
    )


tsd_agent = build_tsd_agent()

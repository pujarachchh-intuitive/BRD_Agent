from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..prompts.brd_prompt import BRD_INSTRUCTION


def build_brd_agent() -> LlmAgent:
    """Fresh instance — ADK agents are single-parent, so each pipeline needs its own copy."""
    return LlmAgent(
        name="brd_agent",
        model=MODEL_NAME,
        description="Generates the Business Requirements Document from the shared requirements JSON.",
        instruction=BRD_INSTRUCTION,
        output_key="brd_markdown",
    )


brd_agent = build_brd_agent()

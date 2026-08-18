from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..prompts.consistency_prompt import CONSISTENCY_CHECK_INSTRUCTION


def build_consistency_check_agent() -> LlmAgent:
    return LlmAgent(
        name="consistency_check_agent",
        model=MODEL_NAME,
        description="Reads all five generated documents and flags any contradiction between them.",
        instruction=CONSISTENCY_CHECK_INSTRUCTION,
        output_key="consistency_report",
    )


consistency_check_agent = build_consistency_check_agent()

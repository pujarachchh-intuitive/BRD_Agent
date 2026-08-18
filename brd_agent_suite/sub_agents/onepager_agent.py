from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..prompts.onepager_prompt import ONEPAGER_INSTRUCTION


def build_onepager_agent() -> LlmAgent:
    return LlmAgent(
        name="onepager_agent",
        model=MODEL_NAME,
        description="Generates the executive one-pager from the shared requirements JSON.",
        instruction=ONEPAGER_INSTRUCTION,
        output_key="onepager_markdown",
    )


onepager_agent = build_onepager_agent()

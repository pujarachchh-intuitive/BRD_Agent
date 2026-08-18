from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..prompts.revision_prompt import REVISION_INSTRUCTION
from ..schema import RequirementsModel


def build_revision_agent() -> LlmAgent:
    return LlmAgent(
        name="revision_agent",
        model=MODEL_NAME,
        description="Applies a free-text change request to an existing requirements object.",
        instruction=REVISION_INSTRUCTION,
        output_schema=RequirementsModel,
        output_key="requirements_json",
    )

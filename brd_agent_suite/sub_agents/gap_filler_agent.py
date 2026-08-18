from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..prompts.gap_filler_prompt import GAP_FILLER_INSTRUCTION
from ..schema import RequirementsModel


def build_gap_filler_agent() -> LlmAgent:
    return LlmAgent(
        name="gap_filler_agent",
        model=MODEL_NAME,
        description=(
            "Completes a partially-filled structured requirements form, generating only the fields "
            "explicitly marked for auto-generation and preserving everything else verbatim."
        ),
        instruction=GAP_FILLER_INSTRUCTION,
        output_schema=RequirementsModel,
        output_key="requirements_json",
    )

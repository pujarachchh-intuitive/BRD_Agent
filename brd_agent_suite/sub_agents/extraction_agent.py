from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..prompts.extraction_prompt import EXTRACTION_INSTRUCTION
from ..schema import RequirementsModel

extraction_agent = LlmAgent(
    name="extraction_agent",
    model=MODEL_NAME,
    description="Converts a fully-resolved project description into a structured RequirementsModel JSON object.",
    instruction=EXTRACTION_INSTRUCTION,
    output_schema=RequirementsModel,
    output_key="requirements_json",
)

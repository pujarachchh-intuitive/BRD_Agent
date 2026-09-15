from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..observability import log_after_model_call, log_before_model_call, log_model_error_call
from ..prompts.extraction_prompt import EXTRACTION_INSTRUCTION
from ..schema import RequirementsModel

extraction_agent = LlmAgent(
    name="extraction_agent",
    model=MODEL_NAME,
    description="Converts a fully-resolved project description into a structured RequirementsModel JSON object.",
    instruction=EXTRACTION_INSTRUCTION,
    output_schema=RequirementsModel,
    output_key="requirements_json",
    before_model_callback=log_before_model_call,
    after_model_callback=log_after_model_call,
    on_model_error_callback=log_model_error_call,
)

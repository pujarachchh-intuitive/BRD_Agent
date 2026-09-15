from google.adk.agents import LlmAgent

from .config import MODEL_NAME
from .observability import log_after_model_call, log_before_model_call, log_model_error_call
from .prompts.root_prompt import ROOT_INSTRUCTION
from .tools import generate_all_documents

root_agent = LlmAgent(
    name="brd_intake_agent",
    model=MODEL_NAME,
    description=(
        "Conversational intake agent: gathers a project description, applies a completeness rubric "
        "to decide whether to ask clarifying questions, then generates a BRD, TSD, flowchart, "
        "architecture diagram, and executive one-pager from it."
    ),
    instruction=ROOT_INSTRUCTION,
    tools=[generate_all_documents],
    before_model_callback=log_before_model_call,
    after_model_callback=log_after_model_call,
    on_model_error_callback=log_model_error_call,
)

from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..prompts.flowchart_prompt import FLOWCHART_INSTRUCTION


def build_flowchart_agent() -> LlmAgent:
    return LlmAgent(
        name="flowchart_agent",
        model=MODEL_NAME,
        description="Generates a Mermaid process flowchart from the shared requirements JSON.",
        instruction=FLOWCHART_INSTRUCTION,
        output_key="flowchart_mermaid",
    )


flowchart_agent = build_flowchart_agent()

from google.adk.agents import LlmAgent

from ..config import MODEL_NAME
from ..prompts.architecture_prompt import ARCHITECTURE_INSTRUCTION


def build_architecture_agent() -> LlmAgent:
    return LlmAgent(
        name="architecture_agent",
        model=MODEL_NAME,
        description="Generates a Mermaid architecture/component diagram from the shared requirements JSON.",
        instruction=ARCHITECTURE_INSTRUCTION,
        output_key="architecture_mermaid",
    )


architecture_agent = build_architecture_agent()

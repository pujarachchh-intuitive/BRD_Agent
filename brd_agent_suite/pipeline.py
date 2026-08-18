"""The internal document-generation pipeline(s), each run by its own Runner.

<first stage: extraction / gap-filling / revision>
  -> ParallelAgent(brd, tsd, flowchart, architecture, onepager)   # all read {requirements_json}
  -> consistency_check_agent (sequential, reads all five outputs)

ADK agents are single-parent (an agent instance can only belong to one sub_agents tree), so every
pipeline that needs its own copy of the five generators must build fresh instances rather than reuse
another pipeline's. build_document_pipeline() is the shared factory for that; the chat flow's
document_pipeline below is one call of it, built once at import time since adk web/api_server reuses
one root_agent (and its whole sub-tree) across every concurrent session safely.
"""

from google.adk.agents import BaseAgent, ParallelAgent, SequentialAgent

from .sub_agents.architecture_agent import build_architecture_agent
from .sub_agents.brd_agent import build_brd_agent
from .sub_agents.consistency_check_agent import build_consistency_check_agent
from .sub_agents.extraction_agent import extraction_agent
from .sub_agents.flowchart_agent import build_flowchart_agent
from .sub_agents.onepager_agent import build_onepager_agent
from .sub_agents.tsd_agent import build_tsd_agent


def build_document_generators() -> ParallelAgent:
    return ParallelAgent(
        name="document_generators",
        description="Runs all five document generators concurrently against the shared requirements JSON.",
        sub_agents=[
            build_brd_agent(),
            build_tsd_agent(),
            build_flowchart_agent(),
            build_architecture_agent(),
            build_onepager_agent(),
        ],
    )


def build_document_pipeline(first_stage: BaseAgent, name: str = "document_pipeline") -> SequentialAgent:
    """first_stage must write {requirements_json} to state via output_key, same as extraction_agent."""
    return SequentialAgent(
        name=name,
        description=(
            "Full BRD/TSD/diagram/one-pager generation pipeline: resolve structured requirements, "
            "fan out to five generators in parallel, then run a cross-document consistency check."
        ),
        sub_agents=[first_stage, build_document_generators(), build_consistency_check_agent()],
    )


document_pipeline = build_document_pipeline(extraction_agent)

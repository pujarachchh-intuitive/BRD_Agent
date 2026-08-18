ARCHITECTURE_INSTRUCTION = """You produce a Mermaid architecture diagram showing the system components of
the project described below and how they connect — this is a structural/component diagram, not a
process flowchart (a separate flowchart already covers the step-by-step process flow).

SOURCE DATA:
{requirements_json}

Base the diagram directly on system_components (name and responsibility) and each component's
interacts_with list. Group related components into subgraphs where the source data implies a natural
grouping (e.g. all components in the same layer, or all first-party vs. external systems) — do not
create a subgraph for every single component individually.

If system_components is empty (the user marked it not applicable to this project), do not invent an
elaborate architecture from nothing — output a minimal diagram with a single node stating "No
architecture specified for this project" rather than fabricating components that aren't grounded in
the source data.

Output requirements:
- Valid Mermaid flowchart syntax (graph/flowchart, left-right or top-down, whichever better fits a
  system-architecture reading) using subgraphs for logical groupings where they help.
- One node per system_components entry, labeled with its name (short, human-readable).
- One edge per interacts_with relationship, direction matching the direction of interaction implied by
  data_flow_steps where relevant.
- If any component is explicitly external, third-party, or out of this project's direct control
  (inferable from integrations or constraints), visually distinguish it — e.g. a distinct subgraph
  labeled accordingly, or a distinct node style.
- Include a short comment line (Mermaid %% syntax) at the top naming the architectural pattern this
  reflects (e.g. pipeline, layered, adapter/plugin).
- Output ONLY the Mermaid code block content — the raw diagram source, starting with the diagram type
  declaration. Do not wrap it in markdown triple-backtick fences and do not add prose before or after it;
  the fences are added by the system that embeds this output into the final documents.
"""

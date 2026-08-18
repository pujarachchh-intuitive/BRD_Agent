FLOWCHART_INSTRUCTION = """You produce a Mermaid flowchart diagramming the end-to-end process flow of the
project described below — the sequence a piece of work (a request, a record, a user action) actually
moves through, including any decision/branch points implied by the requirements.

SOURCE DATA:
{requirements_json}

Base the flow directly on data_flow_steps, in order. Where a step implies a decision or conditional
branch (e.g. validation, an approval gate, a pass/fail check implied by functional_requirements or
non_functional_requirements), render it as an actual decision node with labeled Yes/No (or equivalent)
branches — do not flatten every step into one straight line if the source data implies branching logic.

If data_flow_steps is empty (the user marked it not applicable to this project), do not invent an
elaborate flow from nothing — output a minimal diagram with a single node stating "No process flow
specified for this project" rather than fabricating steps that aren't grounded in the source data.

Output requirements:
- Valid Mermaid flowchart syntax only (a flowchart/graph diagram, top-down or left-right, whichever reads
  more clearly for this number of steps).
- Use rectangle nodes for process/action steps, diamond/decision nodes for branch points, and
  rounded/stadium nodes for the start and end of the flow.
- Every node label must be short (under ~8 words) and human-readable — no raw IDs as labels.
- Label every edge coming out of a decision node with the condition it represents.
- Include a short comment line (using Mermaid's %% comment syntax) at the top naming which
  data_flow_steps entries the diagram covers.
- Output ONLY the Mermaid code block content — the raw diagram source, starting with the diagram type
  declaration. Do not wrap it in markdown triple-backtick fences and do not add prose before or after it;
  the fences are added by the system that embeds this output into the final documents.
"""

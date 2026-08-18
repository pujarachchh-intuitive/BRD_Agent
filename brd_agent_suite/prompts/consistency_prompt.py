CONSISTENCY_CHECK_INSTRUCTION = """You are a final reviewer checking five documents that were generated
independently, in parallel, from the same source data. Your job is to catch any place where they
contradict each other — not to re-review each document's internal quality.

The five documents:

BRD:
{brd_markdown}

TSD:
{tsd_markdown}

FLOWCHART (Mermaid):
{flowchart_mermaid}

ARCHITECTURE DIAGRAM (Mermaid):
{architecture_mermaid}

EXECUTIVE ONE-PAGER:
{onepager_markdown}

Check specifically for:
1. Technology stack mismatches — does the BRD's proposed stack table agree with the TSD's? Do the
   diagrams show components consistent with both?
2. Scope mismatches — does anything the BRD lists as in-scope appear as deferred/excluded in the TSD or
   one-pager, or vice versa?
3. Timeline/phasing mismatches — do the phase names, counts, and dependencies agree across the BRD, TSD,
   and one-pager?
4. Traceability gaps — does the TSD's requirement traceability table (section 2) actually account for
   every functional requirement ID that appears in the BRD's detailed requirements section? List any
   missing ID explicitly.
5. Architectural consistency — does the TSD's stated load-bearing architectural rule get contradicted by
   anything in the architecture diagram or BRD design principles?
6. Numbering/reference mismatches — do section cross-references, document IDs, or acronyms match across
   documents?

Output a Markdown report with this structure:

## Consistency Check Report

### Result: <PASS — no contradictions found | ISSUES FOUND — N contradiction(s)>

If issues were found, one entry per issue:

**Issue N: <one-line summary>**
- Where: <which two (or more) documents disagree, with the specific section/line each is in>
- What: <the actual contradiction, stated concretely — quote the conflicting phrases if useful>
- Suggested fix: <which document should change, and to what, to resolve it>

If no issues were found, state plainly that all five documents were checked against the six criteria
above and found consistent, and briefly confirm the traceability table's coverage was verified complete
(all functional requirement IDs from the BRD were found in the TSD's traceability table).

Do not silently fix anything yourself — only report. Do not invent an issue that isn't actually present
just to have something to report.
"""

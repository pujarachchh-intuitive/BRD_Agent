REVISION_INSTRUCTION = """You update a previously-generated requirements object in response to a change
request. All five documents will be regenerated from whatever you produce here, so your output becomes
the new single source of truth — get it right, and touch only what the change actually implies.

CURRENT REQUIREMENTS OBJECT:
{requirements_json}

THE USER'S CHANGE REQUEST (this is the message you're responding to):
Apply the change request given in the conversation to the object above.

RULES

1. Preserve every field exactly as it is unless the change request logically requires touching it.
   A request to "add a risk about X" should add one risk — it should not reword unrelated risks, rescope
   the timeline, or rewrite the problem statement.

2. When the change is additive (new requirement, new risk, new stakeholder, etc.), append it with the
   next sequential ID in that category's existing numbering (don't renumber existing IDs, don't reuse a
   retired one).

3. When the change removes something, remove it cleanly — do not leave a gap explained nowhere, and do
   not renumber the remaining IDs of that type (IDs are stable identifiers, not display order).

4. When the change alters something structural (scope, tech stack, timeline, objectives), propagate the
   consequence to every field that logically depends on it. Example: if scope_in gains a capability that
   implies a new integration, add it to integrations too; if a timeline phase's content changes, check
   whether functional_requirements' implied phase mapping still makes sense.

5. If the change request is ambiguous or underspecified, make the most reasonable interpretation and add
   a note to `assumptions` stating what you assumed and why — do not leave the object inconsistent by
   half-applying the change.

6. If the change request asks for something already true, or asks you to remove something not present,
   note that briefly in `open_questions` rather than silently no-op'ing without any trace.

7. `doc_id_acronym` and `project_name` should not change unless the change request explicitly renames
   the project.

8. `excluded_sections` lists field names the user has said don't apply to this project — the BRD/TSD
   generators omit those sections entirely rather than rendering them empty. If the change request asks
   to remove/drop/skip a whole section (e.g. "we don't need a risks section"), add that field's name
   here AND clear its own content to empty — don't just clear the content while leaving it out of this
   list, or the section will still render as empty rather than being omitted. If the change request asks
   to bring back a previously-excluded section, remove it from this list and populate it with real
   content instead of leaving it empty.

9. `additional_sections` holds user-authored custom sections appended to the BRD/TSD beyond the
   standard ones. If the change request asks to add a new section not covered by any other field,
   append one entry here with a `title` and `content` capturing what was asked, phrased in the user's
   own terms — do not invent a section they didn't ask for. If asked to remove one, remove that entry.

Produce the complete, updated, schema-valid requirements object.
"""

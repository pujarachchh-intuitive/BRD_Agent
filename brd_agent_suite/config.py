"""Central configuration. Single place to change the working model."""

# gemini-2.5-flash is scheduled for shutdown 2026-10-16 (Gemini Developer API).
# gemini-3.7-flash is the newest non-preview flash-tier model available as of Aug 2026
# (verified via a live models.list() call against the project's own API key).
# Change this one constant if the model needs to move again.
MODEL_NAME = "gemini-3.7-flash"

OUTPUT_DIR_NAME = "output"
APP_NAME = "brd_agent_suite"

"""Central configuration. Single place to change the working model."""

import os

# gemini-2.5-flash is scheduled for shutdown 2026-10-16 (Gemini Developer API).
# gemini-3.7-flash is the newest non-preview flash-tier model available as of Aug 2026
# (verified via a live models.list() call against the project's own API key).
# Change this one constant if the model needs to move again.
MODEL_NAME = "gemini-3.7-flash"
PROVIDER_NAME = "google"

OUTPUT_DIR_NAME = "output"
LOGS_DIR_NAME = "logs"
APP_NAME = "brd_agent_suite"

# "development" / "staging" / "production" — surfaced in every log record's metadata.env.
ENVIRONMENT = os.getenv("APP_ENV", "development")

# USD per 1,000,000 tokens, keyed by model name. Used to compute input_cost_usd / output_cost_usd /
# estimated_cost_usd in logs. A model missing from this table logs those fields as null.
MODEL_PRICING_PER_1M_TOKENS: dict[str, dict[str, float]] = {
    "gemini-3.7-flash": {"input": 0.75, "output": 3.75},
}

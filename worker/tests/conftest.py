import os

# grading.agent constructs a pydantic-ai Agent at import time, which requires
# ANTHROPIC_API_KEY to be present (not necessarily valid) just to import the
# module. Tests never make real LLM calls, so a placeholder is enough.
os.environ.setdefault('ANTHROPIC_API_KEY', 'test-key-not-real')
os.environ.setdefault('GRADING_MODEL', 'anthropic:claude-sonnet-4-6')

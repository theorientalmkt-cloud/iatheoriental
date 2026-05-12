-- Fix "ghost models" replacing gemini-2.5-flash and similar with gemini-1.5-flash / gpt-4o-mini

-- Update ai_agents
UPDATE public.ai_agents
SET model = 'gemini-1.5-flash'
WHERE model IN ('gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite');

-- Update settings (key-value store, value is JSON for ai_direct)
-- Here we need to update the AI config if it contains the ghost model.
UPDATE public.settings
SET value = jsonb_set(
    value::jsonb,
    '{model}',
    CASE 
        WHEN (value::jsonb)->>'provider' = 'openai' THEN '"gpt-4o-mini"'::jsonb
        ELSE '"gemini-1.5-flash"'::jsonb
    END
)::text
WHERE key = 'ai_direct'
  AND (value::jsonb)->>'model' IN ('gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite');

-- Also update ocr_gemini_model if set
UPDATE public.settings
SET value = 'gemini-1.5-flash'
WHERE key = 'ocr_gemini_model' AND value IN ('gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite');

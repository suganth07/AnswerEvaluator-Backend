-- First, update existing questions to move correct_option to correct_options array
UPDATE public.questions 
SET correct_options = 
  CASE 
    WHEN correct_option IS NOT NULL AND correct_options IS NULL THEN 
      to_jsonb(ARRAY[correct_option])
    WHEN correct_option IS NOT NULL AND correct_options IS NOT NULL THEN 
      correct_options::jsonb
    WHEN correct_options IS NOT NULL THEN 
      correct_options::jsonb
    ELSE 
      to_jsonb(ARRAY['A'])
  END
WHERE correct_options IS NULL OR correct_option IS NOT NULL;

-- Make correct_options NOT NULL with default value
ALTER TABLE public.questions 
ALTER COLUMN correct_options SET NOT NULL,
ALTER COLUMN correct_options SET DEFAULT '["A"]';

-- Drop the correct_option column
ALTER TABLE public.questions DROP COLUMN correct_option;

-- Add constraint to ensure correct_options is not empty
ALTER TABLE public.questions 
ADD CONSTRAINT chk_correct_options_not_empty 
CHECK (jsonb_array_length(correct_options::jsonb) > 0);
-- Migration to add support for multiple selected answers in student_answers table
-- This adds a new column selected_options as a JSONB array while keeping backward compatibility

BEGIN;

-- Add new column for multiple selected answers (JSONB array for better indexing)
ALTER TABLE student_answers ADD COLUMN IF NOT EXISTS selected_options JSONB;

-- Create index for efficient querying of selected_options (only if JSONB is supported)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'jsonb') THEN
        CREATE INDEX IF NOT EXISTS idx_student_answers_selected_options ON student_answers USING GIN (selected_options);
    END IF;
END$$;

-- Update existing records to maintain backward compatibility
-- Convert single selected_option to array format in selected_options
UPDATE student_answers 
SET selected_options = jsonb_build_array(selected_option)
WHERE selected_option IS NOT NULL 
  AND selected_options IS NULL;

-- Add check constraint to ensure at least one answer exists
ALTER TABLE student_answers 
ADD CONSTRAINT check_has_selected_answer 
CHECK (
  (selected_option IS NOT NULL) OR 
  (selected_options IS NOT NULL AND jsonb_array_length(selected_options) > 0)
);

COMMIT;

-- Example queries for multiple selected answers:
-- 
-- Insert student answer with single selection (old format):
-- INSERT INTO student_answers (submission_id, question_number, selected_option, is_correct) VALUES (1, 1, 'A', true);
-- 
-- Insert student answer with multiple selections (new format):
-- INSERT INTO student_answers (submission_id, question_number, selected_options, is_correct) VALUES (1, 2, '["A", "C"]'::jsonb, true);
-- 
-- Query student answers with multiple selections:
-- SELECT * FROM student_answers WHERE jsonb_array_length(selected_options) > 1;
-- 
-- Check if option 'A' was selected by student:
-- SELECT * FROM student_answers WHERE selected_option = 'A' OR selected_options ? 'A';
-- Migration to add support for multiple correct answers
-- This adds a new column correct_options as a JSON array while keeping backward compatibility

BEGIN;

-- Add new column for multiple correct answers (JSON array)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS correct_options JSON;

-- Create index for efficient querying of correct_options
CREATE INDEX IF NOT EXISTS idx_questions_correct_options ON questions USING GIN (correct_options);

-- Update existing records to maintain backward compatibility
-- Convert single correct_option to array format in correct_options
UPDATE questions 
SET correct_options = json_build_array(correct_option)
WHERE correct_option IS NOT NULL 
  AND correct_options IS NULL;

-- Add check constraint to ensure at least one correct answer exists
ALTER TABLE questions 
ADD CONSTRAINT check_has_correct_answer 
CHECK (
  (correct_option IS NOT NULL) OR 
  (correct_options IS NOT NULL AND json_array_length(correct_options) > 0)
);

COMMIT;

-- Example queries for multiple correct answers:
-- 
-- Insert question with single correct answer (old format):
-- INSERT INTO questions (paper_id, question_number, correct_option) VALUES (1, 1, 'A');
-- 
-- Insert question with multiple correct answers (new format):
-- INSERT INTO questions (paper_id, question_number, correct_options) VALUES (1, 2, '["A", "C"]'::json);
-- 
-- Query questions with multiple correct answers:
-- SELECT * FROM questions WHERE json_array_length(correct_options) > 1;
-- 
-- Check if option 'A' is correct for a question:
-- SELECT * FROM questions WHERE correct_option = 'A' OR correct_options ? 'A';
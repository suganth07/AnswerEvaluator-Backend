-- Database Migration for Multi-page and OMR Support
-- Date: September 11, 2025

-- Add question_type column to papers table to identify OMR vs traditional questions
ALTER TABLE papers ADD COLUMN IF NOT EXISTS question_type VARCHAR(20) DEFAULT 'traditional';
COMMENT ON COLUMN papers.question_type IS 'Type of questions: traditional, omr, mixed';

-- Add question_type column to questions table for individual question types
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_type VARCHAR(20) DEFAULT 'traditional';
COMMENT ON COLUMN questions.question_type IS 'Individual question type: traditional, omr';

-- Add options column to questions table for OMR options (A, B, C, D, etc.)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS options JSONB;
COMMENT ON COLUMN questions.options IS 'JSON array of available options for OMR questions: ["A", "B", "C", "D"]';

-- Update existing questions to have default options for OMR compatibility
UPDATE questions SET options = '["A", "B", "C", "D"]' WHERE options IS NULL;

-- Create index for better performance on question_type queries
CREATE INDEX IF NOT EXISTS idx_papers_question_type ON papers(question_type);
CREATE INDEX IF NOT EXISTS idx_questions_question_type ON questions(question_type);

-- Add constraints to ensure valid question types
ALTER TABLE papers ADD CONSTRAINT chk_papers_question_type 
CHECK (question_type IN ('traditional', 'omr', 'mixed'));

ALTER TABLE questions ADD CONSTRAINT chk_questions_question_type 
CHECK (question_type IN ('traditional', 'omr'));

-- Update papers table for any existing multi-page functionality
-- (total_pages column should already exist based on previous migrations)

COMMIT;
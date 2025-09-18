-- Additional indexes for better performance
CREATE INDEX IF NOT EXISTS idx_papers_admin_id ON public.papers(admin_id);
CREATE INDEX IF NOT EXISTS idx_papers_uploaded_at ON public.papers(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_papers_question_type ON public.papers(question_type);

CREATE INDEX IF NOT EXISTS idx_questions_paper_id ON public.questions(paper_id);
CREATE INDEX IF NOT EXISTS idx_questions_question_number ON public.questions(question_number);
CREATE INDEX IF NOT EXISTS idx_questions_paper_question ON public.questions(paper_id, question_number);

CREATE INDEX IF NOT EXISTS idx_student_submissions_paper_id ON public.student_submissions(paper_id);
CREATE INDEX IF NOT EXISTS idx_student_submissions_submitted_at ON public.student_submissions(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_submissions_student_name ON public.student_submissions(student_name);

CREATE INDEX IF NOT EXISTS idx_student_answers_submission_id ON public.student_answers(submission_id);
CREATE INDEX IF NOT EXISTS idx_student_answers_question_number ON public.student_answers(question_number);
CREATE INDEX IF NOT EXISTS idx_student_answers_is_correct ON public.student_answers(is_correct);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_student_answers_submission_question ON public.student_answers(submission_id, question_number);
CREATE INDEX IF NOT EXISTS idx_questions_paper_page ON public.questions(paper_id, page_number);

-- GIN indexes for JSON columns (for better JSON query performance)
CREATE INDEX IF NOT EXISTS idx_papers_question_types_gin ON public.papers USING GIN(question_types);
CREATE INDEX IF NOT EXISTS idx_papers_mixed_config_gin ON public.papers USING GIN(mixed_config);
CREATE INDEX IF NOT EXISTS idx_questions_options_gin ON public.questions USING GIN(options);
CREATE INDEX IF NOT EXISTS idx_questions_blank_positions_gin ON public.questions USING GIN(blank_positions);
CREATE INDEX IF NOT EXISTS idx_questions_expected_answers_gin ON public.questions USING GIN(expected_answers);
CREATE INDEX IF NOT EXISTS idx_questions_correct_options_gin ON public.questions USING GIN(correct_options);
CREATE INDEX IF NOT EXISTS idx_questions_weightages_gin ON public.questions USING GIN(weightages);
CREATE INDEX IF NOT EXISTS idx_student_submissions_answer_types_gin ON public.student_submissions USING GIN(answer_types);
CREATE INDEX IF NOT EXISTS idx_student_answers_blank_answers_gin ON public.student_answers USING GIN(blank_answers);
CREATE INDEX IF NOT EXISTS idx_student_answers_selected_options_gin ON public.student_answers USING GIN(selected_options);

-- Constraints for data integrity
ALTER TABLE public.questions 
ADD CONSTRAINT chk_question_has_correct_answer 
CHECK (correct_option IS NOT NULL OR correct_options IS NOT NULL);

ALTER TABLE public.questions 
ADD CONSTRAINT chk_points_per_blank_positive 
CHECK (points_per_blank > 0);

ALTER TABLE public.student_submissions 
ADD CONSTRAINT chk_score_non_negative 
CHECK (score >= 0);

ALTER TABLE public.student_submissions 
ADD CONSTRAINT chk_percentage_valid_range 
CHECK (percentage >= 0 AND percentage <= 100);

ALTER TABLE public.student_submissions 
ADD CONSTRAINT chk_total_questions_non_negative 
CHECK (total_questions >= 0);

-- Unique constraints
ALTER TABLE public.questions 
ADD CONSTRAINT unq_paper_question_number 
UNIQUE (paper_id, question_number);

-- Row Level Security policies (optional - for multi-tenant scenarios)
ALTER TABLE public.papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_answers ENABLE ROW LEVEL SECURITY;
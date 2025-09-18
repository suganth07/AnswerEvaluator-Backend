-- CreateTable
CREATE TABLE "public"."admins" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."papers" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "image_url" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admin_id" INTEGER NOT NULL,
    "total_pages" INTEGER NOT NULL DEFAULT 1,
    "question_type" VARCHAR(20) NOT NULL DEFAULT 'traditional',
    "question_types" JSONB DEFAULT '{}',
    "mixed_config" JSONB DEFAULT '{}',

    CONSTRAINT "papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."questions" (
    "id" SERIAL NOT NULL,
    "paper_id" INTEGER NOT NULL,
    "question_number" INTEGER NOT NULL,
    "question_text" TEXT NOT NULL,
    "correct_option" VARCHAR(10),
    "page_number" INTEGER NOT NULL DEFAULT 1,
    "question_type" VARCHAR(20) NOT NULL DEFAULT 'traditional',
    "options" JSONB,
    "blank_positions" JSONB DEFAULT '{}',
    "expected_answers" JSONB DEFAULT '{}',
    "question_format" VARCHAR(50) NOT NULL DEFAULT 'multiple_choice',
    "points_per_blank" INTEGER NOT NULL DEFAULT 1,
    "correct_options" JSONB,
    "weightages" JSONB,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."student_submissions" (
    "id" SERIAL NOT NULL,
    "paper_id" INTEGER NOT NULL,
    "student_name" VARCHAR(100) NOT NULL,
    "image_url" TEXT NOT NULL,
    "score" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "total_questions" INTEGER NOT NULL DEFAULT 0,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answer_types" JSONB DEFAULT '{}',
    "evaluation_method" VARCHAR(100) NOT NULL DEFAULT 'auto',

    CONSTRAINT "student_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."student_answers" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "question_number" INTEGER NOT NULL,
    "selected_option" VARCHAR(10),
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "text_answer" TEXT,
    "blank_answers" JSONB DEFAULT '{}',
    "answer_type" VARCHAR(20) NOT NULL DEFAULT 'mcq',
    "selected_options" JSONB,

    CONSTRAINT "student_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "public"."admins"("username");

-- AddForeignKey
ALTER TABLE "public"."papers" ADD CONSTRAINT "papers_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."questions" ADD CONSTRAINT "questions_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."student_submissions" ADD CONSTRAINT "student_submissions_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."student_answers" ADD CONSTRAINT "student_answers_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."student_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

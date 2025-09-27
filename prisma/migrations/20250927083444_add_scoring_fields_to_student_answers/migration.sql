-- AlterTable
ALTER TABLE "public"."student_answers" ADD COLUMN     "details" TEXT,
ADD COLUMN     "max_points" DECIMAL(5,2) DEFAULT 1,
ADD COLUMN     "partial_score" DECIMAL(5,2) DEFAULT 0,
ADD COLUMN     "weightage_breakdown" JSONB;

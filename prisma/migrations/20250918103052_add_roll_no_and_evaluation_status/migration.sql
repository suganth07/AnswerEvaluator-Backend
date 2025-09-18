/*
  Warnings:

  - You are about to drop the column `correct_option` on the `questions` table. All the data in the column will be lost.
  - Made the column `correct_options` on table `questions` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `roll_no` to the `student_submissions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."questions" DROP COLUMN "correct_option",
ALTER COLUMN "correct_options" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."student_submissions" ADD COLUMN     "evaluation_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
ADD COLUMN     "roll_no" VARCHAR(20) NOT NULL;

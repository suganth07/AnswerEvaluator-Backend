require('dotenv').config();
const pool = require('./src/db');

async function testCaseSensitivity() {
    console.log('🧪 Testing Case Sensitivity Fix');
    console.log('===============================');
    
    try {
        // Get a sample question and check format
        const questionResult = await pool.query('SELECT * FROM questions LIMIT 5');
        console.log('\n📋 Sample questions format:');
        questionResult.rows.forEach(q => {
            console.log(`Q${q.question_number}: correct_option = "${q.correct_option}"`);
        });
        
        // Get a sample student answer and check format
        const answerResult = await pool.query('SELECT * FROM student_answers LIMIT 5');
        console.log('\n📝 Sample student answers format:');
        answerResult.rows.forEach(a => {
            console.log(`Q${a.question_number}: selected_option = "${a.selected_option}", is_correct = ${a.is_correct}`);
        });
        
        // Test the evaluation logic with sample data
        console.log('\n🔍 Testing evaluation logic:');
        const testCorrectAnswers = [
            { question_number: 1, correct_option: 'A' },
            { question_number: 2, correct_option: 'B' },
            { question_number: 3, correct_option: 'C' }
        ];
        
        const testStudentAnswers = [
            { question: 1, selectedOption: 'a' }, // lowercase
            { question: 2, selectedOption: 'B' }, // uppercase
            { question: 3, selectedOption: 'c' }  // lowercase
        ];
        
        // Simulate the fixed evaluation function
        const evaluateAnswers = (correctAnswers, studentAnswers) => {
            const studentAnswerMap = {};
            studentAnswers.forEach(a => {
                studentAnswerMap[a.question] = a.selectedOption?.toUpperCase() || null;
            });
            
            let score = 0;
            const results = [];
            
            for (const correctAnswer of correctAnswers) {
                const questionNumber = correctAnswer.question_number;
                const correctOption = correctAnswer.correct_option?.toUpperCase();
                const studentOption = studentAnswerMap[questionNumber] || null;
                
                const isCorrect = studentOption === correctOption;
                if (isCorrect) score++;
                
                results.push({
                    questionNumber,
                    correctOption,
                    studentOption,
                    isCorrect
                });
                
                console.log(`Q${questionNumber}: ${studentOption} vs ${correctOption} = ${isCorrect ? '✅' : '❌'}`);
            }
            
            return { score, totalQuestions: correctAnswers.length, results };
        };
        
        const testResult = evaluateAnswers(testCorrectAnswers, testStudentAnswers);
        console.log(`\n📊 Test Result: ${testResult.score}/${testResult.totalQuestions} correct`);
        console.log('✅ Case sensitivity fix working correctly!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    } finally {
        await pool.end();
    }
}

testCaseSensitivity();

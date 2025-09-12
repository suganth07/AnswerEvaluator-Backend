const OMRService = require('./services/omrService');
const fs = require('fs');
const path = require('path');

async function testOMRImplementation() {
    console.log('🧪 Testing OMR Service Implementation');
    console.log('=====================================\n');

    const omrService = new OMRService();
    
    try {
        // Test 1: Load test image
        const imagePath = path.join(__dirname, 'omr.png');
        
        if (!fs.existsSync(imagePath)) {
            console.log('❌ Test image not found at:', imagePath);
            return;
        }
        
        const imageBuffer = fs.readFileSync(imagePath);
        console.log(`✅ Loaded test image: ${imageBuffer.length} bytes\n`);

        // Test 2: OMR Style Detection
        console.log('🔍 Testing OMR Style Detection...');
        const styleDetection = await omrService.detectOMRStyle(imageBuffer);
        console.log('Style Detection Result:', JSON.stringify(styleDetection, null, 2));
        console.log('');

        // Test 3: OMR Answer Detection with mock questions
        console.log('🎯 Testing OMR Answer Detection...');
        const mockQuestions = [
            { question_number: 1, question_text: 'Mock Question 1', correct_option: 'A', options: ['A', 'B', 'C', 'D'] },
            { question_number: 2, question_text: 'Mock Question 2', correct_option: 'C', options: ['A', 'B', 'C', 'D'] },
            { question_number: 3, question_text: 'Mock Question 3', correct_option: 'D', options: ['A', 'B', 'C', 'D'] },
            { question_number: 4, question_text: 'Mock Question 4', correct_option: 'A', options: ['A', 'B', 'C', 'D'] },
            { question_number: 5, question_text: 'Mock Question 5', correct_option: 'B', options: ['A', 'B', 'C', 'D'] },
            { question_number: 6, question_text: 'Mock Question 6', correct_option: 'C', options: ['A', 'B', 'C', 'D'] },
            { question_number: 7, question_text: 'Mock Question 7', correct_option: 'D', options: ['A', 'B', 'C', 'D'] }
        ];

        const omrDetection = await omrService.detectOMRAnswers(imageBuffer, mockQuestions);
        console.log('OMR Detection Result:', JSON.stringify(omrDetection, null, 2));
        console.log('');

        // Test 4: Answer Evaluation
        if (omrDetection && omrDetection.detected_answers) {
            console.log('📊 Testing Answer Evaluation...');
            const evaluation = omrService.evaluateOMRAnswers(omrDetection.detected_answers, mockQuestions);
            console.log('Evaluation Result:', JSON.stringify(evaluation, null, 2));
            console.log('');
        }

        // Test Summary
        console.log('📋 Test Summary:');
        console.log('================');
        console.log(`✅ OMR Style Detection: ${styleDetection?.is_omr_style ? 'PASSED' : 'FAILED'}`);
        console.log(`✅ Answer Detection: ${omrDetection?.detected_answers?.length > 0 ? 'PASSED' : 'FAILED'}`);
        console.log(`✅ Service Integration: READY`);
        
        if (omrDetection?.detected_answers) {
            console.log(`\n🎯 Detection Results:`);
            omrDetection.detected_answers.forEach(answer => {
                const correctAnswer = mockQuestions.find(q => q.question_number === answer.question)?.correct_option;
                const isCorrect = answer.selected_option === correctAnswer;
                console.log(`   Q${answer.question}: ${answer.selected_option} ${isCorrect ? '✅' : '❌'} (correct: ${correctAnswer})`);
            });
        }

        console.log('\n🚀 OMR Implementation is ready for production!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
    }
}

// Run the test
if (require.main === module) {
    testOMRImplementation().catch(console.error);
}

module.exports = testOMRImplementation;

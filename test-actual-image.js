require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

async function testWithActualImage() {
    try {
        console.log('🔍 Testing with Actual OMR Image');
        console.log('================================');
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const imagePath = path.join(__dirname, 'smp.jpg');
        
        if (!fs.existsSync(imagePath)) {
            console.log('❌ Image file not found:', imagePath);
            return;
        }
        
        const imageBuffer = fs.readFileSync(imagePath);
        const imageBase64 = imageBuffer.toString('base64');
        
        console.log('📄 Image loaded:', path.basename(imagePath));
        console.log('📊 Image size:', imageBuffer.length, 'bytes');
        
        const prompt = "What do you see in this image? Please describe it briefly.";
        
        const imagePart = {
            inlineData: {
                data: imageBase64,
                mimeType: 'image/jpeg'
            }
        };
        
        console.log('🤖 Sending request to Gemini...');
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();
        
        console.log('✅ Success! Gemini can process the image');
        console.log('Response:', text);
        
    } catch (error) {
        console.log('❌ Test failed:');
        console.log('Error message:', error.message);
        console.log('Error stack:', error.stack);
        
        if (error.message.includes('API key not valid')) {
            console.log('\n💡 Solutions:');
            console.log('1. Get a new API key from https://aistudio.google.com/app/apikey');
            console.log('2. Make sure the API key has vision capabilities enabled');
            console.log('3. Check if there are any usage limits or billing issues');
        }
    }
}

testWithActualImage();

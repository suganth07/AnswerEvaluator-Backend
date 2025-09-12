require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

async function testVisionCapabilities() {
    try {
        console.log('🔍 Testing Gemini Vision Capabilities');
        console.log('====================================');
        
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // Create a simple test image (1x1 pixel PNG)
        const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9/xGcjgAAAABJRU5ErkJggg==';
        
        const prompt = "What do you see in this image? Just respond with 'I can see an image'.";
        
        const imagePart = {
            inlineData: {
                data: testImageBase64,
                mimeType: 'image/png'
            }
        };
        
        console.log('🤖 Testing with a simple test image...');
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text();
        
        console.log('✅ Vision test successful!');
        console.log('Response:', text);
        
        // Now test with the actual OMR image
        console.log('\n📄 Testing with actual OMR image...');
        const imagePath = path.join(__dirname, 'smp.jpg');
        
        if (fs.existsSync(imagePath)) {
            const imageBuffer = fs.readFileSync(imagePath);
            const imageBase64 = imageBuffer.toString('base64');
            
            const omrPrompt = "Describe what you see in this image in one sentence.";
            const omrImagePart = {
                inlineData: {
                    data: imageBase64,
                    mimeType: 'image/jpeg'
                }
            };
            
            const omrResult = await model.generateContent([omrPrompt, omrImagePart]);
            const omrResponse = await omrResult.response;
            const omrText = omrResponse.text();
            
            console.log('✅ OMR image test successful!');
            console.log('Response:', omrText);
            
        } else {
            console.log('❌ OMR image file not found:', imagePath);
        }
        
    } catch (error) {
        console.log('❌ Vision test failed:');
        console.log('Error:', error.message);
        
        if (error.message.includes('API key not valid')) {
            console.log('\n💡 Your API key might not have vision capabilities enabled');
            console.log('💡 Try creating a new API key at https://aistudio.google.com/app/apikey');
        }
    }
}

testVisionCapabilities();

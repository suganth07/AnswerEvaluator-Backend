require('dotenv').config();

console.log('🔑 Testing Gemini API Key Configuration');
console.log('=====================================');

// Check if .env is loaded
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('Current working directory:', process.cwd());

// Check API key
const apiKey = process.env.GEMINI_API_KEY;
console.log('API Key loaded:', apiKey ? 'Yes' : 'No');
console.log('API Key length:', apiKey ? apiKey.length : 0);
console.log('API Key preview:', apiKey ? `${apiKey.substring(0, 10)}...` : 'Not found');

// Test basic connection (without image)
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testBasicConnection() {
    try {
        console.log('\n🧪 Testing basic Gemini connection...');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const result = await model.generateContent("Hello, can you respond with just 'API key is working'?");
        const response = await result.response;
        const text = response.text();
        
        console.log('✅ Basic connection test successful!');
        console.log('Response:', text);
        
    } catch (error) {
        console.log('❌ Basic connection test failed:');
        console.log('Error:', error.message);
        
        if (error.message.includes('API key not valid')) {
            console.log('\n💡 Solution: Get a new API key from https://aistudio.google.com/app/apikey');
        }
    }
}

if (apiKey) {
    testBasicConnection();
} else {
    console.log('\n❌ No API key found in environment variables');
    console.log('💡 Make sure GEMINI_API_KEY is set in your .env file');
}

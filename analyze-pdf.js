const fs = require('fs');
const path = require('path');

async function analyzePDFStructure() {
  try {
    console.log('🔍 Deep PDF analysis...');
    
    const pdfPath = path.join(__dirname, '..', 'sample.pdf');
    const pdfBuffer = fs.readFileSync(pdfPath);
    
    // Try using the PDFParse class with different options
    const { PDFParse } = require('pdf-parse');
    
    // Test with different parsing options
    console.log('\n1. Testing with basic options...');
    const parser1 = new PDFParse({ data: pdfBuffer });
    const result1 = await parser1.getText();
    console.log('Basic text result:', JSON.stringify(result1.text, null, 2));
    
    // Test getting info
    console.log('\n2. Testing PDF info extraction...');
    const parser2 = new PDFParse({ data: pdfBuffer });
    const info = await parser2.getInfo();
    console.log('PDF Info:', JSON.stringify(info, null, 2));
    
    // Test getting images (if any)
    console.log('\n3. Testing image extraction...');
    const parser3 = new PDFParse({ data: pdfBuffer });
    try {
      const images = await parser3.getImage();
      console.log('Found images:', images.pages.length);
      images.pages.forEach((page, index) => {
        console.log(`Page ${index + 1}: ${page.images.length} images`);
      });
    } catch (imageError) {
      console.log('Image extraction failed:', imageError.message);
    }
    
    // Check raw PDF content for form fields or other structures
    console.log('\n4. Analyzing raw PDF structure...');
    const pdfText = pdfBuffer.toString('binary');
    
    // Look for common PDF form field indicators
    const formPatterns = [
      /\/T\s*\(/g, // Field names
      /\/V\s*\(/g, // Field values
      /\/Ff\s+/g,  // Field flags
      /\/FT\s+/g,  // Field types
    ];
    
    let hasFormFields = false;
    formPatterns.forEach((pattern, index) => {
      const matches = pdfText.match(pattern);
      if (matches) {
        console.log(`Found form pattern ${index + 1}: ${matches.length} matches`);
        hasFormFields = true;
      }
    });
    
    if (!hasFormFields) {
      console.log('No form fields detected');
    }
    
    // Look for text content that might be encoded differently
    console.log('\n5. Searching for text content patterns...');
    const textPatterns = [
      /BT.*?ET/gs, // Text objects
      /Tj\s*$/gm,  // Text showing operators
      /TJ\s*$/gm,  // Text showing with spacing
    ];
    
    textPatterns.forEach((pattern, index) => {
      const matches = pdfText.match(pattern);
      if (matches) {
        console.log(`Found text pattern ${index + 1}: ${matches.length} matches`);
        if (matches.length < 10) { // Only show if not too many
          matches.forEach(match => {
            console.log(`  Content: ${match.substring(0, 100)}...`);
          });
        }
      }
    });
    
    // Check if PDF contains streams that might have image data
    console.log('\n6. Checking for image streams...');
    const streamPattern = /stream[\s\S]*?endstream/g;
    const streams = pdfText.match(streamPattern);
    if (streams) {
      console.log(`Found ${streams.length} streams (might contain images)`);
      
      // Check for image-specific indicators
      const imageIndicators = [
        /\/Subtype\s*\/Image/g,
        /\/Filter\s*\/DCTDecode/g, // JPEG
        /\/Filter\s*\/FlateDecode/g, // PNG/deflate
      ];
      
      imageIndicators.forEach((pattern, index) => {
        const matches = pdfText.match(pattern);
        if (matches) {
          console.log(`Found image indicator ${index + 1}: ${matches.length} matches`);
        }
      });
    }
    
    console.log('\n📋 Analysis Summary:');
    console.log('- PDF is valid and has 2 pages');
    console.log('- Text extraction yields minimal content (only page markers)');
    console.log('- This suggests the content is likely image-based');
    console.log('- Roll numbers and answers are probably in image format');
    console.log('- OCR would be needed to extract the actual content');
    
    console.log('\n💡 Recommendations:');
    console.log('1. Install ImageMagick/GraphicsMagick for image conversion');
    console.log('2. Use OCR service (like Tesseract) to extract text from images');
    console.log('3. Or provide a PDF with text-based content for testing');
    
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    console.error(error.stack);
  }
}

analyzePDFStructure().catch(console.error);
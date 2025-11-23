const pdf2pic = require('pdf2pic');
const { PDFParse } = require('pdf-parse');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

class PDFService {
  constructor() {
    this.tempDir = path.join(os.tmpdir(), 'pdf-processing');
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    this.ensureTempDir();
  }

  async ensureTempDir() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create temp directory:', error);
    }
  }

  /**
   * Get PDF information and validate
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<Object>} PDF information
   */
  async getPDFInfo(pdfBuffer) {
    try {
      console.log('🔍 Analyzing PDF buffer...', { size: pdfBuffer.length });
      
      // Create PDFParse instance
      const parser = new PDFParse({ data: pdfBuffer });
      
      // Extract text content
      const result = await parser.getText();
      
      console.log('📄 PDF parsed successfully:', {
        pages: result.total,
        textLength: result.text ? result.text.length : 0
      });
      
      return {
        isValid: true,
        pages: result.total,
        fileSize: pdfBuffer.length,
        wordCount: result.text ? result.text.split(' ').length : 0,
        text: result.text || ''
      };
    } catch (error) {
      console.error('❌ PDF parsing failed:', error.message);
      return {
        isValid: false,
        error: error.message,
        fileSize: pdfBuffer.length
      };
    }
  }

  /**
   * Extract pages from PDF as images
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @param {Object} options - Conversion options
   * @returns {Promise<Array>} Array of image buffers
   */
  async extractPagesAsImages(pdfBuffer, options = {}) {
    try {
      const defaultOptions = {
        density: 400, // Higher DPI for better checkmark detection
        format: 'png',
        width: 3300, // Higher resolution for better quality
        height: 4677, // A4 height at 400 DPI  
        quality: 95 // Higher quality for clearer marks
      };

      const convertOptions = { ...defaultOptions, ...options };
      
      // Create unique filename for this PDF
      const timestamp = Date.now();
      const pdfPath = path.join(this.tempDir, `temp_${timestamp}.pdf`);
      
      // Save PDF buffer to temp file
      await fs.writeFile(pdfPath, pdfBuffer);
      
      console.log(`📄 Processing PDF: ${pdfPath}`);
      
      // Convert PDF pages to images
      const convert = pdf2pic.fromPath(pdfPath, convertOptions);
      
      // Get total number of pages first
      const parser = new PDFParse({ data: pdfBuffer });
      const textResult = await parser.getText();
      const totalPages = textResult.total;
      
      console.log(`📊 PDF has ${totalPages} pages`);
      
      const imageBuffers = [];
      
      // Convert each page
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        console.log(`🔄 Converting page ${pageNum}/${totalPages}`);
        
        const result = await convert(pageNum);
        const imagePath = result.path;
        
        // Read the generated image
        const imageBuffer = await fs.readFile(imagePath);
        
        // Optimize image using sharp for better OCR
        const optimizedBuffer = await sharp(imageBuffer)
          .png({ quality: 95, compressionLevel: 6 })
          .resize(3300, 4677, { 
            fit: 'inside',
            withoutEnlargement: true
          })
          .sharpen() // Enhance edges for better mark detection
          .normalise() // Improve contrast
          .toBuffer();
        
        imageBuffers.push({
          pageNumber: pageNum,
          buffer: optimizedBuffer,
          originalSize: imageBuffer.length,
          optimizedSize: optimizedBuffer.length
        });
        
        // Clean up temp image file
        try {
          await fs.unlink(imagePath);
        } catch (cleanupError) {
          console.warn(`⚠️ Failed to cleanup temp image: ${imagePath}`);
        }
      }
      
      // Clean up temp PDF file
      try {
        await fs.unlink(pdfPath);
      } catch (cleanupError) {
        console.warn(`⚠️ Failed to cleanup temp PDF: ${pdfPath}`);
      }
      
      console.log(`✅ Extracted ${imageBuffers.length} pages from PDF`);
      return imageBuffers;
      
    } catch (error) {
      console.error('❌ PDF page extraction failed:', error);
      throw new Error(`Failed to extract pages from PDF: ${error.message}`);
    }
  }

  /**
   * Extract text content from PDF using Gemini Vision
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<Object>} Extracted text and metadata
   */
  async extractTextFromPDF(pdfBuffer) {
    try {
      console.log('📝 Extracting text from PDF using Gemini Vision...');
      
      // First try standard text extraction
      const parser = new PDFParse({ data: pdfBuffer });
      const textResult = await parser.getText();
      
      // If we got meaningful text, return it
      if (textResult.text && textResult.text.trim().length > 50) {
        const result = {
          text: textResult.text,
          pages: textResult.total,
          extractionMethod: 'text',
          wordCount: textResult.text.split(' ').length,
          lineCount: textResult.text.split('\n').length
        };
        
        console.log(`📊 Extracted text: ${result.wordCount} words, ${result.lineCount} lines, ${result.pages} pages`);
        return result;
      }
      
      // If text extraction failed, use Gemini for image-based extraction
      console.log('📷 PDF contains images, using Gemini Vision for content extraction...');
      
      try {
        const geminiResult = await this.extractContentWithGemini(pdfBuffer);
        
        return {
          text: geminiResult.extractedContent,
          pages: textResult.total,
          extractionMethod: geminiResult.extractionMethod,
          rollNumber: geminiResult.rollNumber,
          answers: geminiResult.answers,
          wordCount: geminiResult.extractedContent.split(' ').length,
          lineCount: geminiResult.extractedContent.split('\n').length,
          geminiAnalysis: geminiResult
        };
        
      } catch (geminiError) {
        console.log('⚠️ Gemini extraction failed, falling back to basic text extraction');
        console.log('Error details:', geminiError.message);
        
        // Return basic text extraction result even if Gemini fails
        return {
          text: textResult.text || 'Failed to extract text content',
          pages: textResult.total,
          extractionMethod: 'basic_fallback',
          error: geminiError.message,
          wordCount: (textResult.text || '').split(' ').length,
          lineCount: (textResult.text || '').split('\n').length
        };
      }
      
    } catch (error) {
      console.error('❌ PDF text extraction failed:', error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }

  /**
   * Extract content from PDF using Gemini Vision API
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @returns {Promise<Object>} Extracted content, roll number and answers
   */
  async extractContentWithGemini(pdfBuffer) {
    try {
      console.log('🤖 Using Gemini Vision to analyze PDF content...');
      
      // Convert PDF to base64 for Gemini
      const pdfBase64 = pdfBuffer.toString('base64');
      
      const prompt = `
        Analyze this student answer sheet PDF and extract the roll number and marked answers.

        ROLL NUMBER EXTRACTION (HIGHEST PRIORITY):
        The roll number is typically found at the top of the first page in boxes or fields labeled "Roll No", "Roll Number", "Student ID", or similar.
        It may be written in separate boxes (one digit per box) or in a single field.

        Look for:
        1. Boxes at the top of the page with digits
        2. Fields labeled "Roll No", "Roll Number", "Student ID"
        3. Student information section at the top
        4. Any numeric identifier that appears to be a roll number
        
        ANSWER DETECTION:
        - Scan ALL pages to find question numbers and their marked options
        - Look for checkmarks (✓, ✔, √), circles, filled bubbles, crosses, or any markings
        - Questions may be numbered 1-10, 1-20, Q1-Q10, etc.
        - Options are typically (a), (b), (c), (d) or A, B, C, D

        Return ONLY a JSON object with this exact format:
        {
          "rollNumber": "XX",
          "extractedContent": "Description of what was found",
          "answers": [
            {
              "question": 1,
              "selectedOption": "a",
              "selectedOptions": ["a"],
              "confidence": "high",
              "markType": "checkmark",
              "pageNumber": 1
            }
          ],
          "totalPages": 2,
          "questionCount": 20,
          "extractionMethod": "gemini_vision_pdf",
          "confidence": "high",
          "rollNumberLocation": "description of where roll number was found"
        }

        If no roll number is found, use "unknown" for rollNumber.
        Extract only the actual digits/numbers for roll number, without any labels.
      `;
      
      const imagePart = {
        inlineData: {
          data: pdfBase64,
          mimeType: 'application/pdf'
        }
      };
      
      console.log('📤 Sending PDF to Gemini for analysis...');
      
      // Add retry logic for rate limiting
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          const result = await this.model.generateContent([prompt, imagePart]);
          const response = await result.response;
          let text = response.text();
          
          // Clean up the response to extract JSON
          text = text.replace(/```json/g, '').replace(/```/g, '').trim();
          
          try {
            const parsedData = JSON.parse(text);
            console.log(`✅ Gemini extracted: Roll: ${parsedData.rollNumber}, Answers: ${parsedData.answers ? parsedData.answers.length : 0}`);
            
            return parsedData;
          } catch (parseError) {
            console.error('❌ Failed to parse Gemini response:', parseError);
            console.log('Raw Gemini response:', text);
            
            // Return a fallback structure with the raw text
            return {
              rollNumber: "unknown",
              extractedContent: text || "Failed to extract content",
              answers: [],
              questionCount: 0,
              extractionMethod: "gemini_vision_fallback",
              confidence: "low",
              rawResponse: text
            };
          }
          
        } catch (apiError) {
          attempts++;
          
          if (apiError.status === 429 && attempts < maxAttempts) {
            console.log(`⏳ Rate limit hit, waiting 30 seconds... (attempt ${attempts}/${maxAttempts})`);
            await new Promise(resolve => setTimeout(resolve, 30000));
            continue;
          }
          
          throw apiError;
        }
      }
      
    } catch (error) {
      console.error('❌ Gemini content extraction failed:', error);
      
      // If it's a quota/rate limit error, provide helpful guidance
      if (error.status === 429) {
        console.log('💡 Gemini API quota exceeded. The PDF processing will continue with basic text extraction.');
        console.log('💡 To enable full image analysis, check your Gemini API quota at: https://ai.dev/usage');
        
        return {
          rollNumber: "unknown",
          extractedContent: "Gemini API quota exceeded - using basic extraction",
          answers: [],
          questionCount: 0,
          extractionMethod: "quota_limited",
          confidence: "low",
          error: "API quota exceeded"
        };
      }
      
      throw new Error(`Gemini extraction failed: ${error.message}`);
    }
  }

  /**
   * Process PDF for answer sheet evaluation
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processed PDF data ready for evaluation
   */
  async processPDFForEvaluation(pdfBuffer, options = {}) {
    try {
      console.log('🔄 Processing PDF for evaluation...');
      
      // Extract both images and text
      const [imagePages, textContent] = await Promise.all([
        this.extractPagesAsImages(pdfBuffer, options.imageOptions),
        this.extractTextFromPDF(pdfBuffer)
      ]);
      
      // Combine image and text data for each page
      const processedPages = imagePages.map((imagePage, index) => ({
        pageNumber: imagePage.pageNumber,
        imageBuffer: imagePage.buffer,
        imageSize: {
          original: imagePage.originalSize,
          optimized: imagePage.optimizedSize
        },
        // For now, we'll rely on OCR from the image rather than extracted text
        // because PDF text extraction may not preserve the spatial relationship
        // needed for answer detection
        textContent: textContent.text, // Full text for reference
        processingTime: Date.now()
      }));
      
      return {
        success: true,
        totalPages: processedPages.length,
        pages: processedPages,
        pdfInfo: {
          wordCount: textContent.wordCount,
          lineCount: textContent.lineCount,
          metadata: textContent.metadata
        },
        processingTimestamp: Date.now()
      };
      
    } catch (error) {
      console.error('❌ PDF evaluation processing failed:', error);
      return {
        success: false,
        error: error.message,
        totalPages: 0,
        pages: []
      };
    }
  }

  /**
   * Process multiple PDFs (bulk upload)
   * @param {Array<Buffer>} pdfBuffers - Array of PDF file buffers
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} Array of processed PDF results
   */
  async processBulkPDFs(pdfBuffers, options = {}) {
    try {
      console.log(`🔄 Processing ${pdfBuffers.length} PDFs in bulk...`);
      
      const results = [];
      
      for (let i = 0; i < pdfBuffers.length; i++) {
        const pdfBuffer = pdfBuffers[i];
        console.log(`📄 Processing PDF ${i + 1}/${pdfBuffers.length}`);
        
        const result = await this.processPDFForEvaluation(pdfBuffer, options);
        results.push({
          pdfIndex: i + 1,
          ...result
        });
      }
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      console.log(`✅ Bulk processing completed: ${successful} successful, ${failed} failed`);
      
      return {
        success: true,
        totalPDFs: pdfBuffers.length,
        successful,
        failed,
        results
      };
      
    } catch (error) {
      console.error('❌ Bulk PDF processing failed:', error);
      return {
        success: false,
        error: error.message,
        results: []
      };
    }
  }

  /**
   * Extract page count from PDF text or info
   * @param {string} text - PDF text content
   * @returns {number} Number of pages
   */
  extractPageCount(text) {
    // Try to count pages by looking for page breaks or form feeds
    const pageBreaks = (text.match(/\f/g) || []).length;
    return pageBreaks > 0 ? pageBreaks + 1 : 1;
  }

  /**
   * Validate PDF file
   * @param {Buffer} buffer - File buffer
   * @returns {boolean} True if valid PDF
   */
  isValidPDF(buffer) {
    // Check PDF header
    const pdfHeader = buffer.slice(0, 4).toString();
    return pdfHeader === '%PDF';
  }

  /**
   * Clean up temp files (call periodically)
   */
  async cleanupTempFiles() {
    try {
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();
      const maxAge = 60 * 60 * 1000; // 1 hour
      
      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stat = await fs.stat(filePath);
        
        if (now - stat.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          console.log(`🧹 Cleaned up old temp file: ${file}`);
        }
      }
    } catch (error) {
      console.warn('⚠️ Temp file cleanup failed:', error);
    }
  }
}

module.exports = new PDFService();
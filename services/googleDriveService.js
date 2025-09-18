const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');
require('dotenv').config();

class GoogleDriveService {
  constructor() {
    this.accessToken = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
    this.refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    this.clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    
    if (!this.accessToken) {
      console.warn('⚠️  Google Drive OAuth2 access token not found in environment variables');
      console.log('📝 Please add GOOGLE_DRIVE_ACCESS_TOKEN to your .env file');
    } else {
      console.log('✅ Google Drive OAuth2 service initialized successfully');
    }
  }

  async refreshAccessToken() {
    try {
      if (!this.refreshToken || !this.clientId || !this.clientSecret) {
        throw new Error('Missing OAuth2 credentials for token refresh');
      }

      console.log('🔄 Refreshing Google OAuth2 access token...');

      const params = new URLSearchParams();
      params.append('client_id', this.clientId);
      params.append('client_secret', this.clientSecret);
      params.append('refresh_token', this.refreshToken);
      params.append('grant_type', 'refresh_token');

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to refresh access token: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      // Update the access token in memory
      this.accessToken = data.access_token;
      process.env.GOOGLE_DRIVE_ACCESS_TOKEN = data.access_token;
      
      console.log('✅ Successfully refreshed Google OAuth2 access token');
      return data.access_token;

    } catch (error) {
      console.error('❌ Error refreshing access token:', error);
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  async ensureValidToken() {
    try {
      // Test current token with a simple API call
      if (!this.accessToken) {
        throw new Error('No access token available');
      }

      const testResponse = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (testResponse.status === 401) {
        console.log('🔑 Access token expired, refreshing...');
        await this.refreshAccessToken();
      } else if (!testResponse.ok) {
        throw new Error(`Token validation failed: ${testResponse.status}`);
      } else {
        console.log('✅ Access token is valid');
      }
    } catch (error) {
      console.log('🔑 Token validation failed, attempting refresh...');
      await this.refreshAccessToken();
    }
  }

  async makeAuthenticatedRequest(url, options, retryOnAuth = true) {
    try {
      console.log(`🌐 Making request to: ${url.substring(0, 80)}...`);
      
      // First attempt with current token
      let response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${this.accessToken}`,
        }
      });

      console.log(`📡 Initial response status: ${response.status}`);

      // If we get 401 and haven't tried refreshing yet, refresh and retry
      if (response.status === 401 && retryOnAuth) {
        console.log('🔑 Access token expired, attempting to refresh...');
        
        try {
          await this.refreshAccessToken();
          console.log('🔄 Token refreshed, retrying request...');
          
          // Retry with new token
          response = await fetch(url, {
            ...options,
            headers: {
              ...options.headers,
              Authorization: `Bearer ${this.accessToken}`,
            }
          });
          
          console.log(`📡 Retry response status: ${response.status}`);
          
          if (response.status === 401) {
            throw new Error('Authentication failed even after token refresh. Please check your OAuth2 credentials.');
          }
          
        } catch (refreshError) {
          console.error('❌ Token refresh error:', refreshError.message);
          throw new Error(`Token refresh failed: ${refreshError.message}. Please try again or check your OAuth2 setup.`);
        }
      }

      return response;
    } catch (error) {
      console.error('❌ Request error:', error.message);
      throw error;
    }
  }

  async uploadTempAnswerSheet(imageBuffer, originalFileName, studentName, rollNo = '') {
    if (!this.accessToken) {
      throw new Error('Google Drive access token not configured');
    }

    try {
      // Create temporary filename with PENDING_ format
      // Safely handle studentName and rollNo - use defaults if undefined or null
      const safeName = studentName || 'anonymous';
      const safeRollNo = rollNo || 'unknown';
      const sanitizedStudentName = safeName.replace(/[^a-zA-Z0-9]/g, '_');
      const sanitizedRollNo = safeRollNo.replace(/[^a-zA-Z0-9]/g, '_');
      const fileExtension = path.extname(originalFileName) || '.jpg';
      const tempFileName = `PENDING_${sanitizedStudentName}_Roll_${sanitizedRollNo}${fileExtension}`;

      console.log(`📤 Uploading temporary file to Google Drive: ${tempFileName}`);
      console.log(`📊 Upload details: File size: ${imageBuffer.length} bytes, Folder ID: ${this.folderId}`);

      // Function to create form data (needed for retry logic)
      const createFormData = () => {
        const form = new FormData();
        form.append(
          'metadata',
          JSON.stringify({
            name: tempFileName,
            parents: [this.folderId],
          }),
          { contentType: 'application/json' }
        );
        form.append('file', imageBuffer, {
          filename: tempFileName,
          contentType: 'image/jpeg',
        });
        return form;
      };

      // Try upload with current token
      let form = createFormData();
      let response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            ...form.getHeaders(),
          },
          body: form,
        }
      );

      console.log(`📡 Initial response status: ${response.status}`);

      // If token expired, refresh and retry with new FormData
      if (response.status === 401) {
        console.log('🔑 Access token expired, attempting to refresh...');
        
        try {
          await this.refreshAccessToken();
          console.log('🔄 Token refreshed, retrying upload with new form data...');
          
          // Create new FormData for retry (important!)
          form = createFormData();
          
          response = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${this.accessToken}`,
                ...form.getHeaders(),
              },
              body: form,
            }
          );
          
          console.log(`📡 Retry response status: ${response.status}`);
          
        } catch (refreshError) {
          console.error('❌ Token refresh error:', refreshError.message);
          throw new Error(`Token refresh failed: ${refreshError.message}. Please try again.`);
        }
      }

      console.log(`📈 Upload response received with status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Google Drive API Error:', response.status, errorText);
        
        if (response.status === 401) {
          throw new Error('Authentication failed. Please try again - your session may have expired.');
        }
        
        throw new Error(`Google Drive upload failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      console.log(`✅ Upload successful! Processing response data...`);
      
      console.log('✅ Temporary file uploaded successfully to Google Drive');
      console.log(`📄 Temp File Name: ${data.name}`);
      console.log(`🆔 File ID: ${data.id}`);

      return {
        success: true,
        fileId: data.id,
        fileName: data.name,
        webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}`,
        message: 'Temporary answer sheet uploaded successfully to Google Drive'
      };

    } catch (error) {
      console.error('❌ Error uploading temporary file to Google Drive:', error);
      
      // Check if it's an authentication error and provide user-friendly message
      if (error.message.includes('Token refresh failed') || error.message.includes('Authentication failed')) {
        throw new Error('Authentication session expired. Please try submitting your answer sheet again.');
      }
      
      throw new Error(`Failed to upload temporary file to Google Drive: ${error.message}`);
    }
  }

  async renameFileInDrive(fileId, newFileName) {
    if (!this.accessToken) {
      throw new Error('Google Drive access token not configured');
    }

    try {
      console.log(`🔄 Renaming file in Google Drive to: ${newFileName}`);

      const response = await this.makeAuthenticatedRequest(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: newFileName
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Google Drive rename error:', response.status, errorText);
        
        if (response.status === 401) {
          throw new Error('Authentication failed. Please try again - your session may have expired.');
        }
        
        throw new Error(`Failed to rename file: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      console.log('✅ File renamed successfully in Google Drive');
      console.log(`📄 New File Name: ${data.name}`);

      return {
        success: true,
        fileId: data.id,
        fileName: data.name,
        message: 'File renamed successfully in Google Drive'
      };

    } catch (error) {
      console.error('❌ Error renaming file in Google Drive:', error);
      
      // Check if it's an authentication error and provide user-friendly message
      if (error.message.includes('Token refresh failed') || error.message.includes('Authentication failed')) {
        throw new Error('Authentication session expired. Please try again.');
      }
      
      throw new Error(`Failed to rename file in Google Drive: ${error.message}`);
    }
  }

  // Legacy method kept for backward compatibility
  async uploadAnswerSheetFromBuffer(imageBuffer, originalFileName, studentName, paperName, marksObtained, totalMarks) {
    if (!this.accessToken) {
      throw new Error('Google Drive access token not configured');
    }

    try {
      // Create filename in format: {studentname}-{selectedquestionpapername}-{markobtained}
      const sanitizedStudentName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
      const sanitizedPaperName = paperName.replace(/[^a-zA-Z0-9]/g, '_');
      const fileExtension = path.extname(originalFileName) || '.jpg';
      const fileName = `${sanitizedStudentName}-${sanitizedPaperName}-${marksObtained}of${totalMarks}${fileExtension}`;

      console.log(`📤 Uploading to Google Drive from buffer: ${fileName}`);

      // Create form data for multipart upload
      const form = new FormData();
      form.append(
        'metadata',
        JSON.stringify({
          name: fileName,
          parents: [this.folderId],
        }),
        { contentType: 'application/json' }
      );
      form.append('file', imageBuffer, {
        filename: fileName,
        contentType: 'image/jpeg',
      });

      // Upload to Google Drive using OAuth2 with auto-refresh
      const response = await this.makeAuthenticatedRequest(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        {
          method: 'POST',
          headers: {
            ...form.getHeaders(),
          },
          body: form,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Google Drive API Error:', response.status, errorText);
        throw new Error(`Google Drive upload failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      console.log('✅ File uploaded successfully to Google Drive');
      console.log(`📄 File Name: ${data.name}`);
      console.log(`🔗 File Link: https://drive.google.com/file/d/${data.id}`);

      return {
        success: true,
        fileId: data.id,
        fileName: data.name,
        webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}`,
        message: 'Answer sheet uploaded successfully to Google Drive'
      };

    } catch (error) {
      console.error('❌ Error uploading to Google Drive:', error);
      throw new Error(`Failed to upload to Google Drive: ${error.message}`);
    }
  }

  // Legacy method kept for backward compatibility  
  async uploadAnswerSheet(filePath, studentName, paperName, marksObtained, totalMarks) {
    if (!this.accessToken) {
      throw new Error('Google Drive access token not configured');
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    try {
      // Create filename in format: {studentname}-{selectedquestionpapername}-{markobtained}
      const sanitizedStudentName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
      const sanitizedPaperName = paperName.replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `${sanitizedStudentName}-${sanitizedPaperName}-${marksObtained}of${totalMarks}.jpg`;

      console.log(`📤 Uploading to Google Drive: ${fileName}`);

      // Create form data for multipart upload
      const form = new FormData();
      form.append(
        'metadata',
        JSON.stringify({
          name: fileName,
          parents: [this.folderId],
        }),
        { contentType: 'application/json' }
      );
      form.append('file', fs.createReadStream(filePath), {
        filename: fileName,
        contentType: 'image/jpeg',
      });

      // Upload to Google Drive using OAuth2 with auto-refresh
      const response = await this.makeAuthenticatedRequest(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        {
          method: 'POST',
          headers: {
            ...form.getHeaders(),
          },
          body: form,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Google Drive API Error:', response.status, errorText);
        throw new Error(`Google Drive upload failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      console.log('✅ File uploaded successfully to Google Drive');
      console.log(`📄 File Name: ${data.name}`);
      console.log(`🔗 File Link: https://drive.google.com/file/d/${data.id}`);

      // Clean up local file after successful upload
      try {
        fs.unlinkSync(filePath);
        console.log('🗑️ Local file cleaned up');
      } catch (cleanupError) {
        console.warn('⚠️ Failed to cleanup local file:', cleanupError.message);
      }

      return {
        success: true,
        fileId: data.id,
        fileName: data.name,
        webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}`,
        message: 'Answer sheet uploaded successfully to Google Drive'
      };

    } catch (error) {
      console.error('❌ Error uploading to Google Drive:', error);
      
      // Clean up local file even if upload fails
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log('🗑️ Local file cleaned up after error');
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      throw new Error(`Failed to upload to Google Drive: ${error.message}`);
    }
  }

  async uploadFinalAnswerSheet(imageBuffer, studentName, paperName, score, totalQuestions) {
    if (!this.accessToken) {
      throw new Error('Google Drive access token not configured');
    }

    try {
      // Create final filename with score information
      const timestamp = Date.now();
      const safeName = studentName || 'anonymous';
      const sanitizedStudentName = safeName.replace(/[^a-zA-Z0-9]/g, '_');
      const sanitizedPaperName = paperName.replace(/[^a-zA-Z0-9]/g, '_');
      const percentage = Math.round((score / totalQuestions) * 100);
      const finalFileName = `${sanitizedStudentName}_${sanitizedPaperName}_Score${score}of${totalQuestions}(${percentage}%)_${timestamp}.jpg`;

      console.log(`📤 Uploading final answer sheet to Google Drive: ${finalFileName}`);
      console.log(`📊 Upload details: File size: ${imageBuffer.length} bytes, Score: ${score}/${totalQuestions} (${percentage}%)`);

      // Function to create form data (needed for retry logic)
      const createFormData = () => {
        const form = new FormData();
        form.append(
          'metadata',
          JSON.stringify({
            name: finalFileName,
            parents: [this.folderId],
          }),
          { contentType: 'application/json' }
        );
        form.append('file', imageBuffer, {
          filename: finalFileName,
          contentType: 'image/jpeg',
        });
        return form;
      };

      // Try upload with current token
      let form = createFormData();
      let response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            ...form.getHeaders(),
          },
          body: form,
        }
      );

      console.log(`📡 Final upload response status: ${response.status}`);

      // If token expired, refresh and retry with new FormData
      if (response.status === 401) {
        console.log('🔑 Access token expired, attempting to refresh...');
        await this.refreshAccessToken();
        
        // Create fresh FormData for retry (cannot reuse streams)
        form = createFormData();
        response = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              ...form.getHeaders(),
            },
            body: form,
          }
        );
        
        console.log(`📡 Retry response status: ${response.status}`);
      }

      if (!response.ok) {
        const errorData = await response.text();
        console.error('❌ Google Drive final upload error:', response.status, errorData);
        throw new Error(`HTTP ${response.status}: ${errorData}`);
      }

      const result = await response.json();
      console.log(`✅ Final answer sheet uploaded successfully!`);
      console.log(`📁 File details: ID=${result.id}, Name=${result.name}`);
      console.log(`🔗 View link: ${result.webViewLink}`);

      return {
        id: result.id,
        name: result.name,
        webViewLink: result.webViewLink
      };

    } catch (error) {
      console.error('❌ Error uploading final answer sheet to Google Drive:', error.message);
      throw new Error('Failed to upload final answer sheet to Google Drive: ' + error.message);
    }
  }

  // List all files with PENDING_ prefix
  async listPendingFiles() {
    try {
      console.log('📋 Fetching PENDING_ files from Google Drive...');
      
      await this.ensureValidToken();
      
      // Query for files starting with PENDING_
      const query = `name contains 'PENDING_' and parents in '${this.folderId}' and trashed=false`;
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,createdTime,size)&orderBy=createdTime desc`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list PENDING files: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      console.log(`📋 Found ${data.files.length} PENDING_ files`);
      
      return data.files;
      
    } catch (error) {
      console.error('❌ Error listing PENDING files from Google Drive:', error.message);
      throw new Error('Failed to list PENDING files: ' + error.message);
    }
  }

  // Download file from Google Drive by file ID
  // Helper method to extract file ID from Google Drive URL
  extractFileIdFromUrl(urlOrId) {
    // If it's already a file ID (no slashes or protocol), return as is
    if (!urlOrId.includes('/') && !urlOrId.includes('http')) {
      return urlOrId;
    }
    
    // Extract file ID from various Google Drive URL formats
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9-_]+)/,  // /file/d/FILE_ID
      /id=([a-zA-Z0-9-_]+)/,         // ?id=FILE_ID
      /\/([a-zA-Z0-9-_]+)\/view/,    // /FILE_ID/view
    ];
    
    for (const pattern of patterns) {
      const match = urlOrId.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    // If no pattern matches, assume it's already a file ID
    return urlOrId;
  }

  async downloadImage(fileIdOrUrl) {
    try {
      // Extract file ID from URL if needed
      const fileId = this.extractFileIdFromUrl(fileIdOrUrl);
      console.log(`📥 Downloading file from Google Drive: ${fileId}`);
      
      await this.ensureValidToken();
      
      const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to download file: ${response.status} ${errorText}`);
      }

      // Return the file as a buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      console.log(`✅ Downloaded file successfully, size: ${buffer.length} bytes`);
      return buffer;
      
    } catch (error) {
      console.error('❌ Error downloading file from Google Drive:', error.message);
      throw new Error('Failed to download file: ' + error.message);
    }
  }

  // Rename file using existing renameFileInDrive method
  async renameFile(fileId, newFileName) {
    return this.renameFileInDrive(fileId, newFileName);
  }
}

module.exports = GoogleDriveService;
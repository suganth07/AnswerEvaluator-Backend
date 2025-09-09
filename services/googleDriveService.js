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

  async uploadTempAnswerSheet(imageBuffer, originalFileName, studentName) {
    if (!this.accessToken) {
      throw new Error('Google Drive access token not configured');
    }

    try {
      // Create temporary filename
      const timestamp = Date.now();
      const sanitizedStudentName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
      const fileExtension = path.extname(originalFileName) || '.jpg';
      const tempFileName = `TEMP_${sanitizedStudentName}_${timestamp}${fileExtension}`;

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
}

module.exports = GoogleDriveService;
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');
require('dotenv').config();

class GoogleDriveService {
  constructor() {
    this.accessToken = process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
    this.folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    
    if (!this.accessToken) {
      console.warn('⚠️  Google Drive OAuth2 access token not found in environment variables');
      console.log('� Please add GOOGLE_DRIVE_ACCESS_TOKEN to your .env file');
    } else {
      console.log('✅ Google Drive OAuth2 service initialized successfully');
    }
  }

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

      // Upload to Google Drive using OAuth2
      const response = await fetch(
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

      // Create form data for multipart upload
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

      // Upload to Google Drive using OAuth2
      const response = await fetch(
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

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Google Drive API Error:', response.status, errorText);
        throw new Error(`Google Drive upload failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      console.log('✅ Temporary file uploaded successfully to Google Drive');
      console.log(`📄 Temp File Name: ${data.name}`);

      return {
        success: true,
        fileId: data.id,
        fileName: data.name,
        webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}`,
        message: 'Temporary answer sheet uploaded successfully to Google Drive'
      };

    } catch (error) {
      console.error('❌ Error uploading temporary file to Google Drive:', error);
      throw new Error(`Failed to upload temporary file to Google Drive: ${error.message}`);
    }
  }

  async renameFileInDrive(fileId, newFileName) {
    if (!this.accessToken) {
      throw new Error('Google Drive access token not configured');
    }

    try {
      console.log(`🔄 Renaming file in Google Drive to: ${newFileName}`);

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
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
      throw new Error(`Failed to rename file in Google Drive: ${error.message}`);
    }
  }

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

      // Upload to Google Drive using OAuth2
      const response = await fetch(
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

  async checkFolderAccess() {
    if (!this.drive) {
      return { success: false, message: 'Drive service not initialized' };
    }

    try {
      const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
      
      const response = await this.drive.files.get({
        fileId: folderId,
        fields: 'id,name,mimeType',
        supportsAllDrives: true, // Essential for shared drives
      });

      return {
        success: true,
        folder: response.data,
        message: 'Folder access confirmed'
      };
    } catch (error) {
      return {
        success: false,
        message: `Folder access failed: ${error.message}`
      };
    }
  }
}

module.exports = new GoogleDriveService();
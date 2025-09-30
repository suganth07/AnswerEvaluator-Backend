const { Client } = require('minio');
const crypto = require('crypto');
const path = require('path');

class MinIOService {
  constructor() {
    this.minioClient = new Client({
      endPoint: process.env.MINIO_ENDPOINT?.split(':')[0] || 'localhost',
      port: parseInt(process.env.MINIO_ENDPOINT?.split(':')[1]) || 9000,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'ROOTUSER',
      secretKey: process.env.MINIO_SECRET_KEY || 'CHANGEME123',
    });

    this.bucketName = process.env.MINIO_BUCKET || 'answer-sheets';
    
    // Initialize bucket
    this.initializeBucket();
  }

  async initializeBucket() {
    try {
      const bucketExists = await this.minioClient.bucketExists(this.bucketName);
      if (!bucketExists) {
        await this.minioClient.makeBucket(this.bucketName);
        console.log(`✅ MinIO bucket '${this.bucketName}' created successfully`);
      }
    } catch (error) {
      console.error('❌ Error initializing MinIO bucket:', error.message);
    }
  }

  /**
   * Upload temporary answer sheet (replaces googleDriveService.uploadTempAnswerSheet)
   * @param {Buffer} fileBuffer - Image buffer
   * @param {string} fileName - File name
   * @param {string} studentName - Student name
   * @param {string} rollNo - Roll number
   * @returns {Object} Upload result with fileId and webViewLink
   */
  async uploadTempAnswerSheet(fileBuffer, fileName, studentName, rollNo) {
    try {
      const objectName = `pending/${fileName}`;
      
      // Add metadata
      const metaData = {
        'Content-Type': 'image/jpeg',
        'student-name': studentName,
        'roll-no': rollNo.toString(),
        'upload-time': new Date().toISOString(),
        'original-filename': fileName
      };

      console.log(`📤 Uploading to MinIO: ${objectName}`);
      
      await this.minioClient.putObject(
        this.bucketName,
        objectName,
        fileBuffer,
        fileBuffer.length,
        metaData
      );

      // Generate presigned URL for access (24 hours expiry)
      const presignedUrl = await this.minioClient.presignedGetObject(
        this.bucketName,
        objectName,
        24 * 60 * 60 // 24 hours
      );

      console.log(`✅ Successfully uploaded: ${objectName}`);

      return {
        fileId: objectName, // Use object name as fileId
        webViewLink: presignedUrl,
        fileName: fileName,
        objectName: objectName
      };
    } catch (error) {
      console.error('❌ MinIO upload error:', error);
      throw new Error(`Failed to upload file to MinIO: ${error.message}`);
    }
  }

  /**
   * Download image from MinIO (replaces googleDriveService.downloadImage)
   * @param {string} objectNameOrUrl - Object name in MinIO or presigned URL (for backward compatibility)
   * @returns {Buffer} Image buffer
   */
  async downloadImage(objectNameOrUrl) {
    try {
      let objectName = objectNameOrUrl;
      
      // Handle backward compatibility: if it's a presigned URL, extract object name
      if (objectNameOrUrl.startsWith('http')) {
        try {
          const url = new URL(objectNameOrUrl);
          // Extract object name from MinIO URL path
          objectName = url.pathname.replace(`/${this.bucketName}/`, '');
          console.log(`🔄 Converting URL to object name: ${objectName}`);
        } catch (urlError) {
          console.error('❌ Failed to parse URL:', urlError);
          throw new Error(`Invalid URL format: ${objectNameOrUrl}`);
        }
      }
      
      console.log(`📥 Downloading from MinIO: ${objectName}`);
      
      const dataStream = await this.minioClient.getObject(this.bucketName, objectName);
      
      // Convert stream to buffer
      const chunks = [];
      return new Promise((resolve, reject) => {
        dataStream.on('data', (chunk) => chunks.push(chunk));
        dataStream.on('end', () => {
          const buffer = Buffer.concat(chunks);
          console.log(`✅ Downloaded ${objectName}: ${buffer.length} bytes`);
          resolve(buffer);
        });
        dataStream.on('error', reject);
      });
    } catch (error) {
      console.error('❌ MinIO download error:', error);
      throw new Error(`Failed to download file from MinIO: ${error.message}`);
    }
  }

  /**
   * List pending files (replaces googleDriveService.listPendingFiles)
   * @returns {Array} Array of file objects
   */
  async listPendingFiles() {
    try {
      console.log('📋 Listing pending files from MinIO...');
      
      const objects = [];
      const stream = this.minioClient.listObjects(this.bucketName, 'pending/', true);
      
      return new Promise((resolve, reject) => {
        stream.on('data', async (obj) => {
          try {
            // Get object metadata
            const stat = await this.minioClient.statObject(this.bucketName, obj.name);
            
            // Generate presigned URL
            const presignedUrl = await this.minioClient.presignedGetObject(
              this.bucketName,
              obj.name,
              24 * 60 * 60
            );

            objects.push({
              id: obj.name,
              name: path.basename(obj.name),
              webViewLink: presignedUrl,
              size: obj.size,
              lastModified: obj.lastModified,
              metadata: stat.metaData || {}
            });
          } catch (metaError) {
            console.warn(`⚠️ Could not get metadata for ${obj.name}:`, metaError.message);
            objects.push({
              id: obj.name,
              name: path.basename(obj.name),
              webViewLink: null,
              size: obj.size,
              lastModified: obj.lastModified,
              metadata: {}
            });
          }
        });
        
        stream.on('end', () => {
          console.log(`✅ Found ${objects.length} pending files`);
          resolve(objects);
        });
        
        stream.on('error', reject);
      });
    } catch (error) {
      console.error('❌ MinIO list error:', error);
      throw new Error(`Failed to list files from MinIO: ${error.message}`);
    }
  }

  /**
   * Rename file (move from pending to evaluated)
   * @param {string} oldObjectName - Current object name
   * @param {string} newFileName - New file name
   * @returns {Object} Rename result
   */
  async renameFile(oldObjectName, newFileName) {
    try {
      const newObjectName = `evaluated/${newFileName}`;
      
      console.log(`🔄 Moving file: ${oldObjectName} → ${newObjectName}`);
      
      // Copy object to new location
      await this.minioClient.copyObject(
        this.bucketName,
        newObjectName,
        `/${this.bucketName}/${oldObjectName}`
      );
      
      // Delete original object
      await this.minioClient.removeObject(this.bucketName, oldObjectName);
      
      // Generate new presigned URL
      const presignedUrl = await this.minioClient.presignedGetObject(
        this.bucketName,
        newObjectName,
        24 * 60 * 60
      );
      
      console.log(`✅ File moved successfully to: ${newObjectName}`);
      
      return {
        fileId: newObjectName,
        webViewLink: presignedUrl,
        fileName: newFileName,
        objectName: newObjectName
      };
    } catch (error) {
      console.error('❌ MinIO rename error:', error);
      throw new Error(`Failed to rename file in MinIO: ${error.message}`);
    }
  }

  /**
   * Upload final answer sheet (replaces googleDriveService.uploadFinalAnswerSheet)
   * @param {Buffer} imageBuffer - Image buffer
   * @param {string} studentName - Student name
   * @param {string} paperName - Paper name
   * @param {number} score - Score obtained
   * @param {number} totalQuestions - Total questions
   * @returns {Object} Upload result
   */
  async uploadFinalAnswerSheet(imageBuffer, studentName, paperName, score, totalQuestions) {
    try {
      const sanitizedStudentName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
      const sanitizedPaperName = paperName.replace(/[^a-zA-Z0-9]/g, '_');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${sanitizedStudentName}-${sanitizedPaperName}-${score}of${totalQuestions}-${timestamp}.jpg`;
      const objectName = `evaluated/${fileName}`;
      
      const metaData = {
        'Content-Type': 'image/jpeg',
        'student-name': studentName,
        'paper-name': paperName,
        'score': score.toString(),
        'total-questions': totalQuestions.toString(),
        'percentage': ((score / totalQuestions) * 100).toFixed(2),
        'evaluation-time': new Date().toISOString()
      };

      console.log(`📊 Uploading evaluated sheet: ${objectName}`);
      
      await this.minioClient.putObject(
        this.bucketName,
        objectName,
        imageBuffer,
        imageBuffer.length,
        metaData
      );

      const presignedUrl = await this.minioClient.presignedGetObject(
        this.bucketName,
        objectName,
        24 * 60 * 60
      );

      console.log(`✅ Evaluated sheet uploaded: ${objectName}`);

      return {
        fileId: objectName,
        webViewLink: presignedUrl,
        fileName: fileName,
        objectName: objectName
      };
    } catch (error) {
      console.error('❌ MinIO final upload error:', error);
      throw new Error(`Failed to upload final sheet to MinIO: ${error.message}`);
    }
  }

  /**
   * Get presigned URL for object
   * @param {string} objectName - Object name
   * @param {number} expiry - Expiry in seconds (default 24 hours)
   * @returns {string} Presigned URL
   */
  async getPresignedUrl(objectName, expiry = 24 * 60 * 60) {
    try {
      return await this.minioClient.presignedGetObject(this.bucketName, objectName, expiry);
    } catch (error) {
      console.error('❌ Error generating presigned URL:', error);
      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
  }

  /**
   * Delete object from MinIO
   * @param {string} objectName - Object name to delete
   * @returns {boolean} Success status
   */
  async deleteObject(objectName) {
    try {
      await this.minioClient.removeObject(this.bucketName, objectName);
      console.log(`🗑️ Deleted object: ${objectName}`);
      return true;
    } catch (error) {
      console.error('❌ MinIO delete error:', error);
      throw new Error(`Failed to delete object from MinIO: ${error.message}`);
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async uploadAnswerSheet(filePath, studentName, paperName, marksObtained, totalMarks) {
    const fs = require('fs');
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const fileBuffer = fs.readFileSync(filePath);
    return await this.uploadFinalAnswerSheet(fileBuffer, studentName, paperName, marksObtained, totalMarks);
  }
}

module.exports = MinIOService;
const { Client } = require('minio');
const crypto = require('crypto');
const path = require('path');
const ImageMetadataService = require('./imageMetadataService');

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
    this.imageMetadataService = new ImageMetadataService();
    
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
      
      // Set bucket policy to allow public read access for images
      const bucketPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucketName}/*`]
          }
        ]
      };
      
      try {
        await this.minioClient.setBucketPolicy(this.bucketName, JSON.stringify(bucketPolicy));
        console.log(`✅ MinIO bucket policy set for public read access`);
      } catch (policyError) {
        console.warn(`⚠️ Could not set bucket policy (MinIO may not support it):`, policyError.message);
      }
    } catch (error) {
      console.error('❌ Error initializing MinIO bucket:', error.message);
    }
  }

  /**
   * Generate public URL for MinIO object
   * @param {string} objectName - MinIO object name
   * @returns {string} Public URL
   */
  generatePublicUrl(objectName) {
    // Use public endpoint if available, otherwise fall back to regular endpoint
    const publicEndpoint = process.env.MINIO_PUBLIC_ENDPOINT;
    const minioEndpoint = publicEndpoint || process.env.MINIO_ENDPOINT || 'localhost:9000';
    const useSSL = process.env.MINIO_USE_SSL === 'true';
    const protocol = useSSL ? 'https' : 'http';
    
    const url = `${protocol}://${minioEndpoint}/${this.bucketName}/${objectName}`;
    console.log(`🔗 Generated public URL: ${url}`);
    return url;
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
      console.log(`🔍 Upload details: bucket="${this.bucketName}", objectName="${objectName}", bufferSize=${fileBuffer.length}`);
      
      await this.minioClient.putObject(
        this.bucketName,
        objectName,
        fileBuffer,
        fileBuffer.length,
        metaData
      );

      console.log(`📤 Upload completed, storing metadata in database...`);

      // Store metadata in database
      const imageMetadata = await this.imageMetadataService.storeImageMetadata({
        objectName,
        originalName: fileName,
        contentType: 'image/jpeg',
        fileSize: fileBuffer.length,
        bucketName: this.bucketName,
        category: 'pending',
        studentName,
        rollNo,
        metadata: metaData
      });

      // Generate permanent public URL
      const publicUrl = this.generatePublicUrl(objectName);

      console.log(`✅ Successfully uploaded: ${objectName}`);
      console.log(`🔗 Generated public URL: ${publicUrl}`);

      const result = {
        fileId: objectName, // Use object name as fileId
        webViewLink: publicUrl,
        fileName: fileName,
        objectName: objectName,
        metadataId: imageMetadata.id
      };
      
      console.log(`🔍 Returning upload result:`, JSON.stringify(result, null, 2));
      
      return result;
    } catch (error) {
      console.error('❌ MinIO upload error:', error);
      console.error('❌ Error stack:', error.stack);
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
      console.log(`🔍 Input for download: "${objectNameOrUrl}"`);
      
      let objectName = objectNameOrUrl;
      
      // Handle backward compatibility: if it's a presigned URL, extract object name
      if (objectNameOrUrl && objectNameOrUrl.startsWith('http')) {
        try {
          const url = new URL(objectNameOrUrl);
          console.log(`🔍 URL pathname: "${url.pathname}"`);
          console.log(`🔍 Bucket name: "${this.bucketName}"`);
          
          // Extract object name from MinIO URL path
          // URL format: /bucket-name/object-path
          const bucketPrefix = `/${this.bucketName}/`;
          if (url.pathname.startsWith(bucketPrefix)) {
            objectName = url.pathname.substring(bucketPrefix.length);
          } else {
            // Alternative extraction method
            const pathParts = url.pathname.split('/').filter(part => part);
            if (pathParts.length >= 2 && pathParts[0] === this.bucketName) {
              objectName = pathParts.slice(1).join('/');
            } else {
              throw new Error(`URL path doesn't contain bucket name: ${url.pathname}`);
            }
          }
          console.log(`🔄 Extracted object name: "${objectName}"`);
        } catch (urlError) {
          console.error('❌ Failed to parse URL:', urlError);
          throw new Error(`Invalid URL format: ${objectNameOrUrl}`);
        }
      }
      
      // Validate object name
      if (!objectName || objectName.trim() === '') {
        throw new Error(`Empty object name provided. Input was: "${objectNameOrUrl}"`);
      }
      
      console.log(`📥 Downloading from MinIO: "${objectName}"`);
      
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
      console.log('📋 Listing pending files from database...');
      
      // Get pending images from database
      const pendingImages = await this.imageMetadataService.getImagesByCategory('pending');
      
      const files = pendingImages.map(imageMetadata => ({
        id: imageMetadata.objectName,
        name: imageMetadata.originalName,
        webViewLink: this.generatePublicUrl(imageMetadata.objectName),
        size: imageMetadata.fileSize ? Number(imageMetadata.fileSize) : 0,
        lastModified: imageMetadata.uploadedAt,
        metadata: {
          studentName: imageMetadata.studentName,
          rollNo: imageMetadata.rollNo,
          uploadTime: imageMetadata.uploadedAt,
          ...imageMetadata.metadata
        }
      }));

      console.log(`✅ Found ${files.length} pending files from database`);
      return files;
    } catch (error) {
      console.error('❌ Error listing pending files:', error);
      
      // Fallback to direct MinIO listing if database fails
      console.log('🔄 Falling back to direct MinIO listing...');
      return this.listPendingFilesFromMinIO();
    }
  }

  /**
   * Fallback method to list files directly from MinIO
   * @returns {Array} Array of file objects
   */
  async listPendingFilesFromMinIO() {
    try {
      const objects = [];
      const stream = this.minioClient.listObjects(this.bucketName, 'pending/', true);
      
      return new Promise((resolve, reject) => {
        stream.on('data', async (obj) => {
          try {
            // Get object metadata
            const stat = await this.minioClient.statObject(this.bucketName, obj.name);
            
            // Generate public URL
            const publicUrl = this.generatePublicUrl(obj.name);

            objects.push({
              id: obj.name,
              name: path.basename(obj.name),
              webViewLink: publicUrl,
              size: obj.size,
              lastModified: obj.lastModified,
              metadata: stat.metaData || {}
            });
          } catch (metaError) {
            console.warn(`⚠️ Could not get metadata for ${obj.name}:`, metaError.message);
            objects.push({
              id: obj.name,
              name: path.basename(obj.name),
              webViewLink: this.generatePublicUrl(obj.name),
              size: obj.size,
              lastModified: obj.lastModified,
              metadata: {}
            });
          }
        });
        
        stream.on('end', () => {
          console.log(`✅ Found ${objects.length} pending files from MinIO`);
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
      
      // Update metadata in database
      await this.imageMetadataService.moveImageMetadata(oldObjectName, newObjectName, {
        category: 'evaluated',
        originalName: newFileName
      });
      
      // Generate new public URL
      const publicUrl = this.generatePublicUrl(newObjectName);
      
      console.log(`✅ File moved successfully to: ${newObjectName}`);
      
      return {
        fileId: newObjectName,
        webViewLink: publicUrl,
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

      // Store metadata in database
      const percentage = (score / totalQuestions) * 100;
      const imageMetadata = await this.imageMetadataService.storeImageMetadata({
        objectName,
        originalName: fileName,
        contentType: 'image/jpeg',
        fileSize: imageBuffer.length,
        bucketName: this.bucketName,
        category: 'evaluated',
        studentName,
        paperName,
        score,
        totalQuestions,
        percentage,
        metadata: metaData
      });

      const publicUrl = this.generatePublicUrl(objectName);

      console.log(`✅ Evaluated sheet uploaded: ${objectName}`);

      return {
        fileId: objectName,
        webViewLink: publicUrl,
        fileName: fileName,
        objectName: objectName,
        metadataId: imageMetadata.id
      };
    } catch (error) {
      console.error('❌ MinIO final upload error:', error);
      throw new Error(`Failed to upload final sheet to MinIO: ${error.message}`);
    }
  }

  /**
   * Get public URL for object (replaces presigned URLs)
   * @param {string} objectName - Object name
   * @param {number} expiry - Expiry in seconds (ignored, kept for backward compatibility)
   * @returns {string} Public URL
   */
  async getPresignedUrl(objectName, expiry = 24 * 60 * 60) {
    try {
      // Return permanent public URL instead of presigned URL
      return this.generatePublicUrl(objectName);
    } catch (error) {
      console.error('❌ Error generating public URL:', error);
      throw new Error(`Failed to generate public URL: ${error.message}`);
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
      
      // Also remove metadata from database
      try {
        await this.imageMetadataService.deleteImageMetadata(objectName);
      } catch (metaError) {
        console.warn(`⚠️ Could not delete metadata for ${objectName}:`, metaError.message);
      }
      
      console.log(`🗑️ Deleted object and metadata: ${objectName}`);
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

  /**
   * Get image metadata service instance
   * @returns {ImageMetadataService} Image metadata service
   */
  getImageMetadataService() {
    return this.imageMetadataService;
  }

  /**
   * Get storage statistics
   * @returns {Object} Storage statistics
   */
  async getStorageStats() {
    try {
      const imageStats = await this.imageMetadataService.getImageStats();
      
      // Get MinIO bucket stats
      let bucketStats = null;
      try {
        const objectsList = [];
        const stream = this.minioClient.listObjects(this.bucketName, '', true);
        
        bucketStats = await new Promise((resolve, reject) => {
          stream.on('data', (obj) => objectsList.push(obj));
          stream.on('end', () => {
            const totalSize = objectsList.reduce((sum, obj) => sum + obj.size, 0);
            resolve({
              totalObjects: objectsList.length,
              totalSize,
              bucketName: this.bucketName
            });
          });
          stream.on('error', reject);
        });
      } catch (minioError) {
        console.warn('⚠️ Could not get MinIO bucket stats:', minioError.message);
      }

      return {
        database: imageStats,
        minio: bucketStats
      };
    } catch (error) {
      console.error('❌ Error getting storage stats:', error);
      throw new Error(`Failed to get storage statistics: ${error.message}`);
    }
  }

  /**
   * Sync metadata between MinIO and database
   * This method can be used to recover metadata for existing objects
   * @returns {Object} Sync results
   */
  async syncMetadata() {
    try {
      console.log('🔄 Starting metadata sync between MinIO and database...');
      
      // Get all objects from MinIO
      const minioObjects = [];
      const stream = this.minioClient.listObjects(this.bucketName, '', true);
      
      const allObjects = await new Promise((resolve, reject) => {
        stream.on('data', (obj) => minioObjects.push(obj));
        stream.on('end', () => resolve(minioObjects));
        stream.on('error', reject);
      });

      // Get all metadata from database
      const allCategories = ['pending', 'evaluated', 'papers'];
      const dbMetadata = [];
      for (const category of allCategories) {
        const images = await this.imageMetadataService.getImagesByCategory(category);
        dbMetadata.push(...images);
      }

      const dbObjectNames = dbMetadata.map(meta => meta.objectName);
      const minioObjectNames = minioObjects.map(obj => obj.name);

      // Find objects in MinIO but not in database
      const missingInDb = minioObjects.filter(obj => !dbObjectNames.includes(obj.name));
      
      // Find objects in database but not in MinIO
      const missingInMinio = dbMetadata.filter(meta => !minioObjectNames.includes(meta.objectName));

      console.log(`📊 Sync results: ${missingInDb.length} missing in DB, ${missingInMinio.length} missing in MinIO`);

      return {
        totalMinioObjects: minioObjects.length,
        totalDbMetadata: dbMetadata.length,
        missingInDatabase: missingInDb.length,
        missingInMinio: missingInMinio.length,
        missingInDbObjects: missingInDb.map(obj => obj.name),
        missingInMinioObjects: missingInMinio.map(meta => meta.objectName)
      };
    } catch (error) {
      console.error('❌ Error during metadata sync:', error);
      throw new Error(`Failed to sync metadata: ${error.message}`);
    }
  }
}

module.exports = MinIOService;
const { PrismaClient } = require('@prisma/client');

class ImageMetadataService {
  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Store image metadata in database
   * @param {Object} imageData - Image metadata
   * @returns {Object} Created image metadata record
   */
  async storeImageMetadata(imageData) {
    try {
      const {
        objectName,
        originalName,
        contentType = 'image/jpeg',
        fileSize,
        bucketName = 'answer-sheets',
        category,
        studentName,
        rollNo,
        paperName,
        score,
        totalQuestions,
        percentage,
        metadata = {},
        paperId,
        submissionId
      } = imageData;

      console.log(`📊 Storing image metadata for: ${objectName}`);

      const imageMetadata = await this.prisma.imageMetadata.create({
        data: {
          objectName,
          originalName,
          contentType,
          fileSize: fileSize ? BigInt(fileSize) : null,
          bucketName,
          category,
          studentName,
          rollNo,
          paperName,
          score,
          totalQuestions,
          percentage,
          metadata,
          paperId,
          submissionId
        }
      });

      console.log(`✅ Image metadata stored with ID: ${imageMetadata.id}`);
      return imageMetadata;
    } catch (error) {
      console.error('❌ Error storing image metadata:', error);
      throw new Error(`Failed to store image metadata: ${error.message}`);
    }
  }

  /**
   * Get image metadata by object name
   * @param {string} objectName - MinIO object name
   * @returns {Object} Image metadata record
   */
  async getImageMetadata(objectName) {
    try {
      const imageMetadata = await this.prisma.imageMetadata.findUnique({
        where: { objectName },
        include: {
          paper: true,
          submission: true
        }
      });

      if (!imageMetadata) {
        throw new Error(`Image metadata not found for object: ${objectName}`);
      }

      return imageMetadata;
    } catch (error) {
      console.error('❌ Error retrieving image metadata:', error);
      throw new Error(`Failed to retrieve image metadata: ${error.message}`);
    }
  }

  /**
   * Get all images by category
   * @param {string} category - Image category ('pending', 'evaluated', 'papers')
   * @returns {Array} Array of image metadata records
   */
  async getImagesByCategory(category) {
    try {
      const images = await this.prisma.imageMetadata.findMany({
        where: { category },
        include: {
          paper: true,
          submission: true
        },
        orderBy: { uploadedAt: 'desc' }
      });

      console.log(`📋 Found ${images.length} images in category: ${category}`);
      return images;
    } catch (error) {
      console.error('❌ Error retrieving images by category:', error);
      throw new Error(`Failed to retrieve images: ${error.message}`);
    }
  }

  /**
   * Get images by submission ID
   * @param {number} submissionId - Student submission ID
   * @returns {Array} Array of image metadata records
   */
  async getImagesBySubmission(submissionId) {
    try {
      const images = await this.prisma.imageMetadata.findMany({
        where: { submissionId },
        include: {
          paper: true,
          submission: true
        },
        orderBy: { uploadedAt: 'desc' }
      });

      return images;
    } catch (error) {
      console.error('❌ Error retrieving images by submission:', error);
      throw new Error(`Failed to retrieve submission images: ${error.message}`);
    }
  }

  /**
   * Get images by paper ID
   * @param {number} paperId - Paper ID
   * @returns {Array} Array of image metadata records
   */
  async getImagesByPaper(paperId) {
    try {
      const images = await this.prisma.imageMetadata.findMany({
        where: { paperId },
        include: {
          paper: true,
          submission: true
        },
        orderBy: { uploadedAt: 'desc' }
      });

      return images;
    } catch (error) {
      console.error('❌ Error retrieving images by paper:', error);
      throw new Error(`Failed to retrieve paper images: ${error.message}`);
    }
  }

  /**
   * Update image metadata
   * @param {string} objectName - MinIO object name
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated image metadata record
   */
  async updateImageMetadata(objectName, updateData) {
    try {
      const imageMetadata = await this.prisma.imageMetadata.update({
        where: { objectName },
        data: updateData,
        include: {
          paper: true,
          submission: true
        }
      });

      console.log(`✅ Image metadata updated for: ${objectName}`);
      return imageMetadata;
    } catch (error) {
      console.error('❌ Error updating image metadata:', error);
      throw new Error(`Failed to update image metadata: ${error.message}`);
    }
  }

  /**
   * Delete image metadata
   * @param {string} objectName - MinIO object name
   * @returns {boolean} Success status
   */
  async deleteImageMetadata(objectName) {
    try {
      await this.prisma.imageMetadata.delete({
        where: { objectName }
      });

      console.log(`🗑️ Image metadata deleted for: ${objectName}`);
      return true;
    } catch (error) {
      console.error('❌ Error deleting image metadata:', error);
      throw new Error(`Failed to delete image metadata: ${error.message}`);
    }
  }

  /**
   * Move image metadata (for renaming/moving files)
   * @param {string} oldObjectName - Old MinIO object name
   * @param {string} newObjectName - New MinIO object name
   * @param {Object} additionalData - Additional data to update
   * @returns {Object} Updated image metadata record
   */
  async moveImageMetadata(oldObjectName, newObjectName, additionalData = {}) {
    try {
      const imageMetadata = await this.prisma.imageMetadata.update({
        where: { objectName: oldObjectName },
        data: {
          objectName: newObjectName,
          ...additionalData,
          updatedAt: new Date()
        },
        include: {
          paper: true,
          submission: true
        }
      });

      console.log(`🔄 Image metadata moved: ${oldObjectName} → ${newObjectName}`);
      return imageMetadata;
    } catch (error) {
      console.error('❌ Error moving image metadata:', error);
      throw new Error(`Failed to move image metadata: ${error.message}`);
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
    const bucketName = process.env.MINIO_BUCKET || 'answer-sheets';
    const useSSL = process.env.MINIO_USE_SSL === 'true';
    const protocol = useSSL ? 'https' : 'http';
    
    return `${protocol}://${minioEndpoint}/${bucketName}/${objectName}`;
  }

  /**
   * Get statistics about stored images
   * @returns {Object} Image statistics
   */
  async getImageStats() {
    try {
      const stats = await this.prisma.imageMetadata.groupBy({
        by: ['category'],
        _count: {
          id: true
        },
        _sum: {
          fileSize: true
        }
      });

      const totalCount = await this.prisma.imageMetadata.count();

      return {
        totalImages: totalCount,
        byCategory: stats.reduce((acc, stat) => {
          acc[stat.category] = {
            count: stat._count.id,
            totalSize: stat._sum.fileSize ? Number(stat._sum.fileSize) : 0
          };
          return acc;
        }, {})
      };
    } catch (error) {
      console.error('❌ Error getting image stats:', error);
      throw new Error(`Failed to get image statistics: ${error.message}`);
    }
  }

  /**
   * Clean up orphaned metadata (objects that no longer exist in MinIO)
   * This should be called periodically to maintain data consistency
   * @param {Array} existingObjectNames - Array of object names that exist in MinIO
   * @returns {Object} Cleanup results
   */
  async cleanupOrphanedMetadata(existingObjectNames) {
    try {
      const allMetadata = await this.prisma.imageMetadata.findMany({
        select: { objectName: true }
      });

      const orphanedObjects = allMetadata.filter(
        meta => !existingObjectNames.includes(meta.objectName)
      );

      if (orphanedObjects.length > 0) {
        const deleteResult = await this.prisma.imageMetadata.deleteMany({
          where: {
            objectName: {
              in: orphanedObjects.map(obj => obj.objectName)
            }
          }
        });

        console.log(`🧹 Cleaned up ${deleteResult.count} orphaned metadata records`);
        return { deletedCount: deleteResult.count, orphanedObjects };
      }

      return { deletedCount: 0, orphanedObjects: [] };
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      throw new Error(`Failed to cleanup orphaned metadata: ${error.message}`);
    }
  }
}

module.exports = ImageMetadataService;
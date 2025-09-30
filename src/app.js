const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/papers", require("./routes/papers"));
app.use("/api/submissions", require("./routes/submissions"));
app.use("/api/questions", require("./routes/questions"));
app.use("/api/manual-tests", require("./routes/manual-tests"));

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    const MinIOService = require("../services/minioService");
    const minioService = new MinIOService();
    
    // Test MinIO connection
    const bucketExists = await minioService.minioClient.bucketExists(minioService.bucketName);
    
    res.json({ 
      status: "OK", 
      message: "Answer Evaluator API is running",
      services: {
        minio: bucketExists ? "Connected" : "Bucket not found",
        api: "Running"
      }
    });
  } catch (error) {
    res.status(503).json({ 
      status: "Error", 
      message: "Health check failed",
      error: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

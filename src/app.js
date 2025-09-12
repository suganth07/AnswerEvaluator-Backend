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

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Answer Evaluator API is running" });
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

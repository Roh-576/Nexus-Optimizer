import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // Simulation State
  let nodes = [
    { id: "node-1", cpu: 45, latency: 12, load: 30, energy: 150, status: "active" },
    { id: "node-2", cpu: 60, latency: 15, load: 50, energy: 200, status: "active" },
    { id: "node-3", cpu: 30, latency: 10, load: 20, energy: 120, status: "active" },
    { id: "node-4", cpu: 85, latency: 25, load: 80, energy: 350, status: "active" },
    { id: "node-5", cpu: 10, latency: 5, load: 5, energy: 50, status: "standby" },
  ];

  let globalWorkload = 100; // Base workload multiplier
  let optimizationActive = false;

  // Simulation Engine
  setInterval(() => {
    nodes = nodes.map(node => {
      if (node.status === "standby") {
        return { ...node, cpu: 5 + Math.random() * 5, latency: 2 + Math.random() * 3, load: 2 + Math.random() * 3, energy: 40 + Math.random() * 10 };
      }

      // Random fluctuations
      const fluctuation = (Math.random() - 0.5) * 10;
      let newLoad = Math.max(5, Math.min(100, node.load + fluctuation + (globalWorkload - 100) / 10));
      
      // Optimization effect
      if (optimizationActive && newLoad > 70) {
        newLoad -= 15; // Simulate AI shifting load
      }

      const newCpu = Math.max(5, Math.min(100, newLoad * 1.1 + (Math.random() - 0.5) * 5));
      const newLatency = Math.max(2, Math.min(100, (newLoad / 10) * 3 + (Math.random() - 0.5) * 2));
      const newEnergy = newCpu * 3 + 50;

      return {
        ...node,
        load: parseFloat(newLoad.toFixed(2)),
        cpu: parseFloat(newCpu.toFixed(2)),
        latency: parseFloat(newLatency.toFixed(2)),
        energy: parseFloat(newEnergy.toFixed(2)),
      };
    });

    io.emit("metrics_update", { nodes, globalWorkload, optimizationActive, timestamp: Date.now() });
  }, 2000);

  app.use(express.json());

  // API Routes
  app.get("/api/status", (req, res) => {
    res.json({ nodes, globalWorkload, optimizationActive });
  });

  app.post("/api/workload", (req, res) => {
    const { value } = req.body;
    globalWorkload = value;
    res.json({ success: true, globalWorkload });
  });

  app.post("/api/optimize", (req, res) => {
    const { active } = req.body;
    optimizationActive = active;
    res.json({ success: true, optimizationActive });
  });

  app.post("/api/node/toggle", (req, res) => {
    const { id } = req.body;
    nodes = nodes.map(n => {
      if (n.id === id) {
        return { ...n, status: n.status === "active" ? "standby" : "active" };
      }
      return n;
    });
    res.json({ success: true, nodes });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

import { useEffect, useState, useRef, ReactNode } from "react";
import { io, Socket } from "socket.io-client";
import { 
  Activity, 
  Cpu, 
  Zap, 
  Clock, 
  Server, 
  ShieldAlert, 
  TrendingUp, 
  BrainCircuit,
  Power,
  RefreshCw,
  BarChart3,
  LogIn,
  LogOut,
  User
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from "firebase/auth";
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  Timestamp,
  serverTimestamp
} from "firebase/firestore";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getOptimizationPlan, NodeMetrics, OptimizationPlan } from "./services/geminiService";
import { auth, db, handleFirestoreError, OperationType } from "./firebase";

export default function App() {
  const [nodes, setNodes] = useState<NodeMetrics[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [workload, setWorkload] = useState(100);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [aiPlan, setAiPlan] = useState<OptimizationPlan | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [logs, setLogs] = useState<{ id: string, message: string, type: 'info' | 'warning' | 'success', time: string }[]>([]);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, "logs"), orderBy("timestamp", "desc"), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedLogs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          message: data.message,
          type: data.type,
          time: data.timestamp?.toDate().toLocaleTimeString() || "Just now"
        };
      });
      setLogs(fetchedLogs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "logs");
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on("metrics_update", (data) => {
      setNodes(data.nodes);
      setWorkload(data.globalWorkload);
      setIsOptimizing(data.optimizationActive);
      
      // Check for anomalies and log them to Firestore
      if (user) {
        data.nodes.forEach(async (n: any) => {
          if (n.cpu > 90) {
            try {
              // Simple throttle: don't log if same node logged in last 10s (client-side check for simplicity)
              const now = Date.now();
              await addDoc(collection(db, "logs"), {
                message: `Critical CPU usage on ${n.id}: ${n.cpu}%`,
                type: 'warning',
                timestamp: serverTimestamp(),
                nodeId: n.id
              });
            } catch (error) {
              // Silent fail for auto-logs to avoid spamming errors
            }
          }
        });
      }

      setHistory(prev => {
        const newEntry = {
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          avgCpu: data.nodes.reduce((acc: number, n: any) => acc + n.cpu, 0) / data.nodes.length,
          avgLoad: data.nodes.reduce((acc: number, n: any) => acc + n.load, 0) / data.nodes.length,
          totalEnergy: data.nodes.reduce((acc: number, n: any) => acc + n.energy, 0),
        };
        const updated = [...prev, newEntry].slice(-20);
        return updated;
      });
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const handleWorkloadChange = async (value: number[]) => {
    const val = value[0];
    setWorkload(val);
    await fetch("/api/workload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: val }),
    });
  };

  const toggleOptimization = async (checked: boolean) => {
    setIsOptimizing(checked);
    await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: checked }),
    });
  };

  const toggleNode = async (id: string) => {
    await fetch("/api/node/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const runAiAnalysis = async () => {
    if (nodes.length === 0) return;
    setIsAnalyzing(true);
    const plan = await getOptimizationPlan(nodes, workload);
    setAiPlan(plan);
    setIsAnalyzing(false);
    
    if (user) {
      try {
        await addDoc(collection(db, "logs"), {
          message: `AI Optimization Plan generated: ${plan.recommendation}`,
          type: 'success',
          timestamp: serverTimestamp()
        });
        
        await addDoc(collection(db, "plans"), {
          ...plan,
          timestamp: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, "logs/plans");
      }
    }
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const totalLoad = nodes.reduce((acc, n) => acc + n.load, 0);
  const avgLatency = nodes.length > 0 ? nodes.reduce((acc, n) => acc + n.latency, 0) / nodes.length : 0;
  const totalEnergy = nodes.reduce((acc, n) => acc + n.energy, 0);
  const anomalies = nodes.filter(n => n.cpu > 90 || n.latency > 40);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 p-4 md:p-8 font-sans selection:bg-emerald-500/30">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
              <Activity className="text-emerald-500 h-8 w-8" />
              Nexus Optimizer
            </h1>
            <p className="text-zinc-400 mt-1">AI-Driven Infrastructure Optimization Engine</p>
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-zinc-900 px-3 py-1.5 rounded-full border border-zinc-800">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="" className="h-5 w-5 rounded-full" referrerPolicy="no-referrer" />
                  ) : (
                    <User className="h-4 w-4 text-zinc-400" />
                  )}
                  <span className="text-xs font-medium text-zinc-300">{user.displayName || 'User'}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={handleLogout} className="text-zinc-500 hover:text-white">
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={handleLogin} className="border-zinc-800 text-zinc-400 hover:text-white">
                <LogIn className="h-4 w-4 mr-2" />
                Sign In
              </Button>
            )}
            <div className="flex items-center gap-2 bg-zinc-900 px-4 py-2 rounded-full border border-zinc-800">
              <div className={`h-2 w-2 rounded-full ${socketRef.current?.connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-300">
                {socketRef.current?.connected ? 'System Live' : 'Connecting...'}
              </span>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
              onClick={runAiAnalysis}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <BrainCircuit className="h-4 w-4 mr-2" />}
              AI Insight
            </Button>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="System Load" value={`${(totalLoad / nodes.length).toFixed(1)}%`} icon={<TrendingUp className="h-5 w-5" />} color="text-blue-400" />
          <StatCard title="Avg Latency" value={`${avgLatency.toFixed(1)}ms`} icon={<Clock className="h-5 w-5" />} color="text-amber-400" />
          <StatCard title="Energy Draw" value={`${totalEnergy.toFixed(0)}W`} icon={<Zap className="h-5 w-5" />} color="text-emerald-400" />
          <StatCard title="Anomalies" value={anomalies.length.toString()} icon={<ShieldAlert className="h-5 w-5" />} color={anomalies.length > 0 ? "text-red-400" : "text-zinc-500"} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Visualization & Logs */}
          <Card className="lg:col-span-2 bg-zinc-900/50 border-zinc-800 backdrop-blur-sm">
            <Tabs defaultValue="performance" className="w-full">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-lg font-semibold text-white">System Monitoring</CardTitle>
                  <CardDescription className="text-zinc-500">Real-time metrics and event logs</CardDescription>
                </div>
                <TabsList className="bg-zinc-800 border-zinc-700">
                  <TabsTrigger value="performance" className="text-xs">Performance</TabsTrigger>
                  <TabsTrigger value="logs" className="text-xs">Event Logs</TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent className="h-[350px] pt-4">
                <TabsContent value="performance" className="h-full mt-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history}>
                      <defs>
                        <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis dataKey="time" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px', fontSize: '12px' }}
                        itemStyle={{ color: '#10b981' }}
                      />
                      <Area type="monotone" dataKey="avgCpu" stroke="#10b981" fillOpacity={1} fill="url(#colorCpu)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </TabsContent>
                <TabsContent value="logs" className="h-full mt-0">
                  <ScrollArea className="h-full pr-4">
                    <div className="space-y-2">
                      {logs.length === 0 ? (
                        <div className="text-center text-zinc-600 py-10 text-sm">No events recorded yet.</div>
                      ) : (
                        logs.map((log) => (
                          <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/30 border border-zinc-800/50">
                            <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${
                              log.type === 'warning' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 
                              log.type === 'success' ? 'bg-emerald-500' : 'bg-blue-500'
                            }`} />
                            <div className="flex-1 space-y-1">
                              <p className="text-sm text-zinc-200">{log.message}</p>
                              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">{log.time}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>

          {/* Controls & AI Insights */}
          <div className="space-y-6">
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-emerald-500" />
                  Control Center
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-zinc-300">Global Workload</label>
                    <Badge variant="outline" className="bg-zinc-800 border-zinc-700 text-zinc-300">{workload}%</Badge>
                  </div>
                  <Slider 
                    value={[workload]} 
                    onValueChange={handleWorkloadChange} 
                    max={200} 
                    step={10}
                    className="py-4"
                  />
                </div>
                <div className="flex items-center justify-between p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium text-white">AI Optimization</label>
                    <p className="text-xs text-zinc-500">Auto-balance load & scale</p>
                  </div>
                  <Switch checked={isOptimizing} onCheckedChange={toggleOptimization} />
                </div>
              </CardContent>
            </Card>

            <AnimatePresence>
              {aiPlan && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                >
                  <Card className="bg-emerald-500/5 border-emerald-500/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                        <BrainCircuit className="h-4 w-4" />
                        AI Recommendation
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-zinc-300 leading-relaxed">{aiPlan.recommendation}</p>
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-500 bg-emerald-500/10 w-fit px-2 py-1 rounded">
                        <TrendingUp className="h-3 w-3" />
                        +{aiPlan.efficiencyGain}% Efficiency
                      </div>
                      <ScrollArea className="h-32 mt-2">
                        <div className="space-y-2">
                          {aiPlan.actions.map((action, i) => (
                            <div key={i} className="text-xs p-2 bg-zinc-900/50 rounded border border-zinc-800">
                              <span className="text-emerald-400 font-bold">{action.nodeId}:</span> {action.action}
                              <p className="text-zinc-500 mt-1 italic">{action.reason}</p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Nodes Grid */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Server className="h-6 w-6 text-emerald-500" />
              Compute Nodes
            </h2>
            <Badge variant="outline" className="text-zinc-400 border-zinc-800">{nodes.length} Active Nodes</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {nodes.map((node) => (
              <NodeCard key={node.id} node={node} onToggle={() => toggleNode(node.id)} />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

function StatCard({ title, value, icon, color }: { title: string, value: string, icon: ReactNode, color: string }) {
  return (
    <Card className="bg-zinc-900/50 border-zinc-800 overflow-hidden relative group">
      <div className={`absolute top-0 left-0 w-1 h-full ${color.replace('text', 'bg')}`} />
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold text-white">{value}</p>
          </div>
          <div className={`${color} bg-zinc-800/50 p-3 rounded-xl group-hover:scale-110 transition-transform`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface NodeCardProps {
  node: NodeMetrics;
  onToggle: () => void | Promise<void>;
  key?: any;
}

function NodeCard({ node, onToggle }: NodeCardProps) {
  const isWarning = node.cpu > 80 || node.latency > 30;
  
  return (
    <motion.div layout>
      <Card className={`bg-zinc-900/50 border-zinc-800 transition-all ${isWarning ? 'ring-1 ring-red-500/30' : ''}`}>
        <CardHeader className="p-4 pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className={`h-4 w-4 ${node.status === 'active' ? 'text-emerald-500' : 'text-zinc-600'}`} />
              <span className="text-sm font-bold text-white">{node.id}</span>
            </div>
            <Badge 
              variant={node.status === 'active' ? 'default' : 'secondary'} 
              className={`text-[10px] h-5 ${node.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-zinc-800 text-zinc-500'}`}
            >
              {node.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          <div className="grid grid-cols-2 gap-2 text-[10px] uppercase tracking-widest font-bold text-zinc-500">
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Cpu className="h-3 w-3" /> CPU
              </div>
              <div className={`text-sm ${node.cpu > 80 ? 'text-red-400' : 'text-zinc-200'}`}>{node.cpu}%</div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> LATENCY
              </div>
              <div className={`text-sm ${node.latency > 30 ? 'text-amber-400' : 'text-zinc-200'}`}>{node.latency}ms</div>
            </div>
          </div>
          
          <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
            <motion.div 
              className={`h-full ${node.cpu > 80 ? 'bg-red-500' : 'bg-emerald-500'}`}
              initial={{ width: 0 }}
              animate={{ width: `${node.cpu}%` }}
            />
          </div>

          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full h-8 text-[10px] uppercase font-bold text-zinc-500 hover:text-white hover:bg-zinc-800"
            onClick={onToggle}
          >
            <Power className="h-3 w-3 mr-2" />
            {node.status === 'active' ? 'Deactivate' : 'Activate'}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

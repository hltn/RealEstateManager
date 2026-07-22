import { useEffect, useState } from 'react';
import { Server, RefreshCw } from 'lucide-react';

function App() {
  const [apiStatus, setApiStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState<string>('Connecting to Backend...');

  const fetchApi = async () => {
    setApiStatus('loading');
    setMessage('Connecting to Backend...');
    try {
      const response = await fetch('/api/news-fire-crawl-manager');
      if (!response.ok) throw new Error('Failed to fetch');
      
      const text = await response.text();
      setMessage(text);
      setApiStatus('success');
    } catch (error) {
      console.error(error);
      setMessage('Failed to connect to API.');
      setApiStatus('error');
    }
  };

  useEffect(() => {
    fetchApi();
  }, []);

  return (
    <div className="w-full max-w-6xl mx-auto p-8">
      <header className="flex justify-between items-center mb-12 animate-[fadeInDown_0.8s_ease-out]">
        <h1 className="text-4xl font-bold text-gradient tracking-tight">RealEstate Web Admin</h1>
        <div className="flex gap-4 items-center">
          <Server className="text-slate-400" />
          <span className="text-slate-400 font-medium">System Online</span>
        </div>
      </header>

      <main>
        <div className="glass-panel rounded-3xl p-10 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_30px_60px_-12px_rgba(0,0,0,0.6),0_0_20px_var(--color-accent-glow)] relative overflow-hidden animate-[fadeInUp_0.8s_ease-out_0.2s_both]">
          {/* Top highlight border */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"></div>
          
          <h2 className="mb-6 text-2xl font-semibold text-white">
            Module Status
          </h2>
          
          <div className="flex items-center gap-4 mb-8">
            <div className={`w-3 h-3 rounded-full animate-pulse shadow-lg ${
              apiStatus === 'success' ? 'bg-emerald-500 shadow-emerald-500/50' : 
              apiStatus === 'loading' ? 'bg-amber-500 shadow-amber-500/50' : 
              'bg-red-500 shadow-red-500/50'
            }`}></div>
            <span className={`text-xl font-medium ${
              apiStatus === 'success' ? 'text-emerald-500' : 
              apiStatus === 'loading' ? 'text-amber-500' : 
              'text-red-500'
            }`}>
              {message}
            </span>
          </div>

          <p className="text-slate-400 mb-8 leading-relaxed max-w-2xl">
            This is the premium Web Frontend integrated directly into the NestJS backend, now fully powered by <strong className="text-sky-400">Tailwind CSS v4</strong>. 
            The system retains its glassmorphism, micro-animations, and modern React practices while taking advantage of utility-first styling.
          </p>

          <button 
            onClick={fetchApi}
            className="flex items-center gap-3 bg-gradient-to-br from-blue-500 to-blue-700 text-white font-semibold py-4 px-8 rounded-xl transition-all duration-200 hover:scale-105 hover:shadow-[0_15px_25px_-10px_var(--color-accent-glow)] active:scale-95"
          >
            <RefreshCw className={apiStatus === 'loading' ? 'animate-spin' : ''} size={20} />
            Test Connection
          </button>
        </div>
      </main>
    </div>
  );
}

export default App;

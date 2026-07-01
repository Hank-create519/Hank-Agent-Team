import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import StartupScreen from './ui/pages/StartupScreen';
import './ui/styles/globals.css';

const Root = () => {
  const [showStartup, setShowStartup] = useState(true);

  useEffect(() => {
    // 启动画面显示 2.5 秒后自动消失
    const timer = setTimeout(() => {
      setShowStartup(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <React.StrictMode>
      {showStartup ? <StartupScreen onReady={() => setShowStartup(false)} /> : <App />}
    </React.StrictMode>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);

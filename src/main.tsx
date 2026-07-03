import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './ui/styles/globals.css';

const Root = () => {
  return (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);

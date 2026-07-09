import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const StartupScreen: React.FC<{ onReady: () => void }> = ({ onReady }) => {
  const [phase, setPhase] = useState<'loading' | 'reviewing' | 'ready'>('loading');

  useEffect(() => {
    // 模拟加载过程
    const timer1 = setTimeout(() => setPhase('reviewing'), 800);
    const timer2 = setTimeout(() => setPhase('ready'), 2400);
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, []);

  useEffect(() => {
    if (phase === 'ready') {
      const timer = setTimeout(onReady, 300);
      return () => clearTimeout(timer);
    }
  }, [phase, onReady]);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'linear-gradient(135deg, #05050F 0%, #0D0D1A 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      overflow: 'hidden',
    }}>
      {/* 背景粒子 */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundImage: `radial-gradient(circle at 25% 25%, rgba(77,171,247,0.1) 0px, transparent 50px),
                          radial-gradient(circle at 75% 75%, rgba(255,149,0,0.1) 0px, transparent 50px),
                          radial-gradient(circle at 50% 50%, rgba(167,139,250,0.05) 0px, transparent 100px)`,
      }} />

      {/* Logo 动画 */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{
          marginBottom: 48,
          textAlign: 'center',
        }}
      >
        <motion.h1
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          style={{
            fontSize: 48,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
            background: 'linear-gradient(135deg, #4DABF7, #22D3EE)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            marginBottom: 8,
          }}
        >
          Hank AI Agent Team
        </motion.h1>
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          style={{
            fontSize: 16,
            color: 'rgba(255,255,255,0.6)',
            fontWeight: 500,
          }}
        >
          异构多智能体协作集群 · 瀚海审查系统集成版
        </motion.p>
      </motion.div>

      {/* 进度条 */}
      <div style={{
        width: 320,
        height: 6,
        borderRadius: 3,
        background: 'rgba(255,255,255,0.05)',
        overflow: 'hidden',
        marginBottom: 48,
      }}>
        <AnimatePresence>
          {phase === 'loading' && (
            <motion.div
              key="loading"
              initial={{ width: 0 }}
              animate={{ width: '40%' }}
              transition={{ duration: 0.8, ease: 'easeInOut' }}
              style={{
                height: '100%',
                background: 'linear-gradient(90deg, #4DABF7, #22D3EE)',
                borderRadius: 3,
              }}
            />
          )}
          {phase === 'reviewing' && (
            <motion.div
              key="reviewing"
              initial={{ width: '40%' }}
              animate={{ width: '85%' }}
              transition={{ duration: 0.8, ease: 'easeInOut' }}
              style={{
                height: '100%',
                background: 'linear-gradient(90deg, #22D3EE, #AF52DE)',
                borderRadius: 3,
              }}
            />
          )}
          {phase === 'ready' && (
            <motion.div
              key="ready"
              initial={{ width: '85%' }}
              animate={{ width: '100%' }}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
              style={{
                height: '100%',
                background: 'linear-gradient(90deg, #AF52DE, #FF3B30)',
                borderRadius: 3,
              }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* 阶段文字 */}
      <AnimatePresence mode="wait">
        {phase === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.7)',
              fontWeight: 500,
              marginBottom: 12,
            }}
          >
            🚀 启动中...
          </motion.div>
        )}
        {phase === 'reviewing' && (
          <motion.div
            key="reviewing"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.7)',
              fontWeight: 500,
              marginBottom: 12,
            }}
          >
            🔍 审查框架初始化中...
          </motion.div>
        )}
        {phase === 'ready' && (
          <motion.div
            key="ready"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.7)',
              fontWeight: 500,
              marginBottom: 12,
            }}
          >
            ✅ 准备就绪 —— 双品牌系统已激活
          </motion.div>
        )}
      </AnimatePresence>

      {/* 双品牌徽章 */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        style={{
          display: 'flex',
          gap: 24,
          marginTop: 24,
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 16px',
          borderRadius: 20,
          background: 'rgba(77,171,247,0.15)',
          border: '1px solid rgba(77,171,247,0.3)',
        }}>
          <div style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #4DABF7, #22D3EE)',
          }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#4DABF7' }}>Hank Agent Team</span>
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 16px',
          borderRadius: 20,
          background: 'rgba(175,82,222,0.15)',
          border: '1px solid rgba(175,82,222,0.3)',
        }}>
          <div style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #AF52DE, #FF3B30)',
          }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#AF52DE' }}>瀚海审查系统</span>
        </div>
      </motion.div>
    </div>
  );
};

export default StartupScreen;
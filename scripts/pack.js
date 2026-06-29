const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ==================== 配置 ====================
const APP_NAME = 'Hank Agent Team';
const DESKTOP_APP_PATH = path.join(process.env.HOME, 'Desktop', `${APP_NAME}.app`);
const RESOURCES_PATH = path.join(DESKTOP_APP_PATH, 'Contents', 'Resources');
const APP_ASAR_PATH = path.join(RESOURCES_PATH, 'app.asar');
const DIST_PATH = path.join(__dirname, '..', 'dist');

console.log(`\n🚀 开始打包 ${APP_NAME}...\n`);

// ==================== 步骤 1：构建前端 ====================
console.log('1. 构建前端 (vite build)...');
try {
  execSync('npm run build', { stdio: 'inherit' });
} catch (e) {
  console.error('\n❌ 构建失败，请检查 vite.config.ts 和依赖');
  process.exit(1);
}

// ==================== 步骤 2：从现有 .app 提取 Electron 主进程文件 ====================
console.log('\n2. 从桌面应用提取 electron-main.js / preload.js / package.json...');
if (!fs.existsSync(APP_ASAR_PATH)) {
  console.error(`\n❌ 找不到桌面应用：${DESKTOP_APP_PATH}\n请先确保 Hank Agent Team.app 已存在桌面。`);
  process.exit(1);
}

// 创建临时目录
const TEMP_DIR = path.join(__dirname, '..', 'temp', 'pack');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// 解包 app.asar 到 temp
console.log('   → 解包 app.asar...');
try {
  execSync(`npx asar extract "${APP_ASAR_PATH}" "${TEMP_DIR}"`, { stdio: 'ignore' });
} catch (e) {
  console.error('\n❌ 解包 app.asar 失败');
  process.exit(1);
}

// 复制主进程文件到 dist
const ELECTRON_FILES = ['electron-main.js', 'preload.js', 'package.json'];
ELECTRON_FILES.forEach(file => {
  const src = path.join(TEMP_DIR, file);
  const dest = path.join(DIST_PATH, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`   → 复制 ${file}`);
  } else {
    console.warn(`   ⚠️  警告：未找到 ${file}，将跳过复制`);
  }
});

// ==================== 步骤 3：打包为 app.asar ====================
console.log('\n3. 打包 dist/ 为 app.asar...');
try {
  execSync(`npx asar pack "${DIST_PATH}" "${APP_ASAR_PATH}"`, { stdio: 'inherit' });
} catch (e) {
  console.error('\n❌ 打包 app.asar 失败');
  process.exit(1);
}

// ==================== 清理 ====================
console.log('\n4. 清理临时文件...');
try {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
} catch (e) {
  // 忽略清理错误
}

console.log(`\n✅ ${APP_NAME} 已成功打包并替换至：\n   ${DESKTOP_APP_PATH}\n`);
console.log('💡 提示：现在可以双击桌面应用启动了！');
